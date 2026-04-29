/**
 * useTrajectory.js
 * 轨迹播放状态机 + RAF 定时器
 *
 * 关键设计：tick 存在 tickRef 中，RAF 永远调用 tickRef.current
 * 避免 useCallback 重建导致旧闭包问题
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { getJointsAtTime } from './interpolate.js';
import { parseTrajectoryFile } from './trajectoryParser.js';

export const PlayState = {
  IDLE:'IDLE', LOADED:'LOADED', PLAYING:'PLAYING', PAUSED:'PAUSED',
};

export function useTrajectory({ onJointUpdate }) {
  const [playState, setPlayState]     = useState(PlayState.IDLE);
  const [trajectory, setTrajectory]   = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState]        = useState(1);
  const [loop, setLoop]               = useState(false);
  const [error, setError]             = useState(null);

  const rafRef          = useRef(null);
  const tickRef         = useRef(null);
  const lastTs          = useRef(null);
  const currentTimeRef  = useRef(0);
  const speedRef        = useRef(1);
  const loopRef         = useRef(false);
  const trajRef         = useRef(null);
  const playingRef      = useRef(false);
  const onUpdateRef     = useRef(onJointUpdate);

  useEffect(() => { onUpdateRef.current = onJointUpdate; }, [onJointUpdate]);
  useEffect(() => { speedRef.current = speed; },     [speed]);
  useEffect(() => { loopRef.current  = loop; },      [loop]);
  useEffect(() => { trajRef.current  = trajectory; },[trajectory]);

  const applyAtTime = (t) => {
    const traj = trajRef.current;
    if (!traj) return;
    const joints = getJointsAtTime(traj.frames, t);
    for (const [name, value] of Object.entries(joints)) {
      onUpdateRef.current(name, value);
    }
  };

  // tick stored in ref — RAF always calls tickRef.current(ts)
  tickRef.current = (ts) => {
    if (!playingRef.current) return;
    if (lastTs.current === null) lastTs.current = ts;
    const elapsed = (ts - lastTs.current) / 1000;
    lastTs.current = ts;
    const traj = trajRef.current;
    if (!traj) return;
    let t = currentTimeRef.current + elapsed * speedRef.current;
    if (t >= traj.metadata.duration) {
      if (loopRef.current) {
        t = t % traj.metadata.duration;
      } else {
        t = traj.metadata.duration;
        applyAtTime(t);
        currentTimeRef.current = t;
        setCurrentTime(t);
        playingRef.current = false;
        rafRef.current = null;
        lastTs.current = null;
        setPlayState(PlayState.PAUSED);
        return;
      }
    }
    currentTimeRef.current = t;
    setCurrentTime(t);
    applyAtTime(t);
    rafRef.current = requestAnimationFrame((ts2) => tickRef.current(ts2));
  };

  const startRAF = () => {
    if (rafRef.current) return;
    playingRef.current = true;
    lastTs.current = null;
    rafRef.current = requestAnimationFrame((ts) => tickRef.current(ts));
  };
  const stopRAF = () => {
    playingRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    lastTs.current = null;
  };

  const load = useCallback(async (file) => {
    stopRAF();
    setError(null);
    try {
      const traj = await parseTrajectoryFile(file);
      trajRef.current = traj;
      setTrajectory(traj);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setPlayState(PlayState.LOADED);
      applyAtTime(0);
    } catch (e) {
      setError(e.message);
      setPlayState(PlayState.IDLE);
    }
  }, []); // eslint-disable-line

  const loadParsed = useCallback((traj) => {
    stopRAF();
    trajRef.current = traj;
    setTrajectory(traj);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setPlayState(PlayState.LOADED);
    applyAtTime(0);
  }, []); // eslint-disable-line

  const play = useCallback(() => {
    if (!trajRef.current) return;
    if (currentTimeRef.current >= (trajRef.current.metadata.duration - 0.001)) {
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }
    setPlayState(PlayState.PLAYING);
    startRAF();
  }, []); // eslint-disable-line

  const pause  = useCallback(() => { stopRAF(); setPlayState(PlayState.PAUSED); }, []);
  const stop   = useCallback(() => { stopRAF(); currentTimeRef.current=0; setCurrentTime(0); setPlayState(PlayState.LOADED); applyAtTime(0); }, []); // eslint-disable-line
  const unload = useCallback(() => { stopRAF(); trajRef.current=null; setTrajectory(null); currentTimeRef.current=0; setCurrentTime(0); setPlayState(PlayState.IDLE); setError(null); }, []);
  const seek   = useCallback((t) => {
    const traj = trajRef.current; if (!traj) return;
    const c = Math.max(0, Math.min(traj.metadata.duration, t));
    currentTimeRef.current = c; setCurrentTime(c); applyAtTime(c);
  }, []); // eslint-disable-line
  const setSpeed = useCallback((v) => { setSpeedState(v); speedRef.current = v; }, []);

  useEffect(() => () => stopRAF(), []);

  return {
    playState, trajectory, currentTime,
    duration:   trajectory?.metadata.duration ?? 0,
    speed, loop, error,
    jointNames: trajectory?.jointNames ?? [],
    metadata:   trajectory?.metadata ?? null,
    load, loadParsed, play, pause, stop, unload, seek, setSpeed, setLoop,
  };
}
