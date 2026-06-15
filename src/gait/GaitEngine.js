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
// onTick (high-freq, imperative DOM) + onCommit (once on stop, React state).
import * as THREE from "three";

// Per-leg joint directions are probed from the URDF in legParams (hip_pitch /
// knee can point either way depending on the robot's axis convention), so the
// engine no longer carries a hardcoded sign table. Roll signs (lateral sway)
// are still fixed: + sway leans toward the robot's left.
const ROLL_SIGN = { hipRoll: -1, ankleRoll: 1 };

export class GaitEngine {
  constructor({ jointObjs, params, onTick, onCommit }) {
    this.jointObjs = jointObjs;
    this.params = params;                 // from extractLegParams()
    this.onTick = onTick || (() => {});      // high-freq: imperative DOM sync, no React re-render
    this.onCommit = onCommit || (() => {});  // once on stop: commit final pose to React state
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

  // 2-link analytic IK in the sagittal plane.
  // Foot target is (x forward, h below the hip). Returns joint angles (rad) in
  // anatomical-positive convention: hipPitch+ = thigh forward (from vertical),
  // knee+ = flexion, anklePitch+ = dorsiflexion (keeps the sole horizontal).
  // Verified: x=0 puts the foot exactly under the hip (no drift), for any L1≠L2.
  _ik(x, h) {
    const L1 = this.params.L1, L2 = this.params.L2;
    let d = Math.hypot(x, h); d = Math.min(d, L1 + L2 - 1e-4);
    const ckn  = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
    const knee = Math.PI - Math.acos(ckn);                    // flexion amount
    const cb   = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const beta = Math.acos(cb);                               // thigh vs hip→foot line
    const hip  = Math.atan2(x, h) + beta;                     // thigh from vertical-down
    const ankle = knee - hip;                                 // shank end ⟂ ground → flat sole
    return [hip, knee, ankle];
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
    const D = this.params.dirs[side];
    const [x, z] = this._foot(phase);
    const [hip, knee, ankle] = this._ik(x, z);
    if (J.hip_pitch)  out[J.hip_pitch]  = this._apply(J.hip_pitch,  D.hip   * hip);
    if (J.knee)       out[J.knee]       = this._apply(J.knee,       D.knee  * knee);
    if (J.ankle_pitch)out[J.ankle_pitch]= this._apply(J.ankle_pitch,D.ankle * ankle);
    if (J.hip_roll)   out[J.hip_roll]   = this._apply(J.hip_roll,   ROLL_SIGN.hipRoll   * sway);
    if (J.ankle_roll) out[J.ankle_roll] = this._apply(J.ankle_roll, ROLL_SIGN.ankleRoll * sway);
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
    // Push every frame to onTick, which updates slider/number-box DOM imperatively
    // (no setState). Joints themselves are already moved by writing quaternions
    // above; the viewer's own RAF loop renders them. This keeps sliders tracking
    // the gait live at 60fps WITHOUT re-rendering the 1600-line component — the
    // re-render (all sliders + URDF tree, ~8×/s) was what caused the flicker.
    this.onTick(out);
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(this._tick);
  }

  // straighten legs to a neutral standing pose and sync sliders once
  _neutral() {
    const out = {};
    for (const side of ["l", "r"]) {
      const [hip, knee, ankle] = this._ik(0, this.cfg.squat);
      const J = this.params.joints[side];
      const D = this.params.dirs[side];
      if (J.hip_pitch)  out[J.hip_pitch]  = this._apply(J.hip_pitch,  D.hip   * hip);
      if (J.knee)       out[J.knee]       = this._apply(J.knee,       D.knee  * knee);
      if (J.ankle_pitch)out[J.ankle_pitch]= this._apply(J.ankle_pitch,D.ankle * ankle);
      if (J.hip_roll)   out[J.hip_roll]   = this._apply(J.hip_roll, 0);
      if (J.ankle_roll) out[J.ankle_roll] = this._apply(J.ankle_roll, 0);
      if (J.hip_yaw)    out[J.hip_yaw]    = this._apply(J.hip_yaw, 0);
    }
    this.onTick(out);    // update DOM immediately
    this.onCommit(out);  // commit final pose to React state (sliders' defaultValue baseline)
  }
}
