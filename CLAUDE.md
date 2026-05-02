# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # Production build to dist/
npm run preview  # Preview built bundle
npm run deploy   # Build + push dist/ to gh-pages branch
```

There is no test suite, no linter, and no type checker configured. UI/feature changes must be verified manually in the browser via `npm run dev`. The `main` branch auto-deploys to GitHub Pages via `.github/workflows/deploy.yml` — Vite's `base` is hardcoded to `/urdf-viewer/` (vite.config.js).

## Architecture

This is a single-page React + Three.js URDF viewer that runs entirely in the browser — no backend, no asset server. Users drag a folder containing a `.urdf` and its referenced meshes into the page; everything is parsed and rendered client-side.

### File layout

- `src/main.jsx` — React entrypoint, renders `<RobotViewer />`.
- `src/RobotViewer.jsx` — **the entire app** (~1650 lines). Contains URDF/STL/OBJ/DAE parsers, scene builder, IK solver, measurement tool, sidebar UI, and all React state. The code is intentionally compacted — many helpers are written as one-line dense functions. Sections are demarcated by `// ─── ... ────` banner comments; use those to navigate.
- `src/trajectory/` — joint trajectory playback module (the only piece that's been factored out):
  - `trajectoryParser.js` — parses two JSON formats (`{frames:[{time,joints}]}` and `{joint_names, joints:[[t,...]]}`).
  - `interpolate.js` — binary search + linear interpolation between frames.
  - `useTrajectory.js` — RAF-driven state machine (IDLE/LOADED/PLAYING/PAUSED). **Every tunable lives in a ref** (`tickRef`, `playingRef`, `trajRef`, `speedRef`, `loopRef`, `onUpdateRef`) so the RAF loop never captures stale closures. If you touch this file, preserve that pattern.
  - `TrajectoryPlayer.jsx` — playback UI panel.

### Data flow inside RobotViewer.jsx

1. **Parse**: `parseURDF(xml)` → `{links, joints, materials}`. When a link's `<visual>` is a DAE *and* its `<collision>` is an STL, the STL is preferred (DAE coordinate frames in URDF often disagree with link frames — this is intentional, not a bug).
2. **Build scene**: `buildRobotScene(robot, fileMap)` walks the kinematic tree and produces `{rootGroup, jointObjects, linkObjects, comMarkers, inertiaMarkers, axisHelpers}`. Each joint is a `THREE.Group` whose `userData` carries `{jointType, axis, lower, upper, value, initQuat}` — `initQuat` is the joint's neutral orientation; current orientation is always `initQuat * axisAngle(axis, value)`. Don't mutate `initQuat` after construction.
3. **Mount in scene graph**: `offsetGroup → worldGroup → rootGroup`. `worldGroup` rotation is set by `applyCoord(upAxis, upSign)` so the model's URDF up-axis can be reoriented; `offsetGroup` position handles the user's height offset and the auto-ground calculation. The robot's internal kinematic tree is owned by `rootGroup` — never reparent links inside it.
4. **Joint updates**: `updateJoint(name, val)` is the canonical mutator. `updateJointSilent` is a copy that skips `setJointVals` — used during trajectory playback (30 fps × N joints would otherwise thrash React); a 100 ms `setInterval` syncs `jointVals` back from `userData.value` so sliders stay roughly current.
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
- **Trajectory playback** — see `src/trajectory/`. Uses `updateJointSilent` to avoid React re-render storms.

## Conventions

- **Three.js is pinned at 0.162.0.** 0.184+ has a TDZ incompatibility with Vite — do not bump it.
- The codebase is **Chinese-language** for UI strings, comments, and commit messages. Existing i18n is a `lang` state with two flat string tables; add new strings to both.
- Code style is deliberately dense (multi-statement single-line functions). Match the surrounding style when editing — don't reformat unrelated lines.
- New top-level helpers go in `RobotViewer.jsx` above the `RobotViewer` component, separated by a `// ─── Name ────` banner. Only factor a module out under `src/` if it has clear boundaries (as `trajectory/` does).
