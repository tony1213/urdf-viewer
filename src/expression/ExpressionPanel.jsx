/**
 * ExpressionPanel.jsx — Floating control panel for the head expression engine.
 * Pure UI: lazily builds an ExpressionEngine, renders an expression button grid
 * plus live channel sliders. Styling mirrors GaitPanel / RobotViewer dark panels.
 *
 * Props (identical contract to GaitPanel):
 *   jointObjs   : { name: THREE.Object3D }  — current robot's joints
 *   updateJoint : (name, val) => void       — viewer's quaternion writer
 *   onSync      : (acc) => void             — optional external readback hook
 *   accent      : accent color (default InMoov-ish violet)
 *   lang        : 'zh' | 'en'
 *   C           : theme object { panel, text, dim, border }
 *   library     : optional expressions JSON (falls back to built-in)
 */
import React, { useState, useEffect, useRef } from 'react';
import { ExpressionEngine } from './ExpressionEngine';
import DEFAULT_LIB from './expressions.json';

// channel sliders (normalized units). jaw is one-directional [0,1].
const SLIDERS = [
  { key: 'eyePan',  label: { zh: '眼-水平', en: 'Eye pan' },  min: -1, max: 1, step: 0.02 },
  { key: 'eyeTilt', label: { zh: '眼-垂直', en: 'Eye tilt' }, min: -1, max: 1, step: 0.02 },
  { key: 'jaw',     label: { zh: '下颌',    en: 'Jaw' },      min: 0,  max: 1, step: 0.02 },
  { key: 'yaw',     label: { zh: '头-转向', en: 'Head yaw' }, min: -1, max: 1, step: 0.02 },
  { key: 'pitch',   label: { zh: '头-俯仰', en: 'Pitch' },    min: -1, max: 1, step: 0.02 },
  { key: 'roll',    label: { zh: '头-歪斜', en: 'Roll' },     min: -1, max: 1, step: 0.02 },
];

const PARAM_SLIDERS = [
  { key: 'blend', label: { zh: '过渡 (s)', en: 'Blend (s)' }, min: 0.05, max: 1.2, step: 0.05 },
  { key: 'idle',  label: { zh: '微动幅度', en: 'Idle amp' },  min: 0.0,  max: 0.3, step: 0.01 },
  { key: 'gain',  label: { zh: '强度 ×',   en: 'Intensity ×' }, min: 0.3, max: 1.5, step: 0.05 },
  { key: 'speed', label: { zh: '速度 ×',   en: 'Speed ×' },   min: 0.3,  max: 2.0, step: 0.1 },
];

export default function ExpressionPanel({
  jointObjs, updateJoint, onSync,
  accent = '#a855f7', lang = 'zh', C, library,
}) {
  const lib = library || DEFAULT_LIB;
  const engineRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState(null);
  const [active, setActive] = useState('neutral');
  const [collapsed, setCollapsed] = useState(false);
  const [idleOn, setIdleOn] = useState(true);
  const [chan, setChan] = useState({ eyePan: 0, eyeTilt: 0, jaw: 0, yaw: 0, pitch: 0, roll: 0 });
  const [params, setParams] = useState({ blend: 0.45, idle: 0.12, gain: 1.0, speed: 1.0 });

  // sync callback: update slider readback from engine's live channels
  const sync = useRef((acc) => {
    if (acc && acc._channels) {
      setChan({
        eyePan: acc._channels.eyePan ?? 0, eyeTilt: acc._channels.eyeTilt ?? 0,
        jaw: acc._channels.jaw ?? 0, yaw: acc._channels.yaw ?? 0,
        pitch: acc._channels.pitch ?? 0, roll: acc._channels.roll ?? 0,
      });
    }
    onSync && onSync(acc);
  });

  // lazily construct engine; refresh refs on robot reload
  useEffect(() => {
    if (!engineRef.current) {
      engineRef.current = new ExpressionEngine({ jointObjs, updateJoint, onSync: (a) => sync.current(a) });
    } else {
      engineRef.current.jointObjs = jointObjs;
      engineRef.current.updateJoint = updateJoint;
      engineRef.current.detected = null; // force re-detect for new robot
    }
  }, [jointObjs, updateJoint]);

  useEffect(() => () => { engineRef.current && engineRef.current.stop(); }, []);

  const t = (o) => (lang === 'en' ? o.en : o.zh);
  const bg = (C && C.panel) || '#1a1a1a';
  const fg = (C && C.text) || '#eee';
  const dim = (C && C.dim) || '#888';
  const border = (C && C.border) || '#333';

  const detect = () => { const e = engineRef.current; if (e) setInfo(e.detect()); };

  const pickExpression = (name) => {
    const e = engineRef.current;
    if (!e) return;
    if (!e.detected) { const d = e.detect(); setInfo(d); if (!d.ok) return; }
    e.setExpression(name, lib);
    setActive(name);
    setRunning(true);
  };

  const toggleRun = () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.isRunning()) { e.stop(); setRunning(false); }
    else { const d = e.detect(); setInfo(d); if (!d.ok) return; e.start(); setRunning(true); }
  };

  const doReset = () => {
    const e = engineRef.current;
    if (!e) return;
    e.reset();
    setRunning(false);
    setActive('neutral');
    setChan({ eyePan: 0, eyeTilt: 0, jaw: 0, yaw: 0, pitch: 0, roll: 0 });
  };

  const onChan = (key, v) => {
    const num = parseFloat(v);
    setChan((p) => ({ ...p, [key]: num }));
    engineRef.current && engineRef.current.setChannel(key, num);
  };

  const onParam = (key, v) => {
    const num = parseFloat(v);
    setParams((p) => ({ ...p, [key]: num }));
    engineRef.current && engineRef.current.setParam(key, num);
  };

  const toggleIdle = () => {
    const next = !idleOn;
    setIdleOn(next);
    engineRef.current && engineRef.current.setIdle(next);
  };

  // expression keys + bilingual labels from the library
  const exprKeys = Object.keys(lib.expressions || {});
  const exprLabel = (k) => {
    const e = lib.expressions[k];
    return lang === 'en' ? k : (e && e.label_zh) || k;
  };

  return (
    <div style={{
      position: 'absolute', left: 16, bottom: 16, width: 256,
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
          🙂 {lang === 'en' ? 'Expression Engine' : '表情引擎'}
        </span>
        <span style={{ color: dim }}>{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '10px 12px 12px' }}>
          {/* run / reset */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              onClick={toggleRun}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: running ? '#cc3333' : accent, color: '#fff', fontWeight: 600, fontSize: 11,
              }}>
              {running ? (lang === 'en' ? '■ Stop' : '■ 停止') : (lang === 'en' ? '▶ Start' : '▶ 启动')}
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
              info.ok ? (
                <div style={{ color: '#4caf50', fontSize: 10, lineHeight: 1.5 }}>
                  ✓ {lang === 'en' ? 'Head joints' : '头部关节'}: {info.count}/8
                </div>
              ) : (
                <div style={{ color: '#e57373', fontSize: 10 }}>
                  ✗ {lang === 'en' ? `Only ${info.count}/8 head joints` : `仅检测到 ${info.count}/8 关节`}
                </div>
              )
            ) : (
              <div onClick={detect} style={{ color: dim, fontSize: 10, cursor: 'pointer', textDecoration: 'underline' }}>
                {lang === 'en' ? 'detect joints' : '检测关节'}
              </div>
            )}
          </div>

          {/* expression grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 10,
          }}>
            {exprKeys.map((k) => (
              <button
                key={k}
                onClick={() => pickExpression(k)}
                style={{
                  padding: '6px 2px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                  border: `1px solid ${active === k ? accent : border}`,
                  background: active === k ? `${accent}33` : 'transparent',
                  color: active === k ? fg : dim, fontWeight: active === k ? 600 : 400,
                  transition: 'all .12s',
                }}>
                {exprLabel(k)}
              </button>
            ))}
          </div>

          {/* idle toggle */}
          <div
            onClick={toggleIdle}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
              cursor: 'pointer', userSelect: 'none',
            }}>
            <div style={{
              width: 28, height: 16, borderRadius: 8, padding: 2, transition: 'background .15s',
              background: idleOn ? accent : border,
            }}>
              <div style={{
                width: 12, height: 12, borderRadius: 6, background: '#fff',
                transform: idleOn ? 'translateX(12px)' : 'translateX(0)', transition: 'transform .15s',
              }} />
            </div>
            <span style={{ color: dim, fontSize: 10 }}>
              {lang === 'en' ? 'Idle micro-motion (breathing/saccade)' : '空闲微动（呼吸/眼动）'}
            </span>
          </div>

          {/* channel sliders */}
          <div style={{ fontSize: 9, color: dim, marginBottom: 4, letterSpacing: 0.3 }}>
            {lang === 'en' ? 'CHANNELS' : '通道微调'}
          </div>
          {SLIDERS.map((s) => (
            <div key={s.key} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: dim }}>{t(s.label)}</span>
                <span style={{ color: fg, fontVariantNumeric: 'tabular-nums' }}>
                  {(chan[s.key] ?? 0).toFixed(2)}
                </span>
              </div>
              <input
                type="range" min={s.min} max={s.max} step={s.step} value={chan[s.key] ?? 0}
                onChange={(e) => onChan(s.key, e.target.value)}
                style={{ width: '100%', accentColor: accent, height: 4, cursor: 'pointer' }}
              />
            </div>
          ))}

          {/* engine params */}
          <div style={{ fontSize: 9, color: dim, margin: '8px 0 4px', letterSpacing: 0.3 }}>
            {lang === 'en' ? 'ENGINE' : '引擎参数'}
          </div>
          {PARAM_SLIDERS.map((s) => (
            <div key={s.key} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ color: dim }}>{t(s.label)}</span>
                <span style={{ color: fg, fontVariantNumeric: 'tabular-nums' }}>
                  {params[s.key].toFixed(s.step < 0.1 ? 2 : 1)}
                </span>
              </div>
              <input
                type="range" min={s.min} max={s.max} step={s.step} value={params[s.key]}
                onChange={(e) => onParam(s.key, e.target.value)}
                style={{ width: '100%', accentColor: accent, height: 4, cursor: 'pointer' }}
              />
            </div>
          ))}

          <div style={{ marginTop: 6, fontSize: 9, color: dim, lineHeight: 1.4 }}>
            {lang === 'en'
              ? 'InMoov head: 8 DOF, no brows/lids. If a channel moves backward, flip SIGN in ExpressionEngine.'
              : 'InMoov 头：8 自由度，无眉/眼睑。通道方向反了就改 ExpressionEngine 的 SIGN 表。'}
          </div>
        </div>
      )}
    </div>
  );
}
