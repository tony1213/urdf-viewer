// ─── Expression-joint detector ───────────────────────────────
// Find a robot's facial/expression joints from the loaded URDF so expressions
// are generated against the robot's real joints & limits — same philosophy as
// the gait feature. Roles are matched by name (tolerant of side prefixes), and
// each joint's URDF limit is read so expression values can be normalized into
// the joint's actual travel (no hardcoded directions or ranges).
//
// Recognized roles (all optional except eyes, which gate the feature):
//   eyes_pan / eyes_tilt — both eyes together (or per-eye l_/r_ eye_pan/tilt)
//   lid (eyelid/blink) · jaw (mouth/mandible) · brow (eyebrow) · mouth (lip/smile)
//   head_pan / head_tilt — head turn/nod, used sparingly for liveliness
const MOVABLE = new Set(["revolute", "continuous"]);

// ordered so more specific patterns win (eye_pan before plain eye, etc.)
const ROLE_PATTERNS = [
  ["eyes_pan",  /eye.*pan|eye.*yaw|eyes?_?lr/i],
  ["eyes_tilt", /eye.*tilt|eye.*pitch|eyes?_?ud/i],
  ["lid",       /lid|blink|eyes?_?open/i],
  ["brow",      /brow/i],
  ["jaw",       /jaw|mandible/i],
  ["mouth",     /mouth|lip|smile/i],
  ["head_pan",  /head.*pan|head.*yaw|neck.*pan|neck.*yaw/i],
  ["head_tilt", /head.*tilt|head.*pitch|neck.*tilt|neck.*pitch/i],
];

const isEyeName = (n) => /eye/i.test(n);

// Lightweight, side-effect-free gate: does the robot have any movable eye joint?
// Pure name inspection — safe to call every render. "有 eye 相关的才显示表情".
export function hasExpressionJoints(jointObjs) {
  if (!jointObjs) return false;
  for (const n of Object.keys(jointObjs)) {
    if (isEyeName(n) && MOVABLE.has((jointObjs[n].userData?.jointType) || "")) return true;
  }
  return false;
}

// Full detection (call once when the panel mounts): assign joints to roles and
// read their limits. Does NOT move any joint.
export function extractFaceParams(jointObjs) {
  if (!jointObjs) return null;
  const names = Object.keys(jointObjs);
  const movable = (n) => MOVABLE.has((jointObjs[n].userData?.jointType) || "");

  const roles = {};          // role -> [jointName, ...] (some roles can have L/R pair)
  for (const [role, re] of ROLE_PATTERNS) {
    for (const n of names) {
      if (!movable(n) || !re.test(n)) continue;
      // don't let a joint already claimed by an earlier (more specific) role be reused
      if (Object.values(roles).some((arr) => arr.includes(n))) continue;
      (roles[role] = roles[role] || []).push(n);
    }
  }
  // require at least one eye joint, else this isn't a face
  const hasEye = (roles.eyes_pan || roles.eyes_tilt) ||
    names.some((n) => isEyeName(n) && movable(n));
  if (!hasEye) return null;

  // limit lookup (radians) → mid + half-range, so a normalized [-1,1] expression
  // value maps into the joint's real travel and never violates limits.
  const lim = (name) => {
    const u = jointObjs[name].userData;
    const lo = Number.isFinite(u.lower) ? u.lower : -Math.PI / 4;
    const hi = Number.isFinite(u.upper) ? u.upper : Math.PI / 4;
    return { lo, hi, mid: (lo + hi) / 2, half: (hi - lo) / 2 };
  };
  const limitsByJoint = {};
  for (const arr of Object.values(roles)) for (const n of arr) limitsByJoint[n] = lim(n);

  const present = (r) => !!(roles[r] && roles[r].length);
  return {
    roles,                                 // role -> [jointName,...]
    limits: limitsByJoint,                 // jointName -> {lo,hi,mid,half}
    has: {
      eyesPan:  present("eyes_pan"),
      eyesTilt: present("eyes_tilt"),
      lid:      present("lid"),
      jaw:      present("jaw"),
      brow:     present("brow"),
      mouth:    present("mouth"),
      headPan:  present("head_pan"),
      headTilt: present("head_tilt"),
    },
    count: Object.values(roles).reduce((a, arr) => a + arr.length, 0),
  };
}
