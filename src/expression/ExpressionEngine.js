/**
 * ExpressionEngine.js — Real-time head/face expression controller for the InMoov head.
 *
 * Mirrors GaitEngine's contract exactly:
 *   constructor({ jointObjs, updateJoint, onSync })
 *     • jointObjs  : { name: THREE.Object3D } with userData.{lower,upper}
 *     • updateJoint(name, val): viewer writes initQuat × setFromAxisAngle(axis,val)
 *     • onSync(acc): throttled UI readback { jointName: radians, ... }
 *   methods: detect() / start() / stop() / reset() / setParam() / isRunning()
 *
 * The InMoov head exposes 8 DOF (NO eyebrow / eyelid / lip-corner). Expression is
 * "acted" with eyes pan/tilt, jaw open, head yaw, neck pitch, neck roll. Dynamic
 * timing (the motion *into* a pose) carries most of the affect, so each expression
 * is blended over time and a subtle idle layer (breathing + saccades) keeps the
 * head alive between poses.
 *
 * Direction conventions live in the SIGN table. After loading the real URDF, if a
 * channel moves the wrong way, flip its sign here — same pattern as GaitEngine.
 */

// ─── SIGN table (per logical channel) ───
const SIGN = {
  eyePan:  +1,  // + -> both eyes pan to robot's left
  eyeTilt: +1,  // + -> eyes look up
  jaw:     +1,  // + -> mouth opens (one-directional: 0..upper)
  yaw:     +1,  // + -> head turns to robot's left
  pitch:   +1,  // + -> chin up / look up
  roll:    +1,  // + -> head tilts toward robot's right shoulder
};

// ─── joint name patterns (InMoov i01.head.*) ───
const PAT = {
  eyeLeftPan:   /eyeleft\.001/i,
  eyeLeftTilt:  /eyeleft(?!\.001)/i,
  eyeRightPan:  /eyeright\.001/i,
  eyeRightTilt: /eyeright(?!\.001)/i,
  jaw:          /\.jaw/i,
  yaw:          /rothead/i,
  pitch:        /neck\.001/i,
  roll:         /rollneck/i,
};

// channels that map to a pair of joints (left+right eyes)
const PAIR = { eyePan: ['eyeLeftPan', 'eyeRightPan'], eyeTilt: ['eyeLeftTilt', 'eyeRightTilt'] };
// channels that map to a single joint
const SOLO = { jaw: 'jaw', yaw: 'yaw', pitch: 'pitch', roll: 'roll' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp  = (a, b, t) => a + (b - a) * t;
const ease  = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)); // smoothstep

export class ExpressionEngine {
  constructor({ jointObjs, updateJoint, onSync }) {
    this.jointObjs = jointObjs;
    this.updateJoint = updateJoint;
    this.onSync = onSync || (() => {});

    // ── tunable params (live-adjustable via setParam) ──
    this.params = {
      blend: 0.45,   // seconds to morph between expressions
      idle:  0.12,   // idle micro-motion amplitude (fraction of range)
      speed: 1.0,    // global time scale
      gain:  1.0,    // overall expression intensity multiplier
      // ── liveliness ──
      blink:    1.0, // blink frequency multiplier (0 = no blinking)
      saccade:  1.0, // eye saccade activity multiplier (0 = steady gaze)
      overshoot:1.0, // motion overshoot/spring intensity (0 = critically damped)
    };

    this.detected = null;        // { map: {channel:name}, count, ok }
    this.running = false;
    this.raf = null;
    this.t0 = 0;
    this.lastSync = 0;

    // normalized channel state (bipolar [-1,1]; jaw [0,1])
    this.cur  = this._zero();
    this.from = this._zero();
    this.tgt  = this._zero();
    this.blendStart = 0;
    this.blending = false;
    this.current = 'neutral';
    this.idleOn = true;

    // ── liveliness runtime state ──
    // spring-smoothed actual output per channel (for overshoot/inertia)
    this.sp  = this._zero();   // spring position
    this.spv = this._zero();   // spring velocity
    // gaze saccade: hold a target, jump to a new one occasionally
    this.gaze = { pan: 0, tilt: 0, tPan: 0, tTilt: 0, next: 0 };
    // blink: scheduled times + current blink phase
    this.blink = { next: 0, t0: -1, dur: 0.12 }; // dur = full blink length (s)
    this.seed = Math.random() * 1000;
  }

  _zero() { return { eyePan: 0, eyeTilt: 0, jaw: 0, yaw: 0, pitch: 0, roll: 0 }; }

  // ─── detect head joints by name pattern ───
  detect() {
    const map = {};
    for (const name of Object.keys(this.jointObjs || {})) {
      for (const [chan, re] of Object.entries(PAT)) {
        if (re.test(name) && !map[chan]) map[chan] = name;
      }
    }
    const count = Object.keys(map).length;
    this.detected = { map, count, ok: count >= 5 };
    return this.detected;
  }

  _lim(name) {
    const o = this.jointObjs[name];
    if (!o || !o.userData) return [-Math.PI, Math.PI];
    const lo = o.userData.lower, hi = o.userData.upper;
    return [lo == null ? -Math.PI : lo, hi == null ? Math.PI : hi];
  }

  // write a normalized channel value to its joint(s) via updateJoint
  _writeChannel(chan, norm, acc) {
    const map = (this.detected && this.detected.map) || {};
    const names = PAIR[chan] ? PAIR[chan] : [SOLO[chan]];
    for (const jc of names) {
      const name = map[jc];
      if (!name) continue;
      const [lo, hi] = this._lim(name);
      const s = SIGN[chan] || 1;
      let ang;
      if (chan === 'jaw') {
        ang = lerp(lo, hi, clamp(norm, 0, 1));         // one-directional
      } else {
        const span = Math.min(Math.abs(lo), Math.abs(hi)); // symmetric usable range
        ang = clamp(s * norm * span, lo, hi);
      }
      this.updateJoint(name, ang);
      if (acc) acc[name] = ang;
    }
  }

  // ─── set a named expression from a library object ───
  setExpression(name, lib) {
    const e = lib && lib.expressions && lib.expressions[name];
    if (!e) return false;
    this.current = name;
    this.from = { ...this.cur };
    this.tgt  = { ...this._zero(), ...e.channels };
    if (e.idle  != null) this.params.idle  = e.idle;
    if (e.blend != null) this.params.blend = e.blend;
    this.blendStart = performance.now() / 1000;
    this.blending = true;
    if (!this.running) this.start();
    return true;
  }

  // pseudo-random in [0,1) from a seed (deterministic, no global RNG churn)
  _rnd(x) { const s = Math.sin(x * 12.9898 + this.seed) * 43758.5453; return s - Math.floor(s); }

  // ─── RAF frame ───
  _loop = () => {
    const now = performance.now() / 1000;
    if (!this.t0) { this.t0 = now; this.gaze.next = now + 1.2; this.blink.next = now + 2.0; }
    const dt = Math.min(0.05, this._prev ? now - this._prev : 0.016);
    this._prev = now;
    const t = (now - this.t0) * this.params.speed;

    // 1) blend cur -> tgt (target setpoint), the spring below adds the life
    if (this.blending) {
      const k = ease((now - this.blendStart) / Math.max(0.05, this.params.blend));
      for (const c of Object.keys(this.cur)) this.cur[c] = lerp(this.from[c], this.tgt[c], k);
      if (k >= 1) this.blending = false;
    }

    // 2) build the raw target = expression setpoint * gain + idle layer
    const g = this.params.gain;
    const raw = {};
    for (const c of Object.keys(this.cur)) raw[c] = this.cur[c] * g;

    if (this.idleOn) {
      // 2a) irregular breathing (sine + slow drift + occasional deeper breath)
      if (this.params.idle > 0) {
        const a = this.params.idle;
        const breathRate = 0.85 + 0.15 * Math.sin(t * 0.11);          // varying rate
        const deep = 1 + 0.4 * this._rnd(Math.floor(t * 0.25));        // occasional deep breath
        raw.pitch += a * 0.30 * deep * Math.sin(t * breathRate);
        raw.roll  += a * 0.12 * Math.sin(t * 0.19 + 0.7);
      }

      // 2b) gaze SACCADE: hold a fixation, jump to a new target abruptly
      if (this.params.saccade > 0) {
        if (now >= this.gaze.next) {
          // pick a new fixation point (biased toward center)
          const r = () => (this._rnd(now * 7.1 + this.gaze.next) - 0.5) * 1.6;
          this.gaze.tPan  = Math.max(-0.9, Math.min(0.9, r()));
          this.gaze.tTilt = Math.max(-0.7, Math.min(0.7, r() * 0.7));
          // next saccade in 0.4–2.2 s (humans saccade ~3×/s when scanning, slower at rest)
          this.gaze.next = now + 0.4 + 1.8 * this._rnd(now * 3.3);
        }
        // saccades are FAST: snap ~90% of the way each frame (≈30–50ms move)
        const snap = 1 - Math.pow(0.0001, dt); // ≈0.7+ per frame at 60fps
        this.gaze.pan  += (this.gaze.tPan  - this.gaze.pan)  * snap;
        this.gaze.tilt += (this.gaze.tTilt - this.gaze.tilt) * snap;
        const sa = 0.55 * this.params.saccade;
        raw.eyePan  += sa * this.gaze.pan;
        raw.eyeTilt += sa * this.gaze.tilt;
      }
    }

    // 3) spring smoothing → inertia + overshoot (the "alive" feel)
    // critically-damped baseline, then dial UNDER-damping via overshoot param
    const out = {};
    const stiff = 180;                                  // spring stiffness
    const ov = this.params.overshoot;
    const damp = 2 * Math.sqrt(stiff) * (1 - 0.45 * Math.min(1, ov)); // <1 ratio = overshoot
    for (const c of Object.keys(raw)) {
      // jaw stays snappy (talking), eyes already saccade-fast: spring the head mostly
      const useSpring = (c === 'pitch' || c === 'roll' || c === 'yaw');
      if (useSpring && ov > 0) {
        const a = stiff * (raw[c] - this.sp[c]) - damp * this.spv[c];
        this.spv[c] += a * dt;
        this.sp[c]  += this.spv[c] * dt;
        out[c] = this.sp[c];
      } else {
        this.sp[c] = raw[c]; this.spv[c] = 0;
        out[c] = raw[c];
      }
    }

    // 4) BLINK: brief eyelid-substitute — snap eyes down+up quickly.
    // (no eyelid joint, so we use a fast eyeTilt dip as the visual blink cue)
    if (this.idleOn && this.params.blink > 0) {
      if (this.blink.t0 < 0 && now >= this.blink.next) {
        this.blink.t0 = now;
        // next blink in 2–6 s, scaled by freq param (humans ~ every 3–5s)
        this.blink.next = now + (2 + 4 * this._rnd(now * 1.7)) / this.params.blink;
      }
      if (this.blink.t0 >= 0) {
        const bt = (now - this.blink.t0) / this.blink.dur;
        if (bt >= 1) { this.blink.t0 = -1; }
        else {
          // down-then-up pulse: sin over [0,π] peaks mid-blink
          const dip = Math.sin(bt * Math.PI);
          out.eyeTilt -= 0.9 * dip;   // drive eyes down hard, briefly
        }
      }
    }

    // 3) write channels
    const acc = {};
    for (const c of Object.keys(out)) this._writeChannel(c, out[c], acc);

    // 4) throttled UI sync (120 ms)
    if (now - this.lastSync > 0.12) {
      this.lastSync = now;
      acc._name = this.current;
      acc._channels = out;
      this.onSync(acc);
    }

    this.raf = requestAnimationFrame(this._loop);
  };

  start() {
    if (this.running) return;
    if (!this.detected) this.detect();
    this.running = true;
    this.t0 = 0;
    this.lastSync = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  reset() {
    this.stop();
    this.cur = this._zero();
    this.tgt = this._zero();
    this.blending = false;
    this.current = 'neutral';
    const acc = {};
    for (const c of Object.keys(this.cur)) this._writeChannel(c, 0, acc);
    acc._name = 'neutral';
    this.onSync(acc);
  }

  // live single-channel override (slider drag)
  setChannel(chan, norm) {
    this.cur[chan] = norm;
    this.tgt[chan] = norm;
    if (!this.running) { const acc = {}; this._writeChannel(chan, norm, acc); this.onSync(acc); }
  }

  setParam(key, val) { if (key in this.params) this.params[key] = val; }
  setIdle(on) { this.idleOn = !!on; }
  isRunning() { return this.running; }
}

export default ExpressionEngine;
