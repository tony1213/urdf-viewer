// ─── Gait control panel ──────────────────────────────────────
// Shows the leg parameters extracted from the URDF (thigh/calf length) up top —
// making it visible that the gait is generated from the robot's real geometry —
// then start/stop + live-tunable sliders whose ranges scale to that leg length.
import { useEffect, useRef, useState } from "react";
import { extractLegParams } from "./legParams";
import { GaitEngine } from "./GaitEngine";

export default function GaitPanel({ jointObjs, onSync, lang, C, robotKey }) {
  const zh = lang === "zh";
  const engineRef = useRef(null);
  const [params, setParams] = useState(null);
  const [running, setRunning] = useState(false);
  const [cfg, setCfg] = useState(null);

  // (re)extract leg params whenever the robot changes
  useEffect(() => {
    const p = extractLegParams(jointObjs);
    setParams(p);
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    if (p) {
      const e = new GaitEngine({ jointObjs, params: p, onSync });
      engineRef.current = e;
      setCfg({ ...e.cfg });
    }
    setRunning(false);
    return () => { if (engineRef.current) engineRef.current.stop(); };
  }, [jointObjs, robotKey]);

  if (!params) {
    return (
      <Card C={C}>
        <Title C={C} zh={zh} />
        <div style={{ fontSize: 11, color: "#f97316", lineHeight: 1.5 }}>
          {zh ? "未在该 URDF 中检测到完整的双腿（需双侧 hip / knee / ankle 关节）。"
              : "No complete legs found in this URDF (need hip / knee / ankle on both sides)."}
        </div>
      </Card>
    );
  }

  const e = engineRef.current;
  const toggle = () => {
    if (!e) return;
    if (running) { e.stop(); setRunning(false); }
    else { e.start(); setRunning(true); }
  };
  const slider = (key, label, min, max, step, fmt) => (
    <div key={key} style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.dim, marginBottom: 2 }}>
        <span>{label}</span><span style={{ color: C.text, fontWeight: 600 }}>{fmt(cfg[key])}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={cfg[key]}
        onChange={(ev) => { const v = +ev.target.value; e.setCfg(key, v); setCfg((c) => ({ ...c, [key]: v })); }}
        style={{ width: "100%", appearance: "none", WebkitAppearance: "none", height: 3, borderRadius: 2, background: C.border, outline: "none", cursor: "pointer" }} />
    </div>
  );

  const m = params.legMax;
  return (
    <Card C={C}>
      <Title C={C} zh={zh} />
      {/* URDF-extracted leg geometry — the basis for the generated gait */}
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", marginBottom: 9 }}>
        <div style={{ fontSize: 8.5, color: C.dim, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {zh ? "URDF 腿部几何" : "URDF leg geometry"}
        </div>
        <Row C={C} k={zh ? "大腿 L1" : "Thigh L1"} v={`${params.L1.toFixed(3)} m`} />
        <Row C={C} k={zh ? "小腿 L2" : "Calf L2"}  v={`${params.L2.toFixed(3)} m`} />
        <Row C={C} k={zh ? "总腿长" : "Total reach"} v={`${m.toFixed(3)} m`} />
        <Row C={C} k={zh ? "自由度/腿" : "DoF/leg"}
             v={`${3 + (params.hasHipRoll ? 1 : 0) + (params.hasHipYaw ? 1 : 0) + (params.hasAnkleRoll ? 1 : 0)}`} />
      </div>
      <button onClick={toggle}
        style={{ width: "100%", padding: "7px 0", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 11, marginBottom: 10,
          background: running ? "#ef444418" : "#22c55e", color: running ? "#ef4444" : "#fff",
          border: running ? "1px solid #ef4444" : "1px solid transparent" }}>
        {running ? (zh ? "■ 停止" : "■ Stop") : (zh ? "▶ 生成并行走" : "▶ Generate & Walk")}
      </button>
      {/* slider ranges scale to leg length */}
      {slider("period", zh ? "周期 (s)" : "Period (s)", 0.5, 2.5, 0.05, (v) => v.toFixed(2) + "s")}
      {slider("stride", zh ? "步长 (m)" : "Stride (m)", 0.02, +(m * 0.5).toFixed(2), 0.01, (v) => v.toFixed(2))}
      {slider("lift",   zh ? "抬脚 (m)" : "Lift (m)",   0.01, +(m * 0.25).toFixed(2), 0.005, (v) => v.toFixed(3))}
      {slider("squat",  zh ? "站高 (m)" : "Squat (m)",  +(m * 0.55).toFixed(2), +(m * 0.98).toFixed(2), 0.005, (v) => v.toFixed(3))}
      {slider("sway",   zh ? "侧摆 (rad)" : "Sway (rad)", 0, 0.25, 0.01, (v) => v.toFixed(2))}
      {slider("speed",  zh ? "速度 ×" : "Speed ×", 0.2, 2.0, 0.1, (v) => v.toFixed(1) + "×")}
      <div style={{ fontSize: 8.5, color: C.dim, lineHeight: 1.5, marginTop: 2 }}>
        {zh ? "站高、步长、抬脚默认按 URDF 腿长生成；关节方向（前摆/屈膝）自动探测，适配不同机器人。"
            : "Squat / stride / lift default to URDF leg length; joint directions are auto-probed per robot."}
      </div>
    </Card>
  );
}

const Card = ({ C, children }) => (
  <div style={{ position: "absolute", top: 16, left: 60, zIndex: 25, width: 208,
    background: `${C.panel}f5`, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{children}</div>
);
const Title = ({ C, zh }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
    <span style={{ color: "#22c55e", fontSize: 9 }}>●</span>{zh ? "步态生成" : "Gait Generator"}
  </div>
);
const Row = ({ C, k, v }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, lineHeight: 1.6 }}>
    <span style={{ color: C.dim }}>{k}</span><span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
  </div>
);
