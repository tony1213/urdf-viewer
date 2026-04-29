/**
 * TrajectoryPlayer.jsx
 * 轨迹播放控制栏 UI 组件
 * 纯展示 + 回调，不持有任何播放状态
 */

import { useRef } from 'react';
import { PlayState } from './useTrajectory.js';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return m > 0 ? `${m}:${sec}` : `${sec}s`;
}

export default function TrajectoryPlayer({
  // State
  playState, currentTime, duration, speed, loop, error, metadata,
  // Actions
  onPlay, onPause, onStop, onSeek, onSpeedChange, onLoopToggle, onUnload,
  // File loading
  onFileLoad,
  // Theme
  C, lang,
}) {
  const fileRef = useRef(null);
  const isIdle    = playState === PlayState.IDLE;
  const isLoaded  = playState === PlayState.LOADED;
  const isPlaying = playState === PlayState.PLAYING;
  const isPaused  = playState === PlayState.PAUSED;
  const hasTrack  = isLoaded || isPlaying || isPaused;
  const progress  = duration > 0 ? currentTime / duration : 0;

  const accent  = C?.accent  || '#22d3ee';
  const dim     = C?.dim     || '#64748b';
  const text    = C?.text    || '#e2e8f0';
  const panel   = C?.panel   || '#111827';
  const border  = C?.border  || '#1e293b';
  const bg      = C?.bg      || '#0a0e17';
  const danger  = C?.danger  || '#f43f5e';

  const btnBase = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: text, padding: '4px 8px', borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16, lineHeight: 1,
  };
  const btnDisabled = { ...btnBase, color: dim, cursor: 'default', opacity: 0.4 };

  return (
    <div style={{
      position: 'absolute', bottom: 44, left: '50%', transform: 'translateX(-50%)',
      zIndex: 25, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      minWidth: 420, maxWidth: 620,
    }}>
      {/* Error message */}
      {error && (
        <div style={{ background: `${danger}22`, border: `1px solid ${danger}`, borderRadius: 8, padding: '6px 14px', fontSize: 11, color: danger }}>
          ⚠ {error}
        </div>
      )}

      {/* Main player bar */}
      <div style={{
        background: `${panel}f0`, border: `1px solid ${border}`, borderRadius: 12,
        padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6,
        backdropFilter: 'blur(8px)', boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
        width: '100%',
      }}>

        {/* Top row: file info + unload */}
        {hasTrack && metadata && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: dim }}>
            <span style={{ fontWeight: 600, color: accent }}>🎞 {metadata.robot}</span>
            <span>{metadata.frameCount} frames · {metadata.fps}fps · {fmt(duration)}</span>
            <button onClick={onUnload} style={{ ...btnBase, fontSize: 11, color: dim, padding: '2px 6px' }}>✕</button>
          </div>
        )}

        {/* Progress bar */}
        {hasTrack && (
          <div style={{ position: 'relative', height: 6, cursor: 'pointer' }}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSeek(ratio * duration);
            }}
          >
            <div style={{ position: 'absolute', inset: 0, borderRadius: 3, background: border }} />
            <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${progress * 100}%`, borderRadius: 3, background: accent, transition: 'width 0.05s' }} />
            {/* Draggable thumb */}
            <input type="range" min={0} max={duration || 1} step={0.001} value={currentTime}
              onChange={e => onSeek(+e.target.value)}
              style={{ position: 'absolute', inset: 0, width: '100%', opacity: 0, cursor: 'pointer', height: '100%' }}
            />
          </div>
        )}

        {/* Controls row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>

          {/* File load button */}
          <button onClick={() => fileRef.current?.click()}
            style={{ ...btnBase, fontSize: 12, color: accent, border: `1px solid ${accent}44`, padding: '4px 10px', background: `${accent}11` }}>
            {lang === 'zh' ? '📂 加载轨迹' : '📂 Load'}
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { onFileLoad(f); e.target.value = ''; } }}
          />

          <div style={{ flex: 1 }} />

          {/* Transport buttons */}
          <button onClick={onStop} disabled={!hasTrack} style={hasTrack ? btnBase : btnDisabled} title={lang === 'zh' ? '回到开始' : 'Stop'}>⏮</button>

          <button
            onClick={isPlaying ? onPause : onPlay}
            disabled={!hasTrack}
            style={{
              ...(!hasTrack ? btnDisabled : { ...btnBase, background: `${accent}22`, color: accent, border: `1px solid ${accent}44`, borderRadius: 8, padding: '6px 14px', fontSize: 20 }),
            }}
            title={isPlaying ? (lang === 'zh' ? '暂停' : 'Pause') : (lang === 'zh' ? '播放' : 'Play')}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          {/* Time display */}
          {hasTrack && (
            <span style={{ fontSize: 11, color: text, fontFamily: 'monospace', minWidth: 90, textAlign: 'center' }}>
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Speed selector */}
          <div style={{ display: 'flex', gap: 2 }}>
            {SPEEDS.map(s => (
              <button key={s} onClick={() => onSpeedChange(s)}
                style={{ ...btnBase, fontSize: 10, padding: '3px 6px', fontWeight: s === speed ? 700 : 400, color: s === speed ? accent : dim, background: s === speed ? `${accent}15` : 'none', border: `1px solid ${s === speed ? accent + '66' : 'transparent'}`, borderRadius: 4 }}>
                {s}x
              </button>
            ))}
          </div>

          {/* Loop toggle */}
          <button onClick={onLoopToggle}
            style={{ ...btnBase, fontSize: 13, color: loop ? accent : dim, border: `1px solid ${loop ? accent + '66' : 'transparent'}`, background: loop ? `${accent}15` : 'none', borderRadius: 6 }}
            title={lang === 'zh' ? '循环播放' : 'Loop'}>
            🔁
          </button>
        </div>

        {/* Drag hint when idle */}
        {isIdle && (
          <div style={{ textAlign: 'center', fontSize: 10, color: dim, paddingBottom: 2 }}>
            {lang === 'zh' ? '点击「加载轨迹」或拖入 .json 文件' : 'Click Load or drag a .json file'}
          </div>
        )}
      </div>
    </div>
  );
}
