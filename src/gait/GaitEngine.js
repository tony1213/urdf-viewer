// ─── Gait engine ─────────────────────────────────────────────
// Generates a walking gait from a robot's *measured* leg geometry (see
// legParams.js). Everything spatial — standing height, stride, foot lift — is
// expressed against the real L1/L2 pulled from the URDF, so the same engine
// produces a correct gait for any biped regardless of size. No hardcoded
// heights (the bug that made a 0.44 m-leg robot try to reach a 0.75 m target).
//
// Pipeline per frame:
//   cycloid foot trajectory (stance: linear push-back, swing: cycloid lift)
//   → 2-link analytic IK on (L1,L2) → hip_pitch, knee, ankle (foot kept flat)
//   → lateral CoM sway on hip_roll / ankle_roll (swing leg unloads to stance side)
//   → all joints clamped to the URDF limits from legParams.
// Joints are driven by writing quaternions directly (initQuat·axisAngle, the
// same formula as the viewer's updateJoint) and pushed to the sliders via a
// throttled batched onSync — never per-joint setState.
import * as THREE from "three";

// Sign conventions: IK returns anatomical-positive (hip+ = thigh forward,
// knee+ = flexion, ankle+ = dorsiflex). Flip a ±1 here if a robot walks
// backwards / knee bends the wrong way — never touch the IK.
const SIGN = { hipPitch: 1, knee: 1, anklePitch: 1, hipRoll: -1, ankleRoll: 1 };

export class GaitEngine {
  constructor({ jointObjs, params, onSync }) {
    this.jointObjs = jointObjs;
    this.params = params;                 // from extractLegParams()
    this.onSync = onSync || (() => {});
    // tunables (seed from URDF-derived suggestions; user can override live)
    this.cfg = {
      period: 1.1,
      stride: params.suggested.stride,
      lift:   params.suggested.lift,
      squat:  params.suggested.squat,
      sway:   Math.min(0.08, params.legMax * 0.12),
      speed:  1.0,
    };
    this.running = false;
    this.raf = 0; this.t0 = 0; this.phase = 0; this._lastSync = 0;
    this.clamped = new Set();
    this._tick = this._tick.bind(this);
    this._q = new THREE.Quaternion();
  }
  setCfg(k, v) { this.cfg[k] = v; }
  isRunning() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true; this.clamped.clear();
    this.t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(this._tick);
  }
  stop() {
    this.running = false;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.raf);
    this.raf = 0;
    this._neutral();          // settle to a straight-ish stance
  }

  // write one joint by name, clamped to its URDF limit; returns applied value
  _apply(name, val) {
    const o = this.jointObjs[name]; if (!o) return val;
    const { axis, lower, upper, initQuat } = o.userData;
    let v = val;
    if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
      if (v < lower - 1e-6 || v > upper + 1e-6) this.clamped.add(name);
      v = Math.max(lower, Math.min(upper, v));
    }
    o.userData.value = v;
    this._q.setFromAxisAngle(axis, v);
    o.quaternion.copy(initQuat).multiply(this._q);
    return v;
  }

  // 2-link analytic IK: foot at (x fwd+, z down>0 measured from hip) → angles (rad)
  _ik(x, z) {
    const L1 = this.params.L1, L2 = this.params.L2;
    let d = Math.hypot(x, z); d = Math.min(d, L1 + L2 - 1e-4);
    const ckn = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
    const knee = Math.PI - Math.acos(ckn);
    const cb  = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const hip = Math.atan2(x, z) + Math.acos(cb);
    return [hip, knee, knee - hip];        // ankle = knee - hip → sole stays flat
  }

  // cycloid foot trajectory in hip frame; phase p∈[0,1)
  _foot(p) {
    const P = this.cfg;
    if (p < 0.5) {                          // swing: cycloid forward + lift
      const t = 2 * Math.PI * (p / 0.5);
      const x =  P.stride * (t - Math.sin(t)) / (2 * Math.PI) - P.stride / 2;
      const z =  P.squat - P.lift * (1 - Math.cos(t)) / 2;
      return [x, z];
    }
    const s = (p - 0.5) / 0.5;              // stance: linear push-back, flat
    return [P.stride / 2 - P.stride * s, P.squat];
  }

  _driveLeg(side, phase, sway, out) {
    const J = this.params.joints[side];
    const [x, z] = this._foot(phase);
    const [hip, knee, ankle] = this._ik(x, z);
    if (J.hip_pitch)  out[J.hip_pitch]  = this._apply(J.hip_pitch,  SIGN.hipPitch  * hip);
    if (J.knee)       out[J.knee]       = this._apply(J.knee,       SIGN.knee      * knee);
    if (J.ankle_pitch)out[J.ankle_pitch]= this._apply(J.ankle_pitch,SIGN.anklePitch* ankle);
    if (J.hip_roll)   out[J.hip_roll]   = this._apply(J.hip_roll,   SIGN.hipRoll   * sway);
    if (J.ankle_roll) out[J.ankle_roll] = this._apply(J.ankle_roll, SIGN.ankleRoll * sway);
    if (J.hip_yaw)    out[J.hip_yaw]    = this._apply(J.hip_yaw, 0);
  }

  _tick(now) {
    if (!this.running) return;
    const t = (now - this.t0) / 1000 * this.cfg.speed;
    const pL = (t / this.cfg.period) % 1;
    const pR = (pL + 0.5) % 1;
    // lateral sway: weight shifts to the stance leg (peaks mid-stance)
    const sway = this.cfg.sway * Math.sin(2 * Math.PI * (pL - 0.25));
    const out = {};
    this._driveLeg("l", pL,  sway, out);
    this._driveLeg("r", pR, -sway, out);
    if (now - this._lastSync > 120) { this._lastSync = now; this.onSync(out); }
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(this._tick);
  }

  // straighten legs to a neutral standing pose and sync sliders once
  _neutral() {
    const out = {};
    for (const side of ["l", "r"]) {
      const [hip, knee, ankle] = this._ik(0, this.cfg.squat);
      const J = this.params.joints[side];
      if (J.hip_pitch)  out[J.hip_pitch]  = this._apply(J.hip_pitch,  SIGN.hipPitch  * hip);
      if (J.knee)       out[J.knee]       = this._apply(J.knee,       SIGN.knee      * knee);
      if (J.ankle_pitch)out[J.ankle_pitch]= this._apply(J.ankle_pitch,SIGN.anklePitch* ankle);
      if (J.hip_roll)   out[J.hip_roll]   = this._apply(J.hip_roll, 0);
      if (J.ankle_roll) out[J.ankle_roll] = this._apply(J.ankle_roll, 0);
      if (J.hip_yaw)    out[J.hip_yaw]    = this._apply(J.hip_yaw, 0);
    }
    this.onSync(out);
  }
}
