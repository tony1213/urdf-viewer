/**
 * GaitEngine.js — Real-time kinematic gait controller for bipedal robots (H1-ready)
 *
 * Self-contained: drives joints directly via the viewer's updateJoint contract
 *   updateJoint(name, val):  o.quaternion = initQuat × setFromAxisAngle(axis, val)
 *
 * Algorithm (matches the validated offline H1 generator):
 *   - Cycloid foot swing trajectory (zero vel at lift-off & touch-down)
 *   - 2-link analytic IK in the sagittal plane (thigh L1, calf L2 auto-read or default 0.4)
 *   - Partial foot-flat ankle (gain<1) to respect H1's narrow ankle range [-0.87, +0.52]
 *   - Sinusoidal lateral sway via hip_roll, antiphase arm swing via shoulder_pitch
 *
 * Joint auto-detection by name pattern; per-joint sign table for axis conventions;
 * limits read from userData.lower/upper at runtime and clamped.
 *
 * RAF loop updates Three.js silently; a throttled callback syncs React state to
 * avoid setState storms.
 */

// ─── Joint name patterns (case-insensitive, matches Unitree H1/G1 + generic) ───
const PAT = {
  hip_pitch:      /hip[_-]?pitch/i,
  hip_roll:       /hip[_-]?roll/i,
  hip_yaw:        /hip[_-]?yaw/i,
  knee:           /knee/i,
  ankle_roll:     /ankle[_-]?roll/i,        // G1 has ankle_roll (test FIRST, more specific)
  ankle_pitch:    /ankle([_-]?pitch)?/i,    // H1: bare "ankle"; G1: "ankle_pitch"
  shoulder_pitch: /shoulder[_-]?pitch/i,
};

function side(name) {
  if (/(^|[_-])(l|left|L)([_-]|$)/.test(name) || /left/i.test(name)) return 'left';
  if (/(^|[_-])(r|right|R)([_-]|$)/.test(name) || /right/i.test(name)) return 'right';
  return null;
}

export class GaitEngine {
  /**
   * @param {Object} opts
   * @param {Object} opts.jointObjs   ref.current map: name -> Three.js group (userData.{axis,lower,upper,jointType})
   * @param {Function} opts.updateJoint   (name, val) => void  — Three.js-only silent update
   * @param {Function} opts.onSync        (valsObj) => void     — throttled React state sync
   */
  constructor({ jointObjs, updateJoint, onSync }) {
    this.jointObjs = jointObjs;
    this.updateJoint = updateJoint;
    this.onSync = onSync || (() => {});

    // ── tunable params (live-adjustable via setParam) ──
    this.params = {
      period: 1.1,        // s per full gait cycle (2 steps)
      stride: 0.18,       // m forward foot travel
      lift: 0.05,         // m foot clearance
      squat: 0.75,        // m nominal hip-to-foot standing height (shallow crouch)
      sway: 0.05,         // rad hip_roll lateral amplitude
      armSwing: 0.25,     // rad shoulder_pitch antiphase amplitude
      ankleGain: 0.65,    // partial foot-flat factor (avoids H1 ankle saturation)
      ankleRollGain: 0.5, // 6-DOF leg: foot lateral leveling vs hip_roll (G1)
      speed: 1.0,         // playback rate multiplier
    };

    // ── SIGN table: flip per joint to match URDF axis direction convention ──
    // Set to +1; if a joint moves the wrong way for the loaded URDF, flip to -1.
    this.SIGN = {
      hip_pitch: -1,   // H1 hip_pitch fwd convention (validated offline)
      knee:      +1,
      ankle:     +1,
      ankle_roll:+1,
      hip_roll:  +1,
      shoulder:  +1,
    };

    this.L1 = 0.4;   // thigh — overwritten by detect() if URDF origins available
    this.L2 = 0.4;   // calf

    this.running = false;
    this.t0 = 0;
    this.rafId = null;
    this.lastSync = 0;
    this.syncInterval = 120; // ms
    this.detected = null;
    this._tick = this._tick.bind(this);
  }

  // ─── Auto-detect leg/arm joints and read geometry from URDF ───
  detect() {
    const d = {
      left:  { hip_pitch: null, hip_roll: null, hip_yaw: null, knee: null, ankle: null, ankle_roll: null, shoulder: null },
      right: { hip_pitch: null, hip_roll: null, hip_yaw: null, knee: null, ankle: null, ankle_roll: null, shoulder: null },
    };
    for (const name of Object.keys(this.jointObjs)) {
      const o = this.jointObjs[name];
      if (!o || o.userData.jointType === 'fixed') continue;
      const s = side(name);
      if (!s) continue;
      if (PAT.hip_pitch.test(name))           d[s].hip_pitch = name;
      else if (PAT.hip_roll.test(name))        d[s].hip_roll = name;
      else if (PAT.hip_yaw.test(name))         d[s].hip_yaw = name;
      else if (PAT.knee.test(name))            d[s].knee = name;
      else if (PAT.ankle_roll.test(name))      d[s].ankle_roll = name;   // check roll BEFORE pitch
      else if (PAT.ankle_pitch.test(name))     d[s].ankle = name;
      else if (PAT.shoulder_pitch.test(name))  d[s].shoulder = name;
    }
    // try to read thigh/calf length from joint origins (full 3D distance, not just z)
    // thigh = |knee origin|, calf = |ankle_pitch origin| relative to their parent links
    const vlen = (p) => {
      if (!p) return 0;
      const x = p.x || 0, y = p.y || 0, z = p.z || 0;
      return Math.sqrt(x * x + y * y + z * z);
    };
    try {
      const kneeObj = this.jointObjs[d.left.knee];
      const ankObj  = this.jointObjs[d.left.ankle];
      const l1 = vlen(kneeObj && kneeObj.position);
      const l2 = vlen(ankObj  && ankObj.position);
      if (l1 > 0.01) this.L1 = l1;   // ignore near-zero (wrong joint)
      if (l2 > 0.01) this.L2 = l2;
    } catch (e) { /* keep defaults */ }

    this.detected = d;
    const legCount =
      ['hip_pitch', 'knee', 'ankle'].reduce(
        (n, k) => n + (d.left[k] ? 1 : 0) + (d.right[k] ? 1 : 0), 0);
    return { detected: d, legJointCount: legCount, L1: this.L1, L2: this.L2 };
  }

  // ─── cycloid foot swing: phase∈[0,1] -> (dx, dz) ───
  _cycloid(phase) {
    const t = 2 * Math.PI * phase;
    const dx = this.params.stride * (t - Math.sin(t)) / (2 * Math.PI);
    const dz = this.params.lift * (1 - Math.cos(t)) / 2;
    return [dx, dz];
  }

  // ─── 2-link planar IK: foot at (x fwd, z below hip) -> hip_pitch, knee, ankle ───
  _legIK(x, z) {
    const L1 = this.L1, L2 = this.L2;
    let d = Math.hypot(x, z);
    d = Math.min(d, L1 + L2 - 1e-4);
    const cosKnee = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
    const knee = Math.PI - Math.acos(cosKnee);
    const alpha = Math.atan2(x, z);
    const cosBeta = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
    const beta = Math.acos(cosBeta);
    const hipPitch = alpha + beta;
    const ankle = -this.params.ankleGain * (hipPitch - knee);
    return [hipPitch, knee, ankle];
  }

  _clamp(name, val) {
    const o = this.jointObjs[name];
    if (!o) return val;
    const lo = o.userData.lower, hi = o.userData.upper;
    if (lo == null || hi == null) return val;
    return Math.max(lo, Math.min(hi, val));
  }

  _apply(name, val) {
    if (!name) return [null, null];
    const clamped = this._clamp(name, val);
    this.updateJoint(name, clamped);
    return [name, clamped];
  }

  // ─── compute & apply one frame at absolute time t (seconds) ───
  _frame(t) {
    if (!this.detected) return;
    const P = this.params;
    const ph = ((t % P.period) / P.period + 1) % 1;   // [0,1)
    const acc = {};

    for (const s of ['left', 'right']) {
      const d = this.detected[s];
      const legPh = s === 'left' ? ph : (ph + 0.5) % 1;

      let x, z;
      if (legPh < 0.5) {                          // swing
        const sw = legPh / 0.5;
        const [dx, dz] = this._cycloid(sw);
        x = dx - P.stride / 2;
        z = P.squat - dz;
      } else {                                    // stance (foot slides back)
        const st = (legPh - 0.5) / 0.5;
        x = P.stride / 2 - st * P.stride;
        z = P.squat;
      }
      const [hipPitch, knee, ankle] = this._legIK(x, z);
      const roll = P.sway * Math.sin(2 * Math.PI * ph) * (s === 'left' ? +1 : -1);

      let r;
      r = this._apply(d.hip_pitch, this.SIGN.hip_pitch * hipPitch); if (r[0]) acc[r[0]] = r[1];
      r = this._apply(d.knee,      this.SIGN.knee * knee);          if (r[0]) acc[r[0]] = r[1];
      r = this._apply(d.ankle,     this.SIGN.ankle * ankle);        if (r[0]) acc[r[0]] = r[1];
      r = this._apply(d.hip_roll,  this.SIGN.hip_roll * roll);      if (r[0]) acc[r[0]] = r[1];
      // 6-DOF leg (G1): level foot laterally against hip_roll tilt
      if (d.ankle_roll) {
        r = this._apply(d.ankle_roll, this.SIGN.ankle_roll * (-P.ankleRollGain * roll));
        if (r[0]) acc[r[0]] = r[1];
      }
      if (d.hip_yaw) { r = this._apply(d.hip_yaw, 0); if (r[0]) acc[r[0]] = r[1]; }
    }

    // antiphase arm swing
    const arm = P.armSwing * Math.sin(2 * Math.PI * ph);
    let r;
    r = this._apply(this.detected.left.shoulder,  this.SIGN.shoulder * arm);  if (r[0]) acc[r[0]] = r[1];
    r = this._apply(this.detected.right.shoulder, this.SIGN.shoulder * -arm); if (r[0]) acc[r[0]] = r[1];

    return acc;
  }

  _tick(now) {
    if (!this.running) return;
    const t = (now - this.t0) / 1000 * this.params.speed;
    const acc = this._frame(t);
    // throttled React sync
    if (now - this.lastSync >= this.syncInterval) {
      this.lastSync = now;
      this.onSync(acc);
    }
    this.rafId = requestAnimationFrame(this._tick);
  }

  start() {
    if (this.running) return;
    if (!this.detected) this.detect();
    this.running = true;
    this.t0 = performance.now();
    this.lastSync = 0;
    this.rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // smoothly return legs to neutral (straight-ish standing) and sync
  reset() {
    this.stop();
    if (!this.detected) return;
    const acc = {};
    const all = ['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle', 'ankle_roll', 'shoulder'];
    for (const s of ['left', 'right'])
      for (const k of all) {
        const nm = this.detected[s][k];
        if (nm) { this.updateJoint(nm, 0); acc[nm] = 0; }
      }
    this.onSync(acc);
  }

  setParam(key, val) { if (key in this.params) this.params[key] = val; }
  setSign(key, val)  { if (key in this.SIGN) this.SIGN[key] = val; }
  isRunning() { return this.running; }
}
