// ─── URDF leg-parameter extractor ────────────────────────────
// Pull a robot's *actual* leg geometry from the loaded URDF so the gait can be
// generated to match that specific robot — no hardcoded link lengths or
// standing heights. This is what makes the same gait work for a 0.44 m-leg X1
// and a 0.8 m-leg H1 alike.
//
// Leg-segment lengths are measured from the live Three.js scene graph: each
// joint is an Object3D positioned by the viewer's forward kinematics (origin
// translation + rpy already applied), so the 3-D distance between joint world
// positions in the rest pose is the true segment length. This sidesteps any
// manual FK/rpy math (and the off-by-a-hip-link errors that come with it).
//
// Joint roles are matched by name, tolerant of l_/left_ and r_/right_ prefixes:
//   hip_pitch (sagittal swinger) · hip_roll · hip_yaw · knee · ankle_pitch · ankle_roll
import * as THREE from "three";

const MOVABLE = new Set(["revolute", "continuous"]);
const ROLE_PATTERNS = {
  hip_pitch:  /hip.*pitch/i,
  hip_roll:   /hip.*roll/i,
  hip_yaw:    /hip.*yaw/i,
  knee:       /knee/i,
  ankle_pitch:/ankle.*pitch|ankle(?!.*roll)/i,
  ankle_roll: /ankle.*roll/i,
};

function sideOf(name) {
  const n = name.toLowerCase();
  if (/(^|[_./-])(l|left)([_./-]|$)/.test(n) || /left/.test(n)) return "l";
  if (/(^|[_./-])(r|right)([_./-]|$)/.test(n) || /right/.test(n)) return "r";
  return null;
}

// jointObjs: jointObjRef.current  → { name: Object3D(with userData) }
// Returns null if the robot doesn't have a drivable pair of legs.
export function extractLegParams(jointObjs) {
  if (!jointObjs) return null;
  const names = Object.keys(jointObjs);
  const movable = (n) => MOVABLE.has((jointObjs[n].userData?.jointType) || "");

  // —— assign movable joints to {side, role} ——
  const legs = { l: {}, r: {} };
  for (const n of names) {
    if (!movable(n)) continue;
    const s = sideOf(n);
    if (!s) continue;
    for (const role of Object.keys(ROLE_PATTERNS)) {
      if (!legs[s][role] && ROLE_PATTERNS[role].test(n)) { legs[s][role] = n; break; }
    }
  }

  const sideReady = (s) => legs[s].hip_pitch && legs[s].knee && legs[s].ankle_pitch;
  if (!(sideReady("l") && sideReady("r"))) return null;

  // —— measure segment lengths from rest-pose world positions ——
  // Snapshot current joint angles, zero the leg joints, refresh world matrices,
  // measure, then restore — so measurement is unaffected by any user posing.
  const snap = {};
  for (const s of ["l", "r"]) for (const role of Object.keys(legs[s])) {
    const o = jointObjs[legs[s][role]];
    snap[legs[s][role]] = o.userData.value || 0;
  }
  const zero = (name) => {
    const o = jointObjs[name]; const u = o.userData;
    u.value = 0;
    if (u.initQuat) o.quaternion.copy(u.initQuat);
  };
  for (const name of Object.keys(snap)) zero(name);

  // refresh world matrices from the highest leg joint's root
  let root = jointObjs[legs.l.hip_pitch];
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);

  const wp = (name) => jointObjs[name].getWorldPosition(new THREE.Vector3());
  const segLen = (s) => {
    const hip = wp(legs[s].hip_pitch), knee = wp(legs[s].knee), ankle = wp(legs[s].ankle_pitch);
    return { thigh: hip.distanceTo(knee), calf: knee.distanceTo(ankle) };
  };
  const L = segLen("l"), R = segLen("r");
  // average both sides (symmetric robot); guard against zero
  const L1 = Math.max(1e-3, (L.thigh + R.thigh) / 2); // thigh
  const L2 = Math.max(1e-3, (L.calf  + R.calf ) / 2); // calf

  // restore user pose
  for (const name of Object.keys(snap)) {
    const o = jointObjs[name]; const u = o.userData; u.value = snap[name];
    if (u.initQuat && u.axis) o.quaternion.copy(u.initQuat).multiply(new THREE.Quaternion().setFromAxisAngle(u.axis, snap[name]));
  }
  root.updateMatrixWorld(true);

  // —— joint limits (radians) per role, averaged L/R, for clamping & range ——
  const limit = (role) => {
    const out = { lower: -Math.PI, upper: Math.PI };
    const ls = [], us = [];
    for (const s of ["l", "r"]) if (legs[s][role]) {
      const u = jointObjs[legs[s][role]].userData;
      if (Number.isFinite(u.lower)) ls.push(u.lower);
      if (Number.isFinite(u.upper)) us.push(u.upper);
    }
    if (ls.length) out.lower = Math.max(...ls); // tightest common range
    if (us.length) out.upper = Math.min(...us);
    return out;
  };
  const limits = {};
  for (const role of Object.keys(ROLE_PATTERNS)) limits[role] = limit(role);

  const legMax = L1 + L2;                       // max hip-to-ankle reach
  return {
    joints: legs,                                // {l:{role:name}, r:{role:name}}
    L1, L2, legMax,
    limits,                                      // {role:{lower,upper}}
    hasHipRoll:  !!(legs.l.hip_roll  && legs.r.hip_roll),
    hasHipYaw:   !!(legs.l.hip_yaw   && legs.r.hip_yaw),
    hasAnkleRoll:!!(legs.l.ankle_roll&& legs.r.ankle_roll),
    // sensible defaults derived from geometry (the whole point of this feature)
    suggested: {
      squat:  +(legMax * 0.82).toFixed(3),       // hip-to-foot standing height
      stride: +(legMax * 0.30).toFixed(3),       // step length
      lift:   +(legMax * 0.10).toFixed(3),       // foot clearance
    },
  };
}
