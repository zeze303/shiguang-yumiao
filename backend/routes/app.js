const express = require('express');
const db = require('../services/database');
const appAuth = require('../middleware/appAuth');
const scoring = require('../services/scoring');
const { maskStudent, maskPhone, maskAddress, maskIdCard } = require('../services/masking');
const router = express.Router();
const fail = (res, status, message) => res.status(status).json({ success: false, data: null, message });
const ok = (res, data) => res.json({ success: true, data });

router.post('/login', async (req, res) => {
  const code = req.body?.code;
  if (typeof code !== 'string' || !code.trim() || code.length > 512) return fail(res, 400, 'code 必须为非空字符串');
  if (!process.env.WX_APPID || !process.env.WX_SECRET) return fail(res, 503, '微信登录尚未配置');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.search = new URLSearchParams({ appid: process.env.WX_APPID, secret: process.env.WX_SECRET, js_code: code, grant_type: 'authorization_code' }).toString();
  let result;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return fail(res, 502, '微信登录服务暂不可用');
    result = await response.json();
  } catch { return fail(res, 502, '微信登录服务暂不可用'); }
  if (result.errcode) {
    return fail(res, [40029, 40163, 40226].includes(Number(result.errcode)) ? 401 : 502, '微信登录失败，请重新获取 code');
  }
  if (typeof result.openid !== 'string' || !result.openid) return fail(res, 502, '微信登录返回异常');
  const volunteer = await db.findOrCreateVolunteer(result.openid);
  if (!volunteer || volunteer.status !== 'active' || !['volunteer', 'admin'].includes(volunteer.role)) return fail(res, 403, '账号不可用');
  const session = await db.createSession(volunteer.id);
  return ok(res, { token: session.token, role: volunteer.role, profile: { id: volunteer.id, name: volunteer.name, avatar: volunteer.avatar } });
});
router.use(appAuth);

router.post('/logout', async (req, res) => {
  await db.deleteSession(req.appToken);
  return ok(res, null);
});

function safeStudent(student) {
  // Allowlist keeps internal notes, audit metadata and future private columns out.
  const fields = ['id', 'name', 'gender', 'age', 'school', 'gradeClass', 'guardian', 'phone', 'address', 'guardianPhone', 'homeAddress', 'idCard', 'publicNote'];
  const safe = maskStudent(Object.fromEntries(fields.filter(k => student[k] !== undefined).map(k => [k, student[k]])));
  if ('guardian' in safe) safe.guardian = '已隐藏';
  if ('guardianPhone' in safe) safe.guardianPhone = maskPhone(safe.guardianPhone);
  const hasAreas = ['county', 'district', 'township', 'town'].some(key => student[key] != null);
  if ('address' in safe || hasAreas) safe.address = maskAddress(student.address, student);
  if ('homeAddress' in safe) safe.homeAddress = maskAddress(student.homeAddress, student);
  if ('idCard' in safe) safe.idCard = maskIdCard(safe.idCard);
  return safe;
}
function safeRecord(record) {
  const fields = ['id', 'studentId', 'period', 'psychology', 'aesthetic', 'finance', 'behavior', 'level', 'subscores', 'createdAt'];
  const dims = scoring.extractDims(record);
  const overall = scoring.calcOverallFromRecord(record);
  return { ...Object.fromEntries(fields.filter(k => record[k] !== undefined).map(k => [k, record[k]])), ...dims, overall, level: scoring.getLevel(overall).label };
}
function summary(student, latest) {
  const latestRecord = latest ? safeRecord(latest) : null;
  const warnings = latest ? scoring.detectWarningsFromRecord(latest) : [];
  return { ...safeStudent(student), latestRecord, scores: latest ? scoring.extractDims(latest) : null,
    overall: latestRecord?.overall ?? null, level: latestRecord?.level ?? null,
    warnings, hasWarning: warnings.some(w => ['高危', '预警'].includes(w.severity)) };
}
router.get('/students', async (req, res) => {
  const students = await db.listStudents(req.volunteer);
  const records = await db.listRecords(students.map(s => s.id));
  const latest = new Map();
  for (const record of records) if (!latest.has(record.studentId)) latest.set(record.studentId, record);
  return ok(res, students.map(s => summary(s, latest.get(s.id))));
});
async function studentAccess(req, res, next) {
  if (req.params.id.length > 128) return fail(res, 400, '学生 id 无效');
  if (req.volunteer.role !== 'admin' && !await db.hasRelation(req.volunteer.id, req.params.id)) return fail(res, 403, '未结对，无权访问该孩子');
  const student = await db.findStudent(req.params.id);
  if (!student) return fail(res, 404, '孩子不存在');
  req.student = student;
  next();
}
router.get('/students/:id/records', studentAccess, async (req, res) => {
  return ok(res, (await db.listRecords(req.student.id)).map(safeRecord));
});
router.get('/students/:id', studentAccess, async (req, res) => {
  const records = await db.listRecords(req.student.id);
  return ok(res, summary(req.student, records[0]));
});
const { requireAppRole } = require('../middleware/appAuth');
const contentSecurity = require('../services/contentSecurity');
const companionAI = require('../services/companionAI');
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function validImageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
async function accessibleStudent(req, res, id) {
  if (!validId(id)) { fail(res, 400, 'studentId 必须为有效字符串'); return null; }
  if (req.volunteer.role !== 'admin' && !await db.hasRelation(req.volunteer.id, id)) { fail(res, 403, '未结对，无权访问该孩子'); return null; }
  const student = await db.findStudent(id);
  if (!student) fail(res, 404, '孩子不存在');
  return student;
}
async function listScope(req, res) {
  const id = req.query.student_id;
  if (id !== undefined) {
    if (!await accessibleStudent(req, res, id)) return null;
    return { studentId: id };
  }
  if (req.volunteer.role === 'admin') return {};
  return { studentId: (await db.listRelations(req.volunteer.id)).map(row => row.studentId) };
}
router.get('/companion-logs', async (req, res) => {
  const filters = await listScope(req, res);
  if (!filters) return;
  if (req.volunteer.role !== 'admin') filters.volunteerId = req.volunteer.id;
  return ok(res, (await db.listCompanionLogs(filters)).sort(db.newestFirst));
});
router.post('/companion-logs', async (req, res) => {
  const { studentId, student_id, type, content, images = [] } = req.body || {};
  if (studentId !== undefined && student_id !== undefined && studentId !== student_id) return fail(res, 400, '学生 id 参数不一致');
  if (!['探访', '通话', '活动', '其他'].includes(type) || !validText(content, 4000) || !Array.isArray(images) || images.length > 9 || !images.every(validImageUrl)) return fail(res, 400, '记录类型、内容或图片数组无效');
  const student = await accessibleStudent(req, res, studentId ?? student_id);
  if (!student) return;
  const checked = await contentSecurity.checkText(content, req.volunteer.openid);
  if (!checked.allowed) return fail(res, 422, '记录内容未通过审核');
  return ok(res, await db.createCompanionLog({ volunteerId: req.volunteer.id, studentId: student.id, type, content: content.trim(), images }));
});
router.post('/ai/suggest', async (req, res) => {
  const student = await accessibleStudent(req, res, req.body?.studentId);
  if (!student) return;
  return ok(res, await companionAI.generateSuggest(student, req.volunteer));
});
router.post('/ai/poem', async (req, res) => {
  if (!validText(req.body?.period, 64)) return fail(res, 400, 'period 必须为非空字符串且不超过64字');
  const student = await accessibleStudent(req, res, req.body?.studentId);
  if (!student) return;
  const checked = await contentSecurity.checkText(req.body.period, req.volunteer.openid);
  if (!checked.allowed) return fail(res, 422, '周期内容未通过审核');
  return ok(res, await companionAI.generatePoem(student, req.volunteer, req.body.period.trim()));
});
router.get('/poems', async (req, res) => {
  const filters = await listScope(req, res);
  if (!filters) return;
  return ok(res, (await db.listGrowthPoems(filters)).sort(db.newestFirst));
});

const admin = express.Router();
admin.use(requireAppRole('admin'));
async function allStudentSummaries() {
  const students = await db.listStudents({ role: 'admin' });
  const records = await db.listRecords(students.map(student => student.id));
  const latest = new Map();
  for (const record of records) if (!latest.has(record.studentId)) latest.set(record.studentId, record);
  return students.map(student => summary(student, latest.get(student.id)));
}
admin.get('/students', async (req, res) => ok(res, await allStudentSummaries()));
admin.get('/overview', async (req, res) => {
  const [students, volunteers] = await Promise.all([allStudentSummaries(), db.listVolunteers()]);
  const scored = students.filter(student => student.overall !== null);
  const levelDistribution = Object.fromEntries(scoring.LEVELS.map(level => [level.label, 0]));
  for (const student of scored) levelDistribution[student.level]++;
  return ok(res, {
    studentCount: students.length,
    volunteerCount: volunteers.filter(volunteer => volunteer.role === 'volunteer').length,
    averageScore: scored.length ? Math.round(scored.reduce((sum, student) => sum + student.overall, 0) / scored.length) : null,
    alertCount: students.filter(student => student.hasWarning).length,
    unscoredCount: students.length - scored.length, levelDistribution
  });
});
admin.get('/volunteers', async (req, res) => {
  const [volunteers, relations] = await Promise.all([db.listVolunteers(), db.listRelations()]);
  return ok(res, volunteers.map(volunteer => ({ id: volunteer.id, name: volunteer.name || '', avatar: volunteer.avatar || '', phone: maskPhone(volunteer.phone), org: volunteer.org || '', role: volunteer.role, status: volunteer.status, createdAt: volunteer.createdAt, relationCount: relations.filter(relation => relation.volunteerId === volunteer.id).length })));
});
admin.get('/relations', async (req, res) => ok(res, await db.listRelations()));
admin.post('/relations', async (req, res) => {
  const { volunteerId, studentId } = req.body || {};
  if (!validId(volunteerId) || !validId(studentId)) return fail(res, 400, 'volunteerId 和 studentId 必须为有效字符串');
  return ok(res, await db.createRelation({ volunteerId, studentId }));
});
admin.delete('/relations/:id', async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 400, '结对 id 无效');
  if (!await db.deleteRelation(req.params.id)) return fail(res, 404, '结对关系不存在');
  return ok(res, null);
});
admin.get('/alerts', async (req, res) => ok(res, (await allStudentSummaries()).filter(student => student.hasWarning)));
router.use('/admin', admin);
module.exports = router;
