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

  // ─── RAF frame ───
  _loop = () => {
    const now = performance.now() / 1000;
    if (!this.t0) this.t0 = now;
    const t = (now - this.t0) * this.params.speed;

    // 1) blend cur -> tgt
    if (this.blending) {
      const k = ease((now - this.blendStart) / Math.max(0.05, this.params.blend));
      for (const c of Object.keys(this.cur)) this.cur[c] = lerp(this.from[c], this.tgt[c], k);
      if (k >= 1) this.blending = false;
    }

    // 2) idle micro-motion layered on top (breathing + slow saccade)
    const out = {};
    const g = this.params.gain;
    for (const c of Object.keys(this.cur)) out[c] = this.cur[c] * g;
    if (this.idleOn && this.params.idle > 0) {
      const a = this.params.idle;
      out.pitch   += a * 0.30 * Math.sin(t * 0.9);
      out.eyePan  += a * 0.45 * Math.sin(t * 0.37 + 1.3);
      out.eyeTilt += a * 0.25 * Math.sin(t * 0.53);
      out.roll    += a * 0.15 * Math.sin(t * 0.21);
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
