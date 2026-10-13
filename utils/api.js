const request = require('./request');
const config = require('../config');
const { uuid } = require('./idempotency');
const fields = ['psychology', 'aesthetic', 'finance', 'behavior'];
const labels = ['心理', '美育', '财商', '行为'];
const colors = ['#6b4c8a', '#c0392b', '#d4a74a', '#2d7d46'];
const levels = ['优秀', '关注', '预警', '高危'];
// camelCase 为真实契约，snake_case 仅保留本地 mock 兼容。
const value = (raw, camel, snake, fallback) =>
  raw[camel] !== undefined ? raw[camel] : raw[snake] !== undefined ? raw[snake] : fallback;
function list(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  throw new Error('列表响应格式与约定不符，请核对数据适配层');
}
function record(raw) {
  return {
    ...raw,
    student_id: value(raw, 'studentId', 'student_id', null),
    created_at: value(raw, 'createdAt', 'created_at', '')
  };
}
function relation(raw) {
  return {
    ...raw,
    student_id: value(raw, 'studentId', 'student_id', null),
    volunteer_id: value(raw, 'volunteerId', 'volunteer_id', null),
    created_at: value(raw, 'createdAt', 'created_at', '')
  };
}
function student(raw, relations) {
  const observation = raw.latestRecord || raw.latest_record || raw.scores || raw;
  const scores = fields.map((key) =>
    typeof observation[key] === 'number' && observation[key] >= 0 && observation[key] <= 100
      ? observation[key]
      : null
  );
  const hasScores = scores.every((v) => v !== null);
  const calculated = hasScores ? Math.round(scores.reduce((a, b) => a + b, 0) / 4) : null;
  const total = value(raw, 'overall', 'total', calculated);
  const name = raw.nickname || raw.name || '未命名';
  const matched = relations ? relations.filter((r) => r.student_id === raw.id) : null;
  let isPaired = value(raw, 'isPaired', 'is_paired', null);
  if (typeof isPaired !== 'boolean') {
    if (typeof raw.hasRelation === 'boolean') isPaired = raw.hasRelation;
    else if (typeof raw.relationCount === 'number') isPaired = raw.relationCount > 0;
    else if (matched) isPaired = matched.length > 0;
    else if (raw.volunteerId !== undefined || raw.volunteer_id !== undefined)
      isPaired = !!value(raw, 'volunteerId', 'volunteer_id', null);
    else isPaired = null;
  }
  const warnings = raw.warnings || [];
  return {
    ...raw,
    ...Object.fromEntries(fields.map((key, i) => [key, scores[i]])),
    name,
    grade: value(raw, 'gradeClass', 'grade_class', raw.grade || ''),
    initial: name.slice(-1),
    scores,
    hasScores,
    total,
    period: observation.period || raw.period || '',
    is_paired: isPaired,
    relation_count: matched ? matched.length : value(raw, 'relationCount', 'relation_count', null),
    volunteer_name: value(raw, 'volunteerName', 'volunteer_name', ''),
    volunteer_id: value(raw, 'volunteerId', 'volunteer_id', null),
    urgent:
      typeof raw.hasWarning === 'boolean'
        ? raw.hasWarning
        : typeof raw.alert === 'boolean'
          ? raw.alert
          : warnings.length
            ? warnings.some((w) => ['高危', '预警'].includes(w.severity))
            : scores.some((v) => v !== null && v < 60),
    level:
      raw.level ||
      observation.level ||
      (total === null
        ? '暂无观察'
        : total >= 80
          ? '优秀'
          : total >= 60
            ? '关注'
            : total >= 40
              ? '预警'
              : '高危'),
    dimensions: fields.map((key, i) => ({
      key,
      label: labels[i],
      value: scores[i],
      color: colors[i]
    }))
  };
}
function log(raw) {
  return {
    ...raw,
    student_id: value(raw, 'studentId', 'student_id', null),
    volunteer_id: value(raw, 'volunteerId', 'volunteer_id', null),
    student_name: value(raw, 'studentName', 'student_name', ''),
    volunteer_name: value(raw, 'volunteerName', 'volunteer_name', ''),
    created_at: value(raw, 'createdAt', 'created_at', ''),
    images: Array.isArray(raw.images) ? raw.images : []
  };
}
function coverURL(path) {
  if (typeof path !== 'string' || !path) return '';
  if (config.useMock || /^https?:\/\//i.test(path)) return path;
  if (path.startsWith('/')) {
    // 使用后端 origin，不把 /api/app 作为静态文件前缀；兼容小程序无 URL 构造器的运行时。
    const origin = config.baseURL.match(/^https?:\/\/[^/?#]+/i);
    return origin ? origin[0] + path : '';
  }
  return '';
}
function poem(raw) {
  return {
    ...raw,
    student_id: value(raw, 'studentId', 'student_id', null),
    student_name: value(raw, 'studentName', 'student_name', ''),
    created_at: value(raw, 'createdAt', 'created_at', ''),
    created_by: value(raw, 'createdBy', 'created_by', null),
    cover_url: coverURL(value(raw, 'coverUrl', 'cover_url', ''))
  };
}
function volunteer(raw) {
  return {
    ...raw,
    created_at: value(raw, 'createdAt', 'created_at', ''),
    relation_count: value(raw, 'relationCount', 'relation_count', 0)
  };
}
function overview(raw, alerts, students, relations) {
  const studentCount = value(raw, 'studentCount', 'student_count', 0);
  const distribution = raw.levelDistribution
    ? levels.map((label, i) => ({
        label,
        count: raw.levelDistribution[label] || 0,
        color: ['#2d7d46', '#d4a74a', '#c0392b', '#8b1a1a'][i]
      }))
    : raw.distribution || [];
  return {
    ...raw,
    student_count: studentCount,
    volunteer_count: value(raw, 'volunteerCount', 'volunteer_count', 0),
    average_score: value(raw, 'averageScore', 'average_score', null),
    alert_count: value(raw, 'alertCount', 'alert_count', 0),
    unscored_count: value(raw, 'unscoredCount', 'unscored_count', 0),
    distribution,
    alerts: alerts || (raw.alerts || []).map((s) => student(s, relations)),
    unpaired_count: students
      ? students.filter((s) => student(s, relations).is_paired === false).length
      : value(raw, 'unpairedCount', 'unpaired_count', null)
  };
}
function publicOverview(raw) {
  const suppressed = raw.suppressed === true;
  return {
    student_count: value(raw, 'studentCount', 'student_count', 0),
    school_count: value(raw, 'schoolCount', 'school_count', 0),
    record_count: value(raw, 'recordCount', 'record_count', 0),
    suppressed,
    average_scores: suppressed ? null : value(raw, 'averageScores', 'average_scores', null),
    level_distribution: suppressed
      ? null
      : value(raw, 'levelDistribution', 'level_distribution', null)
  };
}
function invite(raw) {
  return {
    id: raw.id,
    code: raw.code,
    target_role: value(raw, 'targetRole', 'target_role', ''),
    created_at: value(raw, 'createdAt', 'created_at', ''),
    expires_at: value(raw, 'expiresAt', 'expires_at', null),
    used_at: value(raw, 'usedAt', 'used_at', null),
    used_by: value(raw, 'usedBy', 'used_by', null),
    status: raw.status
  };
}
const relations = () =>
  request('/admin/relations')
    .then(list)
    .then((rows) => rows.map(relation));
module.exports = {
  publicOverview: () => request('/public/overview', { auth: false }).then(publicOverview),
  redeem: (code) =>
    request('/redeem', { method: 'POST', data: { code: code.trim() } }).then((raw) => ({
      role: raw.role
    })),
  inviteCodes: () =>
    request('/admin/invite-codes')
      .then(list)
      .then((rows) => rows.map(invite)),
  createInviteCode: (data) => request('/admin/invite-codes', { method: 'POST', data }).then(invite),
  revokeInviteCode: (id) =>
    request('/admin/invite-codes/' + encodeURIComponent(id) + '/revoke', { method: 'POST' }).then(
      invite
    ),
  logout: () => request('/logout', { method: 'POST' }),
  students: () =>
    request('/students')
      .then(list)
      .then((rows) => rows.map((raw) => student(raw))),
  adminStudents: async () => {
    const [rows, links] = await Promise.all([request('/admin/students').then(list), relations()]);
    return rows.map((raw) => student(raw, links));
  },
  student: (id) => request('/students/' + encodeURIComponent(id)).then((raw) => student(raw)),
  records: (id) =>
    request('/students/' + encodeURIComponent(id) + '/records')
      .then(list)
      .then((rows) => rows.map(record)),
  logs: (id) =>
    request('/companion-logs', { data: id ? { student_id: id } : {} })
      .then(list)
      .then((rows) => rows.map(log)),
  createLog: (data) =>
    request('/companion-logs', {
      method: 'POST',
      data: {
        studentId: data.studentId || data.student_id,
        type: data.type,
        content: data.content,
        images: []
      }
    }).then(log),
  poems: (id) =>
    request('/poems', { data: id ? { student_id: id } : {} })
      .then(list)
      .then((rows) => rows.map(poem)),
  generatePoem: (data, key = uuid()) =>
    request('/ai/poem', { method: 'POST', data, headers: { 'Idempotency-Key': key } }).then(poem),
  suggest: (studentId, key = uuid()) =>
    request('/ai/suggest', {
      method: 'POST',
      data: { studentId },
      headers: { 'Idempotency-Key': key }
    }),
  overview: async () => {
    const [raw, rows, students, links] = await Promise.all([
      request('/admin/overview'),
      request('/admin/alerts').then(list),
      request('/admin/students').then(list),
      relations()
    ]);
    return overview(
      raw,
      rows.map((s) => student(s, links)),
      students,
      links
    );
  },
  volunteers: () =>
    request('/admin/volunteers')
      .then(list)
      .then((rows) => rows.map(volunteer)),
  relations,
  alerts: () =>
    request('/admin/alerts')
      .then(list)
      .then((rows) => rows.map((raw) => student(raw)))
};
