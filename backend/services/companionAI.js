const db = require('./database');
const ai = require('./ai');
const security = require('./contentSecurity');
const images = require('./images');
const scoring = require('./scoring');
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
function redact(value, student) {
  let text = String(value || '');
  // Exclude known identifying fields and common identifiers before any third-party model call.
  for (const key of ['name', 'guardian', 'guardianName', 'phone', 'guardianPhone', 'address', 'homeAddress', 'idCard', 'school']) {
    if (student[key]) text = text.split(String(student[key])).join('已隐藏');
  }
  return text.replace(/\b\d{17}[\dXx]\b|\b1\d{10}\b/g, '已隐藏')
    .replace(/[\p{Script=Han}\d]+(?:村|组|屯|社区|路|街|巷)[\p{Script=Han}\d]*(?:号|栋|室)/gu, '已隐藏');
}
async function contextFor(student, volunteer, period) {
  const logFilters = { studentId: student.id };
  if (volunteer.role !== 'admin') logFilters.volunteerId = volunteer.id;
  const [records, logs] = await Promise.all([db.listRecords(student.id), db.listCompanionLogs(logFilters)]);
  const latest = period ? records.find(row => row.period === period) : records[0];
  const materials = logs.sort(db.newestFirst).slice(0, 10).map(row => ({ type: row.type, content: row.content, createdAt: row.createdAt }));
  for (const row of records.slice(0, 3)) {
    if (period && row.period !== period) continue;
    for (const key of ['commentOverall', 'commentPsychology', 'commentAesthetic', 'commentFinance', 'commentBehavior']) {
      if (row[key]) materials.push({ type: '成长记录', content: row[key], period: row.period });
    }
  }
  if (!await allowed(materials, volunteer)) throw Object.assign(new Error('记录内容未通过审核'), { status: 422 });
  // Detect risk on complete selected text before redaction/truncation; never infer it from model excerpts.
  const crisis = ai.hasCrisis(materials);
  const safe = materials.map(row => ({ ...row, content: redact(row.content, student).slice(0, 1500) }));
  const scores = latest ? scoring.extractDims(latest) : null;
  return { age: student.age, gender: student.gender, scores, level: latest ? scoring.getLevel(scoring.calcOverallFromRecord(latest)).label : null, materials: safe, crisis };
}
async function generateSuggest(student, volunteer) {
  const context = await contextFor(student, volunteer);
  const crisis = context.crisis;
  const fallback = () => ({ ...FALLBACK, status: FALLBACK.status + (crisis ? ai.CRISIS_GUIDANCE : ''), cautions: crisis ? [...FALLBACK.cautions, ai.CRISIS_GUIDANCE] : [...FALLBACK.cautions] });
  const summary = await ai.summarizeRecords({ records: context.materials });
  if (!await allowed(summary, volunteer)) return fallback();
  const history = (await db.listAiSuggestions({ studentId: student.id, kind: 'suggest' })).sort(db.newestFirst).slice(0, 3).map(row => row.content);
  let value = await ai.generateSuggest({ ...context, recentLogs: summary }, history);
  if (ai.tooSimilar(value, history)) value = await ai.generateSuggest({ ...context, recentLogs: summary }, history.concat([value]));
  if (ai.tooSimilar(value, history)) return fallback();
  if (crisis) {
    value.status += ai.CRISIS_GUIDANCE;
    if (!value.cautions.includes(ai.CRISIS_GUIDANCE)) value.cautions.push(ai.CRISIS_GUIDANCE);
  }
  if (!await allowed(value, volunteer)) return fallback();
  await db.createAiSuggestion({ studentId: student.id, volunteerId: volunteer.id, kind: 'suggest', content: value, model: ai.MODEL });
  return value;
}
async function generatePoem(student, volunteer, period) {
  const context = await contextFor(student, volunteer, period);
  if (!context.materials.length) throw Object.assign(new Error('暂无可用于写诗的素材，请先添加陪伴记录'), { status: 422 });
  const value = await ai.generatePoem({ ...context, period });
  if (!await allowed(value, volunteer)) return { title: '静待成长', content: '本次成长诗暂不可用，请稍后再试。', coverUrl: images.DEFAULT_COVER };
  const poem = await db.createGrowthPoem({ studentId: student.id, createdBy: volunteer.id, period, ...value, coverUrl: images.DEFAULT_COVER });
  // Return text immediately; image work is one-shot per persisted poem. No request awaits it.
  setImmediate(() => images.enqueueCover(poem.id, `${value.title}\n${value.content}`, db.updatePoemCover));
  return poem;
}
module.exports = { generateSuggest, generatePoem, redact, FALLBACK };
