# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # Production build to dist/
npm run preview  # Preview built bundle
npm run deploy   # Build + push dist/ to gh-pages branch

node scripts/screenshot-robots.mjs   # Regenerate README screenshots (puppeteer + vite preview;
                                     # reads robot URDFs from a hardcoded local path in the script)
```

There is no test suite, no linter, and no type checker configured. UI/feature changes must be verified manually in the browser via `npm run dev`. The `main` branch auto-deploys to GitHub Pages (https://tony1213.github.io/urdf-viewer/) via `.github/workflows/deploy.yml` — Vite's `base` is hardcoded to `/urdf-viewer/` (vite.config.js).

## Architecture

This is a single-page React + Three.js URDF viewer that runs entirely in the browser — no backend, no asset server. Users drag a folder containing a `.urdf` and its referenced meshes into the page; everything is parsed and rendered client-side.

### File layout

- `src/main.jsx` — React entrypoint, renders `<RobotViewer />`.
- `src/RobotViewer.jsx` — **the entire app** (~1700 lines). Contains URDF/STL/OBJ/DAE parsers, scene builder, IK solver, measurement tool, sidebar UI, and all React state. The code is intentionally compacted — many helpers are written as one-line dense functions. Sections are demarcated by `// ─── ... ────` banner comments; use those to navigate.
- `src/gait/` — auto-generated motion module (the only piece that's been factored out). Both engines derive everything from the loaded URDF (measured geometry, joint limits, probed axis signs) — never hardcode link lengths, heights, or joint-direction sign tables:
  - `legParams.js` — `hasCompleteLegs()` is a cheap, side-effect-free name check (safe to call every render, gates panel mounting). `extractLegParams()` measures thigh/calf lengths from live scene-graph world positions in the rest pose and **probes joint sign conventions by applying test angles** — it moves joints, so only call it from inside the mounted panel.
  - `GaitEngine.js` — RAF loop: cycloid foot trajectory → 2-link analytic IK → clamp to URDF limits. Writes joint quaternions directly (`initQuat · axisAngle`, same formula as `updateJoint`).
  - `faceParams.js` / `FaceEngine.js` — same split for facial expressions: `hasExpressionJoints()` gate (movable eye joint required), name-based role detection, presets as normalized [-1,1] channels mapped into each joint's real limit range; idle blink + eye saccades.
  - `GaitPanel.jsx` / `FacePanel.jsx` — UI panels, mounted by RobotViewer only when the corresponding gate passes.
  - Both engines share the `onTick` (per-frame, imperative DOM sync — no React) / `onCommit` (once on stop, settles React state) contract. New animation features must follow it — see "Joint updates" below.

### Data flow inside RobotViewer.jsx

1. **Parse**: `parseURDF(xml)` → `{links, joints, materials}`. When a link's `<visual>` is a DAE *and* its `<collision>` is an STL, the STL is preferred (DAE coordinate frames in URDF often disagree with link frames — this is intentional, not a bug).
2. **Build scene**: `buildRobotScene(robot, fileMap)` walks the kinematic tree and produces `{rootGroup, jointObjects, linkObjects, comMarkers, inertiaMarkers, axisHelpers}`. Each joint is a `THREE.Group` whose `userData` carries `{jointType, axis, lower, upper, value, initQuat}` — `initQuat` is the joint's neutral orientation; current orientation is always `initQuat * axisAngle(axis, value)`. Don't mutate `initQuat` after construction.
3. **Mount in scene graph**: `offsetGroup → worldGroup → rootGroup`. `worldGroup` rotation is set by `applyCoord(upAxis, upSign)` so the model's URDF up-axis can be reoriented; `offsetGroup` position handles the user's height offset and the auto-ground calculation. The robot's internal kinematic tree is owned by `rootGroup` — never reparent links inside it.
4. **Joint updates**: `updateJoint(name, val)` is the canonical mutator — writes `userData.value`, sets the quaternion (or position for prismatic), imperatively refreshes the slider DOM, then `setJointVals`. Sliders and number boxes are **uncontrolled** (`defaultValue` + refs in `jointSliderRefsMap` / `jointInputRefsMap`) — do not convert them to controlled inputs; re-rendering the whole component per frame during playback caused visible flicker. Gait/face engines bypass React entirely: they write quaternions directly at 60 fps and call `onTick` → `syncJointDOM` (imperative DOM update that skips the focused element), then `onCommit` fires once on stop to settle `jointVals`.
5. **Mesh resolution**: `findFile(filename)` strips `package://`, `model://`, `file://` prefixes and matches case-insensitively against the dropped folder's files (basename fallback). DAE files automatically prefer a same-name `.stl` if one exists in the folder.

### Three refs you'll touch most often

- `jointObjRef.current[name]` — live `THREE.Group` for a joint (read `userData.value` for current angle).
- `linkObjRef.current[name]` — live `THREE.Group` for a link.
- `robotRef.current` — mirror of `robot` state, used inside native event handlers that can't rely on React closures.

Most mouse/keyboard handlers are attached as **native** DOM listeners (not React `onMouseDown` etc.) because they need `{capture:true}`, `preventDefault()` for middle-click autoscroll, or to bypass React's synthetic-event ordering. Keep that pattern when adding new interactions; mirror any state they read into a ref.

### Subsystems inside the file (use the banner comments to find them)

- **Hover/highlight** — adds an emissive overlay material; original materials are stashed in `originalMatsRef` and restored on unhover.
- **Link drag** — left-click on a hovered link rotates its parent joint (horizontal mouse delta → angle/position).
- **TCP IK** — only enabled for serial chains. CCD solver, 20 iterations, projects onto each joint's rotation plane. Skips fixed/prismatic.
- **Measure tool** — two-click point-to-point distance with vertex snapping; markers are parented to their hit link so they follow joint motion.
- **Gait / face panels** — conditionally mounted only when `hasCompleteLegs()` / `hasExpressionJoints()` pass (both are pure name checks, evaluated every render). See `src/gait/`.

## Conventions

- **Three.js is pinned at 0.162.0.** 0.184+ has a TDZ incompatibility with Vite — do not bump it.
- The codebase is **Chinese-language** for UI strings, comments, and commit messages. Existing i18n is a `lang` state with two flat string tables; add new strings to both.
- Code style is deliberately dense (multi-statement single-line functions). Match the surrounding style when editing — don't reformat unrelated lines.
- New top-level helpers go in `RobotViewer.jsx` above the `RobotViewer` component, separated by a `// ─── Name ────` banner. Only factor a module out under `src/` if it has clear boundaries (as `gait/` does).
