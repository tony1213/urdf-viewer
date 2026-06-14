// ─── Capability gating ───────────────────────────────────────
// Decide which feature panels to mount, based on the joints present in the
// loaded URDF. Pure name inspection (no engine instance needed), so it can be
// called during render. Patterns mirror GaitEngine / ExpressionEngine.
//
//   gait  — both legs expose movable hip + knee + ankle joints
//   face  — at least one movable eye joint exists (InMoov i01.head.eye*, or
//           any *_eye_* / eye_* naming)
//
// A legged-no-eyes robot (e.g. fr02) → gait only. A head-only robot (InMoov)
// → face only. A plain arm → neither.

const MOVABLE = new Set(['revolute', 'continuous']);

// Side prefix detection (l_/left_/L_ vs r_/right_/R_), matching GaitEngine's `side()`.
function sideOf(name) {
  const n = name.toLowerCase();
  if (/^l[_.]/.test(n) || /left/.test(n) || /(^|[_.])l_/.test(n)) return 'l';
  if (/^r[_.]/.test(n) || /right/.test(n) || /(^|[_.])r_/.test(n)) return 'r';
  return null;
}

const SEG = {
  hip:   /hip/i,
  knee:  /knee/i,
  ankle: /ankle|foot/i,
};
const EYE = /eye/i;

// robot: parseURDF product { joints: { name: { type, ... } }, links: {...} }
export function detectCapabilities(robot) {
  const out = { gait: false, face: false };
  if (!robot || !robot.joints) return out;
  const J = robot.joints;

  const movable = (n) => MOVABLE.has((J[n] && J[n].type || '').toLowerCase());

  // —— gait: each side must have a movable hip, knee, and ankle ——
  const has = { l: { hip: false, knee: false, ankle: false },
                r: { hip: false, knee: false, ankle: false } };
  for (const name of Object.keys(J)) {
    if (!movable(name)) continue;
    const s = sideOf(name);
    if (!s) continue;
    for (const seg of Object.keys(SEG)) if (SEG[seg].test(name)) has[s][seg] = true;
  }
  const sideComplete = (s) => has[s].hip && has[s].knee && has[s].ankle;
  out.gait = sideComplete('l') && sideComplete('r');

  // —— face: any movable eye joint ——
  for (const name of Object.keys(J)) {
    if (EYE.test(name) && movable(name)) { out.face = true; break; }
  }

  return out;
}
