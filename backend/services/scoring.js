/**
 * 评分服务 - 子指标 + 100分制四维评分体系
 *
 * 心理（Psych）：5 项 × 20 分
 * 美育（Aest）：4 项 × 25 分
 * 财商（Fine）：4 项 × 25 分
 * 行为（Behv）：4 项 × 25 分
 */

const SCOPE = {
  psychology: { name: "心理", max: 100, indicators: 5, perScore: 20,
    items: ["情绪状态", "安全感", "抗压能力", "社交能力", "自我认同"],
    keys: ["emotion", "security", "stressResilience", "socialSkill", "selfIdentity"] },
  aesthetic: { name: "美育", max: 100, indicators: 4, perScore: 25,
    items: ["审美感知", "艺术参与", "创造力表现", "文化素养"],
    keys: ["perception", "participation", "creativity", "culture"] },
  finance: { name: "财商", max: 100, indicators: 4, perScore: 25,
    items: ["金钱认知", "消费观念", "储蓄意识", "责任理财观"],
    keys: ["moneyAwareness", "consumption", "saving", "responsibility"] },
  behavior: { name: "行为", max: 100, indicators: 4, perScore: 25,
    items: ["纪律行为", "社交行为", "自律行为", "劳动行为"],
    keys: ["discipline", "social", "selfDiscipline", "labor"] }
};

const LEVELS = [
  { min: 80, label: "优秀", cls: "level-excellent", desc: "状态良好，正常发展" },
  { min: 60, label: "关注", cls: "level-attention", desc: "存在轻微短板，需日常引导" },
  { min: 40, label: "预警", cls: "level-warning", desc: "明显发展缺失，需专项辅导" },
  { min: 0, label: "高危", cls: "level-danger", desc: "严重缺失，强制介入干预" }
];

function validScore(value, max = 100) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= max ? score : null;
}
function getLevel(score) {
  if (validScore(score) === null) return null;
  for (const l of LEVELS) {
    if (score >= l.min) return { label: l.label, cls: l.cls, desc: l.desc };
  }
  return LEVELS[LEVELS.length - 1];
}

/**
 * 从子指标 JSON 计算四维分数
 * 口径：每项是对维度总分的贡献，范围 0..perScore，并非每项百分制。
 * 心理每项 0..20，其他维度每项 0..25；维度分取各项之和。
 * subscores: { psychology: { emotion: 12, security: 12, ... }, aesthetic: {...}, ... }
 * 不猜测历史数据量纲；缺项、非数值或越界的子指标整体返回 null，交由调用方回退旧四维列。
 * 返回: { psychology, aesthetic, finance, behavior } 各 0-100
 */
function calcFromSubscores(subscores) {
  if (!subscores || typeof subscores !== 'object') return null;
  const result = {};
  for (const [dim, def] of Object.entries(SCOPE)) {
    const dimData = subscores[dim];
    if (!dimData || typeof dimData !== 'object' || Array.isArray(dimData)) return null;
    const vals = def.keys.map(k => dimData[k]);
    if (!vals.every(value => Number.isFinite(value) && value >= 0 && value <= def.perScore)) return null;
    result[dim] = Math.round(vals.reduce((s, v) => s + v, 0));
  }
  if (Object.keys(result).length === 4) return result;
  return null;
}

/**
 * 从 record 对象提取四维分数（优先子指标，回退旧字段）
 */
function extractDims(record) {
  if (!record) return null;
  let subscores = record.subscores;
  if (typeof subscores === 'string') {
    try { subscores = JSON.parse(subscores); }
    catch { subscores = null; }
  }
  const fromSub = calcFromSubscores(subscores);
  if (fromSub) return fromSub;
  const dims = Object.fromEntries(Object.keys(SCOPE).map(key => [key, validScore(record[key])]));
  return Object.values(dims).some(value => value === null) ? null : dims;
}

function calcOverallFromRecord(record) {
  const dims = extractDims(record);
  return dims ? calcOverall(dims.psychology, dims.aesthetic, dims.finance, dims.behavior) : null;
}

function calcOverall(psychology, aesthetic, finance, behavior) {
  const values = [psychology, aesthetic, finance, behavior].map(value => validScore(value));
  return values.includes(null) ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / 4);
}

function detectWarningsFromRecord(record) {
  const dims = extractDims(record);
  return dims ? detectWarnings(dims.psychology, dims.aesthetic, dims.finance, dims.behavior) : [];
}

function detectWarnings(psychology, aesthetic, finance, behavior) {
  if ([psychology, aesthetic, finance, behavior].some(value => validScore(value) === null)) return [];
  const warns = [];
  const map = { psychology: "心理", aesthetic: "美育", finance: "财商", behavior: "行为" };
  const dims = { psychology, aesthetic, finance, behavior };
  for (const [key, label] of Object.entries(map)) {
    const val = dims[key];
    if (val < 40) warns.push({ dim: label, severity: "高危", score: val });
    else if (val < 60) warns.push({ dim: label, severity: "预警", score: val });
    else if (val < 80) warns.push({ dim: label, severity: "关注", score: val });
  }
  return warns;
}

/** 默认维度总分为 60：心理 5 × 12，其他维度 4 × 15。 */
function defaultSubscores() {
  const result = {};
  for (const [dim, def] of Object.entries(SCOPE)) {
    result[dim] = {};
    def.keys.forEach(k => { result[dim][k] = def.perScore * 0.6; });
  }
  return result;
}

/** 构建子指标空数据 */
function emptySubscores() {
  const result = {};
  for (const [dim, def] of Object.entries(SCOPE)) {
    result[dim] = {};
    def.keys.forEach(k => { result[dim][k] = 0; });
  }
  return result;
}

// 旧数据转换
function convertOldScore(n) {
  const value = validScore(n, 5);
  return value === null ? null : Math.round(value / 5 * 100);
}

function convertOldRecord(record) {
  return {
    ...record,
    psychology: convertOldScore(record.psychology ?? record.scores?.psychology),
    aesthetic: convertOldScore(record.aesthetic ?? record.scores?.aesthetic),
    finance: convertOldScore(record.finance ?? record.scores?.finance),
    behavior: convertOldScore(record.behavior ?? record.scores?.behavior),
  };
}

module.exports = {
  SCOPE, LEVELS,
  getLevel,
  calcFromSubscores, extractDims,
  calcOverallFromRecord, calcOverall,
  detectWarningsFromRecord, detectWarnings,
  defaultSubscores, emptySubscores,
  convertOldScore, convertOldRecord
};
