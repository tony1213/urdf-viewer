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

  // —— auto-probe joint directions (robot-specific axis conventions) ——
  // Different URDFs define hip_pitch +angle as either thigh-forward or
  // thigh-backward. Rather than hardcode a SIGN table (which breaks the moment
  // a robot flips a convention — e.g. Unitree G1 vs X1), measure it: nudge each
  // pitch joint +δ in the rest pose and watch where the ankle moves.
  const wpName = (name) => jointObjs[name].getWorldPosition(new THREE.Vector3());
  const setAngle = (name, v) => {
    const o = jointObjs[name]; const u = o.userData;
    o.quaternion.copy(u.initQuat).multiply(new THREE.Quaternion().setFromAxisAngle(u.axis, v));
  };
  const probeSide = (s) => {
    const J = legs[s];
    const restAnkle = wpName(J.ankle_pitch);
    const hipPos = wpName(J.hip_pitch);
    // hip_pitch: +δ should move the foot forward (+world-X-ish in sagittal plane)
    setAngle(J.hip_pitch, 0.3); root.updateMatrixWorld(true);
    const aHip = wpName(J.ankle_pitch);
    setAngle(J.hip_pitch, 0); root.updateMatrixWorld(true);
    // pick the horizontal axis with the larger swing as "forward" proxy
    const dF = Math.abs(aHip.x - restAnkle.x) >= Math.abs(aHip.z - restAnkle.z)
      ? (aHip.x - restAnkle.x) : (aHip.z - restAnkle.z);
    const hipSign = dF >= 0 ? 1 : -1;
    // knee: +δ should shorten hip→ankle distance (flexion)
    const restD = hipPos.distanceTo(restAnkle);
    setAngle(J.knee, 0.3); root.updateMatrixWorld(true);
    const kneeD = wpName(J.hip_pitch).distanceTo(wpName(J.ankle_pitch));
    setAngle(J.knee, 0); root.updateMatrixWorld(true);
    const kneeSign = kneeD < restD ? 1 : -1;
    // ankle: the foot must end up flat. The IK supplies an ankle magnitude of
    // (knee - hip); the correct sign is robot-specific. Determine it by closed
    // loop: drive the leg to a standing pose with each candidate ankle sign and
    // keep whichever makes the foot link's sole most horizontal.
    let ankleSign = kneeSign;
    if (J.ankle_pitch) {
      const footName = J.ankle_roll || J.ankle_pitch;
      // reproduce the standing IK angles (foot under hip) for this leg
      const hh = legMax * 0.82;
      let dd = Math.min(hh, L1 + L2 - 1e-4);
      const ckn = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dd * dd) / (2 * L1 * L2)));
      const kneeMag = Math.PI - Math.acos(ckn);
      const cbb = Math.max(-1, Math.min(1, (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)));
      const hipMag = Math.atan2(0, hh) + Math.acos(cbb);
      const ankMag = kneeMag - hipMag;
      const verticality = (aSign) => {
        setAngle(J.hip_pitch, hipSign * hipMag);
        setAngle(J.knee, kneeSign * kneeMag);
        setAngle(J.ankle_pitch, aSign * ankMag);
        root.updateMatrixWorld(true);
        // foot sole normal ≈ foot link local +Z (or -Z); measure how vertical the
        // link's forward (local X) lies — flat sole ⇒ forward is horizontal.
        const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(jointObjs[footName].getWorldQuaternion(new THREE.Quaternion()));
        return Math.abs(fwd.z); // smaller = more horizontal = flatter
      };
      const vPos = verticality(1), vNeg = verticality(-1);
      ankleSign = vPos <= vNeg ? 1 : -1;
      // restore
      setAngle(J.hip_pitch, 0); setAngle(J.knee, 0); setAngle(J.ankle_pitch, 0);
      root.updateMatrixWorld(true);
    }
    return { hipSign, kneeSign, ankleSign };
  };
  const pl = probeSide("l"), pr = probeSide("r");
  const dirs = {
    l: { hip: pl.hipSign, knee: pl.kneeSign, ankle: pl.ankleSign },
    r: { hip: pr.hipSign, knee: pr.kneeSign, ankle: pr.ankleSign },
  };

  return {
    joints: legs,                                // {l:{role:name}, r:{role:name}}
    L1, L2, legMax,
    limits,                                      // {role:{lower,upper}}
    dirs,                                        // {l/r:{hip,knee,ankle}} probed signs
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
