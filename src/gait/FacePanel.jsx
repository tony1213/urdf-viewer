// ─── Face expression panel ───────────────────────────────────
// Shows the expression joints detected in the URDF, a grid of preset buttons,
// and an idle (auto-blink + saccade) toggle. Mirrors GaitPanel's structure.
import { useEffect, useRef, useState } from "react";
import { FaceEngine, FACE_PRESETS } from "./FaceEngine";
import { extractFaceParams } from "./faceParams";

export default function FacePanel({ jointObjs, onTick, onCommit, lang, C, robotKey }) {
  const zh = lang === "zh";
  const engineRef = useRef(null);
  const [params, setParams] = useState(null);
  const [sel, setSel] = useState("neutral");
  const [idle, setIdle] = useState(true);

  useEffect(() => {
    const p = extractFaceParams(jointObjs);
    setParams(p);
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    if (p) {
      const e = new FaceEngine({ jointObjs, params: p, onTick, onCommit });
      engineRef.current = e;
      e.setPreset("neutral");
      e.start();
      setSel("neutral"); setIdle(true);
    }
    return () => { if (engineRef.current) engineRef.current.stop(); };
  }, [jointObjs, robotKey]);

  if (!params) {
    return (
      <Card C={C}><Title C={C} zh={zh} />
        <div style={{ fontSize: 11, color: "#f97316", lineHeight: 1.5 }}>
          {zh ? "未在该 URDF 中检测到可动的眼部关节。" : "No movable eye joints found in this URDF."}
        </div>
      </Card>
    );
  }

  const e = engineRef.current;
  const pick = (k) => { setSel(k); e && e.setPreset(k); };
  const toggleIdle = () => { const v = !idle; setIdle(v); e && e.setIdle(v); };
  const h = params.has;
  const parts = [
    h.eyesPan && (zh ? "眼(左右)" : "eye-pan"),
    h.eyesTilt && (zh ? "眼(上下)" : "eye-tilt"),
    h.lid && (zh ? "眼睑" : "lid"),
    h.jaw && (zh ? "下巴" : "jaw"),
    h.brow && (zh ? "眉" : "brow"),
    h.mouth && (zh ? "嘴" : "mouth"),
    (h.headPan || h.headTilt) && (zh ? "头" : "head"),
  ].filter(Boolean);

  return (
    <Card C={C}><Title C={C} zh={zh} />
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "6px 8px", marginBottom: 9 }}>
        <div style={{ fontSize: 8.5, color: C.dim, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {zh ? "URDF 表情关节" : "URDF face joints"}
        </div>
        <div style={{ fontSize: 10, color: C.text, lineHeight: 1.6 }}>
          {params.count} {zh ? "个" : "joints"} · {parts.join(" · ")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 9 }}>
        {Object.keys(FACE_PRESETS).map((k) => {
          const on = sel === k; const P = FACE_PRESETS[k];
          return (
            <button key={k} onClick={() => pick(k)}
              style={{ padding: "7px 4px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: on ? 700 : 500,
                background: on ? C.accent : C.bg, color: on ? "#fff" : C.text,
                border: `1px solid ${on ? C.accent : C.border}`, transition: "all 0.12s" }}>
              {P.label[zh ? "zh" : "en"]}
            </button>
          );
        })}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: C.dim, cursor: "pointer", marginBottom: 4 }}>
        <input type="checkbox" checked={idle} onChange={toggleIdle} style={{ cursor: "pointer" }} />
        {zh ? "生动模式（自动眨眼 + 眼球扫视）" : "Liveliness (auto-blink + saccade)"}
      </label>
      <div style={{ fontSize: 8.5, color: C.dim, lineHeight: 1.5, marginTop: 2 }}>
        {zh ? "表情值按各关节的 URDF 限位归一化映射，自动适配不同机器人。"
            : "Expression values are normalized into each joint's URDF limits — adapts to any robot."}
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
    <span style={{ color: "#a855f7", fontSize: 9 }}>●</span>{zh ? "人脸表情" : "Face Expression"}
  </div>
);
