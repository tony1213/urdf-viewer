/**
 * GaitPanel.jsx — Floating control panel for the real-time gait engine.
 * Pure UI: receives engine instance + visibility, renders start/stop + live sliders.
 * Styling mirrors RobotViewer's dark panels and accent color.
 */
import React, { useState, useEffect, useRef } from 'react';
import { GaitEngine } from './GaitEngine';

const SLIDERS = [
  { key: 'period',   label: { zh: '周期 (s)',   en: 'Period (s)' },   min: 0.5,  max: 2.5,  step: 0.05 },
  { key: 'stride',   label: { zh: '步长 (m)',   en: 'Stride (m)' },   min: 0.05, max: 0.40, step: 0.01 },
  { key: 'lift',     label: { zh: '抬脚 (m)',   en: 'Lift (m)' },     min: 0.0,  max: 0.15, step: 0.005 },
  { key: 'squat',    label: { zh: '站高 (m)',   en: 'Squat (m)' },    min: 0.55, max: 0.79, step: 0.01 },
  { key: 'sway',     label: { zh: '侧摆 (rad)', en: 'Sway (rad)' },   min: 0.0,  max: 0.20, step: 0.01 },
  { key: 'armSwing', label: { zh: '摆臂 (rad)', en: 'Arm (rad)' },    min: 0.0,  max: 0.60, step: 0.01 },
  { key: 'speed',    label: { zh: '速度 ×',     en: 'Speed ×' },      min: 0.2,  max: 2.0,  step: 0.1 },
];

export default function GaitPanel({ jointObjs, updateJoint, onSync, accent = '#ff8800', lang = 'zh', C }) {
  const engineRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState(null);          // detection result
  const [vals, setVals] = useState({
    period: 1.1, stride: 0.18, lift: 0.05, squat: 0.75, sway: 0.05, armSwing: 0.25, speed: 1.0,
  });
  const [collapsed, setCollapsed] = useState(false);

  // lazily construct engine once joints exist
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new GaitEngine({ jointObjs, updateJoint, onSync });
    } else {
      // keep references fresh on robot reload
      engineRef.current.jointObjs = jointObjs;
      engineRef.current.updateJoint = updateJoint;
      engineRef.current.onSync = onSync;
      engineRef.current.detected = null; // force re-detect for new robot
    }
  }, [jointObjs, updateJoint, onSync]);

  useEffect(() => () => { engineRef.current && engineRef.current.stop(); }, []);

  const t = (o) => (lang === 'en' ? o.en : o.zh);
  const bg = (C && C.panel) || '#1a1a1a';
  const fg = (C && C.text) || '#eee';
  const dim = (C && C.dim) || '#888';
  const border = (C && C.border) || '#333';

  const toggle = () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.isRunning()) {
      e.stop();
      setRunning(false);
    } else {
      const det = e.detect();
      setInfo(det);
      if (det.legJointCount === 0) return; // nothing to drive
      // auto-fit standing height to detected leg length (G1 legs are shorter than H1)
      const legMax = det.L1 + det.L2;
      const fitSquat = Math.max(0.30, Math.min(0.79, legMax * 0.85));
      e.setParam('squat', fitSquat);
      // scale stride/lift to leg size too
      const fitStride = Math.max(0.08, Math.min(0.25, legMax * 0.30));
      const fitLift = Math.max(0.03, Math.min(0.08, legMax * 0.08));
      e.setParam('stride', fitStride);
      e.setParam('lift', fitLift);
      setVals((p) => ({ ...p, squat: +fitSquat.toFixed(2), stride: +fitStride.toFixed(2), lift: +fitLift.toFixed(3) }));
      e.start();
      setRunning(true);
    }
  };

  const doReset = () => {
    const e = engineRef.current;
    if (!e) return;
    e.reset();
    setRunning(false);
  };

  const onSlide = (key, v) => {
    const num = parseFloat(v);
    setVals((p) => ({ ...p, [key]: num }));
    engineRef.current && engineRef.current.setParam(key, num);
  };

  const detect = () => {
    const e = engineRef.current;
    if (e) setInfo(e.detect());
  };

  return (
    <div style={{
      position: 'absolute', right: 16, bottom: 16, width: 248,
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      boxShadow: '0 6px 24px rgba(0,0,0,0.4)', color: fg, fontSize: 11,
      zIndex: 50, overflow: 'hidden', fontFamily: 'system-ui, sans-serif',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', cursor: 'pointer', borderBottom: collapsed ? 'none' : `1px solid ${border}`,
          background: `linear-gradient(90deg, ${accent}22, transparent)`,
        }}>
        <span style={{ fontWeight: 600, letterSpacing: 0.3 }}>
          🦿 {lang === 'en' ? 'Gait Engine' : '步态引擎'}
        </span>
        <span style={{ color: dim }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '10px 12px 12px' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={toggle}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: running ? '#cc3333' : accent, color: '#fff', fontWeight: 600, fontSize: 11,
              }}>
              {running ? (lang === 'en' ? '■ Stop' : '■ 停止') : (lang === 'en' ? '▶ Walk' : '▶ 行走')}
            </button>
            <button
              onClick={doReset}
              style={{
                padding: '7px 10px', borderRadius: 6, border: `1px solid ${border}`,
                background: 'transparent', color: fg, cursor: 'pointer', fontSize: 11,
              }}>
              {lang === 'en' ? 'Reset' : '复位'}
            </button>
          </div>

          {/* detection status */}
          <div style={{ marginBottom: 8 }}>
            {info ? (
              info.legJointCount > 0 ? (
                <div style={{ color: '#4caf50', fontSize: 10, lineHeight: 1.5 }}>
                  ✓ {lang === 'en' ? 'Leg joints' : '腿部关节'}: {info.legJointCount}/6 · L1={info.L1.toFixed(2)} L2={info.L2.toFixed(2)}
                </div>
              ) : (
                <div style={{ color: '#e57373', fontSize: 10 }}>
                  ✗ {lang === 'en' ? 'No leg joints detected' : '未检测到腿部关节'}
                </div>
              )
            ) : (
              <div onClick={detect} style={{ color: dim, fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>
                {lang === 'en' ? 'detect joints' : '检测关节'}
              </div>
            )}
          </div>

          {/* live sliders */}
          {SLIDERS.map((s) => (
            <div key={s.key} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: dim }}>{t(s.label)}</span>
                <span style={{ color: fg, fontVariantNumeric: 'tabular-nums' }}>
                  {vals[s.key].toFixed(s.step < 0.01 ? 3 : 2)}
                </span>
              </div>
              <input
                type="range" min={s.min} max={s.max} step={s.step} value={vals[s.key]}
                onChange={(e) => onSlide(s.key, e.target.value)}
                style={{ width: '100%', accentColor: accent, height: 4, cursor: 'pointer' }}
              />
            </div>
          ))}

          <div style={{ marginTop: 6, fontSize: 9, color: dim, lineHeight: 1.4 }}>
            {lang === 'en'
              ? 'Kinematic gait (no physics). Flip SIGN in GaitEngine if a joint moves backward.'
              : '运动学步态（无物理）。若关节方向反了，改 GaitEngine 的 SIGN 表。'}
          </div>
        </div>
      )}
    </div>
  );
}
