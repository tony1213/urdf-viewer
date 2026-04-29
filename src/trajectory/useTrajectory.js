/**
 * useTrajectory.js
 * 轨迹播放状态机 + 定时器管理
 *
 * 状态机：
 *   IDLE → LOADED → PLAYING ⇌ PAUSED
 *                      ↓
 *                   STOPPED → LOADED
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { getJointsAtTime } from './interpolate.js';
import { parseTrajectoryFile } from './trajectoryParser.js';

export const PlayState = {
  IDLE:    'IDLE',
  LOADED:  'LOADED',
  PLAYING: 'PLAYING',
  PAUSED:  'PAUSED',
};

/**
 * @param {{ onJointUpdate: (name: string, value: number) => void }} options
 */
export function useTrajectory({ onJointUpdate }) {
  const [playState, setPlayState]     = useState(PlayState.IDLE);
  const [trajectory, setTrajectory]   = useState(null);   // parsed trajectory object
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState]        = useState(1);
  const [loop, setLoop]               = useState(false);
  const [error, setError]             = useState(null);

  // Refs for use inside requestAnimationFrame callback
  const rafRef        = useRef(null);
  const lastTimestamp = useRef(null);
  const currentTimeRef= useRef(0);
  const speedRef      = useRef(1);
  const loopRef       = useRef(false);
  const trajRef       = useRef(null);
  const playStateRef  = useRef(PlayState.IDLE);

  // Keep refs in sync with state
  useEffect(() => { speedRef.current = speed; },      [speed]);
  useEffect(() => { loopRef.current = loop; },        [loop]);
  useEffect(() => { trajRef.current = trajectory; },  [trajectory]);
  useEffect(() => { playStateRef.current = playState; }, [playState]);

  /** Push joint values to Three.js scene */
  const applyFrame = useCallback((t) => {
    const traj = trajRef.current;
    if (!traj) return;
    const joints = getJointsAtTime(traj.frames, t);
    for (const [name, value] of Object.entries(joints)) {
      onJointUpdate(name, value);
    }
  }, [onJointUpdate]);

  /** Animation loop tick */
  const tick = useCallback((timestamp) => {
    if (playStateRef.current !== PlayState.PLAYING) return;

    if (lastTimestamp.current === null) {
      lastTimestamp.current = timestamp;
    }

    const elapsed = (timestamp - lastTimestamp.current) / 1000; // seconds
    lastTimestamp.current = timestamp;

    const traj = trajRef.current;
    if (!traj) return;

    let t = currentTimeRef.current + elapsed * speedRef.current;

    if (t >= traj.metadata.duration) {
      if (loopRef.current) {
        t = t % traj.metadata.duration;
      } else {
        t = traj.metadata.duration;
        applyFrame(t);
        currentTimeRef.current = t;
        setCurrentTime(t);
        setPlayState(PlayState.PAUSED);
        lastTimestamp.current = null;
        return;
      }
    }

    currentTimeRef.current = t;
    setCurrentTime(t);
    applyFrame(t);

    rafRef.current = requestAnimationFrame(tick);
  }, [applyFrame]);

  /** Load trajectory from File object */
  const load = useCallback(async (file) => {
    try {
      setError(null);
      const traj = await parseTrajectoryFile(file);
      setTrajectory(traj);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      setPlayState(PlayState.LOADED);
      // Apply first frame immediately
      const joints = getJointsAtTime(traj.frames, 0);
      for (const [name, value] of Object.entries(joints)) {
        onJointUpdate(name, value);
      }
    } catch (e) {
      setError(e.message);
      setPlayState(PlayState.IDLE);
    }
  }, [onJointUpdate]);

  /** Load from parsed trajectory object directly */
  const loadParsed = useCallback((traj) => {
    setError(null);
    setTrajectory(traj);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setPlayState(PlayState.LOADED);
    const joints = getJointsAtTime(traj.frames, 0);
    for (const [name, value] of Object.entries(joints)) {
      onJointUpdate(name, value);
    }
  }, [onJointUpdate]);

  const play = useCallback(() => {
    if (!trajRef.current) return;
    // If at end, restart
    if (currentTimeRef.current >= trajRef.current.metadata.duration) {
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }
    lastTimestamp.current = null;
    setPlayState(PlayState.PLAYING);
  }, []);

  const pause = useCallback(() => {
    if (playStateRef.current === PlayState.PLAYING) {
      setPlayState(PlayState.PAUSED);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTimestamp.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTimestamp.current = null;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setPlayState(PlayState.LOADED);
    if (trajRef.current) applyFrame(0);
  }, [applyFrame]);

  const unload = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTimestamp.current = null;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setTrajectory(null);
    setPlayState(PlayState.IDLE);
    setError(null);
  }, []);

  /** Seek to a specific time (0 ~ duration) */
  const seek = useCallback((t) => {
    const traj = trajRef.current;
    if (!traj) return;
    const clamped = Math.max(0, Math.min(traj.metadata.duration, t));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    applyFrame(clamped);
  }, [applyFrame]);

  const setSpeed = useCallback((v) => {
    setSpeedState(v);
    speedRef.current = v;
  }, []);

  // Start / stop RAF when playState changes to PLAYING / not PLAYING
  useEffect(() => {
    if (playState === PlayState.PLAYING) {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    } else {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playState, tick]);

  return {
    // State
    playState,
    trajectory,
    currentTime,
    duration: trajectory?.metadata.duration ?? 0,
    speed,
    loop,
    error,
    jointNames: trajectory?.jointNames ?? [],
    metadata: trajectory?.metadata ?? null,
    // Actions
    load,
    loadParsed,
    play,
    pause,
    stop,
    unload,
    seek,
    setSpeed,
    setLoop,
  };
}
