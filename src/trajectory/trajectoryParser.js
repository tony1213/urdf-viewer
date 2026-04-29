/**
 * trajectoryParser.js
 * 解析、校验、标准化轨迹 JSON 数据
 * 纯函数，无副作用
 */

/**
 * 内部标准格式：
 * {
 *   metadata: { robot, duration, fps, frameCount },
 *   frames: [ { time: number, joints: { [name]: number } } ],
 *   jointNames: string[]
 * }
 */

export class TrajectoryParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TrajectoryParseError';
  }
}

/**
 * 从 JSON 对象解析轨迹
 * 支持两种格式：
 *   1. 标准格式：{ metadata, frames: [{time, joints}] }
 *   2. 简化格式：{ joints: [[t, j1, j2, ...]], joint_names: [] }
 */
export function parseTrajectory(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TrajectoryParseError('无效的 JSON 格式');
  }

  // 判断格式类型
  if (Array.isArray(raw.frames)) {
    return parseStandardFormat(raw);
  } else if (Array.isArray(raw.joint_names) && Array.isArray(raw.joints)) {
    return parseSimpleFormat(raw);
  } else {
    throw new TrajectoryParseError('未识别的轨迹格式。需要 frames[] 或 joint_names[]+joints[] 字段');
  }
}

/** 解析标准格式 */
function parseStandardFormat(raw) {
  const frames = raw.frames;
  if (frames.length === 0) {
    throw new TrajectoryParseError('frames 数组为空');
  }

  // 校验并标准化每一帧
  const normalized = frames.map((f, i) => {
    if (typeof f.time !== 'number') {
      throw new TrajectoryParseError(`frame[${i}] 缺少 time 字段`);
    }
    if (!f.joints || typeof f.joints !== 'object') {
      throw new TrajectoryParseError(`frame[${i}] 缺少 joints 字段`);
    }
    return { time: f.time, joints: { ...f.joints } };
  });

  // 确保按时间排序
  normalized.sort((a, b) => a.time - b.time);

  const jointNames = extractJointNames(normalized);
  const duration = normalized[normalized.length - 1].time;

  return {
    metadata: {
      robot: raw.metadata?.robot || 'unknown',
      duration,
      fps: raw.metadata?.fps || guessFrameRate(normalized),
      frameCount: normalized.length,
      ...(raw.metadata || {}),
    },
    frames: normalized,
    jointNames,
  };
}

/** 解析简化格式：{ joint_names: [], joints: [[t, v1, v2, ...], ...] } */
function parseSimpleFormat(raw) {
  const names = raw.joint_names;
  const rows = raw.joints;
  if (rows.length === 0) throw new TrajectoryParseError('joints 数组为空');

  const frames = rows.map((row, i) => {
    if (!Array.isArray(row) || row.length < names.length + 1) {
      throw new TrajectoryParseError(`joints[${i}] 长度不足`);
    }
    const joints = {};
    names.forEach((name, j) => { joints[name] = row[j + 1]; });
    return { time: row[0], joints };
  });

  frames.sort((a, b) => a.time - b.time);
  const duration = frames[frames.length - 1].time;

  return {
    metadata: {
      robot: raw.robot || 'unknown',
      duration,
      fps: guessFrameRate(frames),
      frameCount: frames.length,
    },
    frames,
    jointNames: names,
  };
}

/** 从所有帧中收集出现过的关节名（保持首次出现顺序） */
function extractJointNames(frames) {
  const seen = new Set();
  const names = [];
  for (const f of frames) {
    for (const name of Object.keys(f.joints)) {
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
  }
  return names;
}

/** 从帧时间间隔估算帧率 */
function guessFrameRate(frames) {
  if (frames.length < 2) return 30;
  const dt = frames[1].time - frames[0].time;
  if (dt <= 0) return 30;
  return Math.round(1 / dt);
}

/** 从 File 对象读取并解析 */
export async function parseTrajectoryFile(file) {
  const text = await file.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new TrajectoryParseError('JSON 解析失败，请检查文件格式');
  }
  return parseTrajectory(raw);
}
