// ─── Face expression engine ──────────────────────────────────
// Animates a robot's expression joints (detected by faceParams) to convey
// presets, with auto-blink and idle eye saccades for liveliness. Expression
// targets are normalized per-channel in [-1,1] and mapped into each joint's
// real URDF travel (mid ± half·value), so nothing exceeds limits and the same
// preset works on any robot regardless of joint ranges or axis signs.
//
// Joints are driven by writing quaternions directly (initQuat·axisAngle — the
// viewer's own convention). Per frame it calls onTick (imperative slider/DOM
// sync, no React re-render → no flicker); onCommit fires once on stop to settle
// React state. Same pattern as GaitEngine.
import * as THREE from "three";

// Each preset is a set of normalized channel targets in [-1,1].
// Channels: eyesTilt(+up) eyesPan(+right) lid(+open/-closed) jaw(+open)
//           brow(+raised) mouth(+smile/-frown) headTilt(+up) headPan(+right)
const PRESETS = {
  neutral:   { label:{zh:"中性",en:"Neutral"},  eyesTilt:0,   lid:0.5,  jaw:-0.6, brow:0,    mouth:0,    headTilt:0 },
  happy:     { label:{zh:"开心",en:"Happy"},    eyesTilt:0.1, lid:0.2,  jaw:0.1,  brow:0.3,  mouth:0.9,  headTilt:0.1 },
  surprised: { label:{zh:"惊讶",en:"Surprised"},eyesTilt:0.3, lid:1.0,  jaw:0.7,  brow:0.9,  mouth:0.2,  headTilt:0.15 },
  angry:     { label:{zh:"生气",en:"Angry"},    eyesTilt:-0.2,lid:0.6,  jaw:-0.3, brow:-0.9, mouth:-0.6, headTilt:-0.2 },
  sad:       { label:{zh:"难过",en:"Sad"},      eyesTilt:-0.4,lid:0.0,  jaw:-0.5, brow:0.4,  mouth:-0.7, headTilt:-0.3 },
  sleepy:    { label:{zh:"困倦",en:"Sleepy"},   eyesTilt:-0.3,lid:-0.7, jaw:-0.2, brow:-0.2, mouth:-0.1, headTilt:-0.25 },
  curious:   { label:{zh:"疑惑",en:"Curious"},  eyesTilt:0.1, lid:0.5,  jaw:-0.5, brow:0.5,  mouth:0.1,  headTilt:0.2, headPan:0.25 },
};
export const FACE_PRESETS = PRESETS;

export class FaceEngine {
  constructor({ jointObjs, params, onTick, onCommit }) {
    this.jointObjs = jointObjs;
    this.params = params;
    this.onTick = onTick || (() => {});
    this.onCommit = onCommit || (() => {});
    this.preset = "neutral";
    this.cur = this._targets("neutral");   // current (animated) channel values
    this.goal = { ...this.cur };           // target channel values
    this.idle = true;                      // idle blink + saccade enabled
    this.running = false; this.raf = 0; this.last = 0;
    this._blink = 0; this._nextBlink = 1.5; this._t = 0;
    this._sacc = { x: 0, y: 0, nx: 0, ny: 0, next: 1.0 }; // eye saccade offsets
    this._q = new THREE.Quaternion();
    this._tick = this._tick.bind(this);
  }
  _targets(name) {
    const p = PRESETS[name] || PRESETS.neutral;
    return { eyesTilt:p.eyesTilt||0, eyesPan:0, lid:p.lid??0.5, jaw:p.jaw||0,
             brow:p.brow||0, mouth:p.mouth||0, headTilt:p.headTilt||0, headPan:p.headPan||0 };
  }
  setPreset(name) { if (PRESETS[name]) { this.preset = name; this.goal = this._targets(name); if (!this.running) this.start(); } }
  setIdle(on) { this.idle = !!on; }
  isRunning() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(this._tick);
  }
  stop() {
    this.running = false;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(this.raf);
    this.raf = 0;
    this._commit();
  }

  // map a normalized [-1,1] channel value into a joint's real travel & write it
  _applyChannel(role, value, out) {
    const arr = this.params.roles[role]; if (!arr) return;
    for (const name of arr) {
      const L = this.params.limits[name]; if (!L) continue;
      // sign: l_/r_ eye pan mirror so eyes converge naturally
      let v = value;
      const lim = L.mid + L.half * Math.max(-1, Math.min(1, v));
      const clamped = Math.max(L.lo, Math.min(L.hi, lim));
      const o = this.jointObjs[name]; if (!o) continue;
      o.userData.value = clamped;
      this._q.setFromAxisAngle(o.userData.axis, clamped);
      o.quaternion.copy(o.userData.initQuat).multiply(this._q);
      out[name] = clamped;
    }
  }

  _writeAll(out) {
    const c = this.cur;
    // eyes tilt + pan (pan includes saccade); lid blink modulates openness
    this._applyChannel("eyes_tilt", c.eyesTilt + this._sacc.y * 0.4, out);
    const blinkLid = c.lid - this._blink * (c.lid + 1); // dip toward closed on blink
    this._applyChannel("lid", blinkLid, out);
    this._applyChannel("eyes_pan", c.eyesPan + this._sacc.x * 0.5, out);
    this._applyChannel("jaw",  c.jaw, out);
    this._applyChannel("brow", c.brow, out);
    this._applyChannel("mouth",c.mouth, out);
    this._applyChannel("head_tilt", c.headTilt, out);
    this._applyChannel("head_pan",  c.headPan, out);
  }

  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now; this._t += dt;
    // ease current channels toward goal (expression blend)
    const k = 1 - Math.pow(0.001, dt); // ~time-constant smoothing
    for (const key in this.cur) this.cur[key] += (this.goal[key] - this.cur[key]) * Math.min(1, k * 3);
    // idle: blink + saccade
    if (this.idle) {
      if (this._t >= this._nextBlink) {
        const ph = (this._t - this._nextBlink) / 0.13;       // ~130ms blink
        this._blink = ph < 1 ? Math.sin(Math.PI * ph) : 0;
        if (ph >= 1) { this._blink = 0; this._nextBlink = this._t + 2 + Math.random() * 3; }
      } else this._blink = 0;
      // saccade: occasional quick eye dart, then ease toward it
      if (this._t >= this._sacc.next) {
        this._sacc.nx = (Math.random() * 2 - 1) * 0.7;
        this._sacc.ny = (Math.random() * 2 - 1) * 0.5;
        this._sacc.next = this._t + 0.8 + Math.random() * 2.5;
      }
      this._sacc.x += (this._sacc.nx - this._sacc.x) * Math.min(1, dt * 12);
      this._sacc.y += (this._sacc.ny - this._sacc.y) * Math.min(1, dt * 12);
    } else { this._blink = 0; this._sacc.x = this._sacc.y = 0; }

    const out = {};
    this._writeAll(out);
    this.onTick(out);
    if (typeof requestAnimationFrame !== "undefined") this.raf = requestAnimationFrame(this._tick);
  }

  // settle to the current preset (no blink/saccade) and push to React state once
  _commit() {
    this._blink = 0; this._sacc.x = this._sacc.y = 0;
    const out = {};
    this._writeAll(out);
    this.onTick(out);
    this.onCommit(out);
  }
}
