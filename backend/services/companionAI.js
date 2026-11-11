const db = require('./database');
const ai = require('./ai');
const security = require('./contentSecurity');
const images = require('./images');
const scoring = require('./scoring');
const privacy = require('./privacy');
const FALLBACK = {
  status: '本次建议暂不可用，请以孩子的实际表达为准。',
  openers: ['今天想聊些什么？', '你愿意分享最近的一件小事吗？'],
  activities: ['一起散步几分钟', '让孩子自由画画', '听孩子讲一件感兴趣的事'],
  cautions: ['尊重孩子的意愿，不追问隐私', '如有担忧，请联系监护人或老师'],
  disclaimer: ai.DISCLAIMER
};
async function allowed(value, volunteer) {
  return (await security.checkText(typeof value === 'string' ? value : JSON.stringify(value), volunteer.openid)).allowed;
}
function redact(value, student) { return privacy.filterText(value, student); }
// Calendar periods use Asia/Shanghai boundaries, including timestamps stored in UTC.
function periodRange(period) {
  const value = period.trim();
  let year, month, months = 1;
  const current = new Date(Date.now() + 8 * 3600000);
  if (value === '本期' || value === '本月') {
    year = current.getUTCFullYear(); month = current.getUTCMonth() + 1;
  } else {
    let match = /^(\d{4})(?:年|[-/])(\d{1,2})月?$/.exec(value);
    if (match) { year = Number(match[1]); month = Number(match[2]); }
    else if ((match = /^(\d{4})年([春夏秋冬])季?$/.exec(value))) {
      year = Number(match[1]); month = { 春: 3, 夏: 6, 秋: 9, 冬: 12 }[match[2]]; months = 3;
    } else if ((match = /^(\d{4})(?:年?第([1-4])季度|[- ]?Q([1-4]))$/i.exec(value))) {
      year = Number(match[1]); month = (Number(match[2] || match[3]) - 1) * 3 + 1; months = 3;
    } else if ((match = /^(\d{4})年?$/.exec(value))) {
      year = Number(match[1]); month = 1; months = 12;
    }
  }
  if (!year || year < 1000 || !month || month > 12) throw Object.assign(new Error('周期格式无效，请使用2026年10月或2026-10等明确周期'), { status: 400, code: 'INVALID_PERIOD' });
  return { start: Date.UTC(year, month - 1, 1) - 8 * 3600000, end: Date.UTC(year, month - 1 + months, 1) - 8 * 3600000 };
}
async function contextFor(student, volunteer, period) {
  const logFilters = { studentId: student.id };
  if (volunteer.role !== 'admin') logFilters.volunteerId = volunteer.id;
  const [records, logs] = await Promise.all([db.listRecords(student.id), db.listCompanionLogs(logFilters)]);
  const range = period ? periodRange(period) : null;
  const inRange = date => {
    const time = Date.parse(date);
    return time >= range.start && time < range.end;
  };
  const selectedRecords = range ? records.filter(row => {
    if (!row.period) return inRange(row.createdAt);
    try {
      const source = periodRange(row.period);
      return source.start >= range.start && source.end <= range.end;
    } catch { return false; }
  }) : records;
  const latest = selectedRecords[0];
  const materials = logs.filter(row => (!range || inRange(row.createdAt)) && typeof row.content === 'string' && row.content.trim()).sort(db.newestFirst).slice(0, 10).map(row => ({ type: row.type, content: row.content, createdAt: row.createdAt }));
  for (const row of selectedRecords.slice(0, 3)) {
    for (const key of ['commentOverall', 'commentPsychology', 'commentAesthetic', 'commentFinance', 'commentBehavior']) {
      if (typeof row[key] === 'string' && row[key].trim()) materials.push({ type: '成长记录', content: row[key], period: row.period });
    }
  }
  if (!await allowed(materials, volunteer)) throw Object.assign(new Error('记录内容未通过审核'), { status: 422 });
  // Detect risk on complete selected text before redaction/truncation; never infer it from model excerpts.
  const crisis = ai.hasCrisis(materials);
  const safe = materials.map(row => privacy.sanitize({ ...row, content: redact(row.content, student).slice(0, 1500) }, student));
  const scores = latest ? scoring.extractDims(latest) : null;
  return { age: Number.isInteger(student.age) && student.age >= 0 && student.age <= 18 ? student.age : null, gender: ['男', '女'].includes(student.gender) ? student.gender : null, scores, level: latest ? scoring.getLevel(scoring.calcOverallFromRecord(latest))?.label ?? null : null, materials: safe, crisis };
}
async function generateSuggest(student, volunteer) {
  const context = await contextFor(student, volunteer);
  const crisis = context.crisis;
  const fallback = (status = FALLBACK.status) => ({ ...FALLBACK, status: status + (crisis ? ai.CRISIS_GUIDANCE : ''), openers: [...FALLBACK.openers], activities: [...FALLBACK.activities], cautions: crisis ? [...FALLBACK.cautions, ai.CRISIS_GUIDANCE] : [...FALLBACK.cautions] });
  if (!context.materials.length) return fallback('当前缺少成长记录，建议先补充陪伴记录。请以孩子的实际表达为准。');
  let summary;
  let summaryFailed = false;
  try {
    summary = await ai.summarizeRecords({ records: context.materials });
  } catch {
    // Only the optional summary call degrades; database and security failures still propagate.
    summaryFailed = true;
    summary = context.materials.slice(0, 3).map(row => row.content.slice(0, 200));
  }
  summary = privacy.sanitize(summary, student);
  if (!await allowed(summary, volunteer)) return fallback();
  const history = (await db.listAiSuggestions({ studentId: student.id, kind: 'suggest' })).sort(db.newestFirst).slice(0, 3).map(row => privacy.sanitize(row.content, student));
  let value;
  try {
    value = await ai.generateSuggest({ ...context, recentLogs: summary }, history);
    // Check the intermediate exit before it can become input to another model call.
    if (!privacy.isSafe(value, student)) return fallback();
    if (!await allowed(value, volunteer)) return fallback();
    if (ai.tooSimilar(value, history)) {
      const safeCandidate = privacy.sanitize(value, student);
      value = await ai.generateSuggest({ ...context, recentLogs: summary }, history.concat([safeCandidate]));
    }
  } catch (error) {
    if (summaryFailed) return fallback();
    throw error;
  }
  if (ai.tooSimilar(value, history)) return fallback();
  if (crisis) {
    value.status += ai.CRISIS_GUIDANCE;
    if (!value.cautions.includes(ai.CRISIS_GUIDANCE)) value.cautions.push(ai.CRISIS_GUIDANCE);
  }
  if (!await allowed(value, volunteer)) return fallback();
  if (!privacy.isSafe(value, student)) return fallback();
  await db.createAiSuggestion({ studentId: student.id, volunteerId: volunteer.id, kind: 'suggest', content: value, model: ai.MODEL });
  return value;
}
async function generatePoem(student, volunteer, period) {
  if (!privacy.isSafe(period, student)) throw Object.assign(new Error('周期包含隐私'), { status: 422 });
  const context = await contextFor(student, volunteer, period);
  if (!context.materials.length) throw Object.assign(new Error('该周期暂无可用于写诗的素材，请先添加陪伴记录'), { status: 422, code: 'NO_MATERIAL' });
  const fallback = () => ({ title: '静待成长', content: '本次成长诗暂不可用，请稍后再试。' + (context.crisis ? ai.CRISIS_GUIDANCE : ''), coverUrl: images.DEFAULT_COVER });
  let value;
  try { value = await ai.generatePoem({ ...context, period }); }
  catch { return fallback(); }
  if (!await allowed(value, volunteer)) return fallback();
  if (!privacy.isSafe(value, student)) return fallback();
  const poem = await db.createGrowthPoem({ studentId: student.id, createdBy: volunteer.id, period, ...value, coverUrl: images.DEFAULT_COVER });
  // Return text immediately; image work is one-shot per persisted poem. No request awaits it.
  setImmediate(() => images.enqueueCover(poem.id, `${value.title}\n${value.content}`, db.updatePoemCover));
  return poem;
}
module.exports = { generateSuggest, generatePoem, redact, FALLBACK };
