/**
 * interpolate.js
 * 轨迹帧间插值算法
 * 纯函数，无副作用
 */

/**
 * 二分查找：找到 time 所在的帧区间 [index, index+1]
 * 返回左帧索引（0 到 frames.length-2）
 */
export function findFrameIndex(frames, time) {
  if (frames.length === 0) return 0;
  if (time <= frames[0].time) return 0;
  if (time >= frames[frames.length - 1].time) return frames.length - 2;

  let lo = 0, hi = frames.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 线性插值两帧之间的关节值
 * @param {object} frameA - 前一帧 { time, joints }
 * @param {object} frameB - 后一帧 { time, joints }
 * @param {number} t      - 目标时间
 * @returns {{ [jointName]: number }}
 */
export function lerpFrame(frameA, frameB, t) {
  const dt = frameB.time - frameA.time;
  // alpha: 0 = frameA, 1 = frameB
  const alpha = dt < 1e-9 ? 0 : Math.max(0, Math.min(1, (t - frameA.time) / dt));

  const result = {};
  // 以 frameA 的关节为基础
  for (const name of Object.keys(frameA.joints)) {
    const a = frameA.joints[name] ?? 0;
    const b = frameB.joints[name] ?? a; // 如果 frameB 缺该关节，保持 frameA 值
    result[name] = a + (b - a) * alpha;
  }
  // frameB 独有的关节（frameA 没有）
  for (const name of Object.keys(frameB.joints)) {
    if (!(name in result)) {
      result[name] = frameB.joints[name];
    }
  }
  return result;
}

/**
 * 根据时间 t 从轨迹中计算插值后的关节值
 * @param {object[]} frames - 排好序的帧数组
 * @param {number}   t      - 目标时间（秒）
 * @returns {{ [jointName]: number }}
 */
export function getJointsAtTime(frames, t) {
  if (frames.length === 0) return {};
  if (frames.length === 1) return { ...frames[0].joints };

  const idx = findFrameIndex(frames, t);
  const frameA = frames[idx];
  const frameB = frames[Math.min(idx + 1, frames.length - 1)];
  return lerpFrame(frameA, frameB, t);
}
