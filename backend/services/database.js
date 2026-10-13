const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (Boolean(url) !== Boolean(key)) throw new Error('SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 必须同时配置');
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let localFile = path.join(__dirname, '..', 'data', 'db.json');
const tables = ['app_volunteers', 'app_sessions', 'app_relations', 'app_companion_logs', 'app_growth_poems', 'app_ai_suggestions', 'app_invite_codes', 'growth_students', 'growth_records'];

// Convert column names only. JSON content/subscores keys belong to their own schemas.
function toCamel(row) {
  if (Array.isArray(row)) return row.map(toCamel);
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));
}
function toSnake(row) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), v]));
}
async function readLocal() {
  try {
    const state = JSON.parse(await fs.readFile(localFile, 'utf8'));
    for (const table of tables) state[table] ||= [];
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return Object.fromEntries(tables.map(table => [table, []]));
  }
}
// ponytail: single-process write queue; use Supabase for multiple workers/instances.
let writes = Promise.resolve();
function mutateLocal(change) {
  const result = writes.then(async () => {
    const state = await readLocal();
    const value = change(state);
    await fs.mkdir(path.dirname(localFile), { recursive: true });
    const temporary = localFile + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(temporary, localFile);
    return toCamel(value);
  });
  writes = result.catch(() => {});
  return result;
}
function unwrap({ data, error }) {
  if (error) throw error;
  return toCamel(data);
}
async function select(table, filters = {}) {
  if (supabase) {
    let query = supabase.from(table).select('*');
    for (const [column, value] of Object.entries(filters)) {
      if (Array.isArray(value)) {
        if (!value.length) return [];
        query = query.in(column, value);
      } else query = query.eq(column, value);
    }
    // Supabase's default row cap must not silently truncate permissions or records.
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = unwrap(await query.order(table === 'app_sessions' ? 'token' : 'id').range(offset, offset + pageSize - 1));
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
  await writes;
  const state = await readLocal();
  return state[table].map(row => toSnake(toCamel(row))).filter(row => Object.entries(filters).every(([column, value]) =>
    Array.isArray(value) ? value.includes(row[column]) : row[column] === value
  )).map(toCamel);
}
async function insert(table, value) {
  const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...toSnake(value) };
  if (table === 'app_sessions') delete row.id;
  if (supabase) return unwrap(await supabase.from(table).insert(row).select().single());
  return mutateLocal(state => { state[table].push(row); return row; });
}
async function findVolunteerByOpenid(openid) {
  return (await select('app_volunteers', { openid }))[0] || null;
}
async function findVolunteerById(id) {
  return (await select('app_volunteers', { id }))[0] || null;
}
async function findOrCreateVolunteer(openid) {
  const existing = await findVolunteerByOpenid(openid);
  if (existing) return existing;
  const row = { id: crypto.randomUUID(), openid, name: '', phone: '', avatar: '', org: '', role: 'guest', status: 'active', created_at: new Date().toISOString() };
  if (supabase) {
    // Ignore duplicate openid on concurrent logins; never overwrite role/profile.
    const { error } = await supabase.from('app_volunteers').upsert(row, { onConflict: 'openid', ignoreDuplicates: true });
    if (error) throw error;
    return findVolunteerByOpenid(openid);
  }
  return mutateLocal(state => {
    const found = state.app_volunteers.find(v => v.openid === openid);
    if (found) return found;
    state.app_volunteers.push(row);
    return row;
  });
}
async function createSession(volunteerId) {
  return insert('app_sessions', {
    token: crypto.randomBytes(32).toString('hex'), volunteerId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  });
}
async function findSession(token) {
  return (await select('app_sessions', { token }))[0] || null;
}
async function deleteSession(token) {
  if (supabase) {
    const { error } = await supabase.from('app_sessions').delete().eq('token', token);
    if (error) throw error;
    return;
  }
  return mutateLocal(state => { state.app_sessions = state.app_sessions.filter(s => s.token !== token); });
}
async function listRelations(volunteerId) {
  return select('app_relations', volunteerId ? { volunteer_id: volunteerId } : {});
}
async function hasRelation(volunteerId, studentId) {
  return (await select('app_relations', { volunteer_id: volunteerId, student_id: studentId })).length > 0;
}
async function listStudents(volunteer) {
  if (volunteer.role === 'admin') return select('growth_students');
  const ids = (await listRelations(volunteer.id)).map(r => r.studentId);
  return select('growth_students', { id: ids });
}
async function findStudent(id) {
  return (await select('growth_students', { id }))[0] || null;
}
function newestFirst(a, b) {
  return String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
    String(b.period || '').localeCompare(String(a.period || '')) || String(b.id).localeCompare(String(a.id));
}
async function listRecords(studentIds) {
  return (await select('growth_records', { student_id: Array.isArray(studentIds) ? studentIds : [studentIds] })).sort(newestFirst);
}
async function createRelation({ volunteerId, studentId }) {
  if (!await findVolunteerById(volunteerId) || !await findStudent(studentId)) {
    throw Object.assign(new Error('志愿者或孩子不存在'), { status: 404 });
  }
  if (supabase) {
    try { return await insert('app_relations', { volunteerId, studentId }); }
    catch (error) { if (error.code === '23505') error.status = 409; throw error; }
  }
  return mutateLocal(state => {
    if (state.app_relations.some(row => toCamel(row).volunteerId === volunteerId && toCamel(row).studentId === studentId)) {
      throw Object.assign(new Error('结对关系已存在'), { status: 409 });
    }
    const row = { id: crypto.randomUUID(), volunteer_id: volunteerId, student_id: studentId, created_at: new Date().toISOString() };
    state.app_relations.push(row);
    return row;
  });
}
async function deleteRelation(id) {
  if (supabase) return unwrap(await supabase.from('app_relations').delete().eq('id', id).select()).length > 0;
  return mutateLocal(state => {
    const index = state.app_relations.findIndex(row => row.id === id);
    if (index === -1) return false;
    state.app_relations.splice(index, 1);
    return true;
  });
}
async function updatePoemCover(id, coverUrl) {
  if (supabase) return unwrap(await supabase.from('app_growth_poems').update({ cover_url: coverUrl }).eq('id', id).select().maybeSingle());
  return mutateLocal(state => {
    const row = state.app_growth_poems.find(poem => poem.id === id);
    if (!row) return null;
    row.cover_url = coverUrl;
    delete row.coverUrl;
    return row;
  });
}
function inviteError(status, code) {
  return Object.assign(new Error(code), { status, code });
}
function normalizeInviteCode(code) { return code.trim().toUpperCase(); }
async function createInviteCode({ targetRole, createdBy, expiresInDays }) {
  if (!['volunteer', 'admin'].includes(targetRole) || (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365))) throw inviteError(400, 'INVALID_INVITE');
  const actor = await findVolunteerById(createdBy);
  if (!actor || actor.role !== 'admin' || actor.status !== 'active') throw inviteError(403, 'INVITE_FORBIDDEN');
  for (let attempt = 0; attempt < 5; attempt++) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('')).join('-');
    const row = { id: crypto.randomUUID(), code, target_role: targetRole, created_by: createdBy, used_by: null, used_at: null, expires_at: expiresInDays === undefined ? null : new Date(Date.now() + expiresInDays * 86400000).toISOString(), status: 'active', created_at: new Date().toISOString() };
    if (supabase) {
      const result = await supabase.from('app_invite_codes').insert(row).select().single();
      if (result.error?.code === '23505') continue;
      return unwrap(result);
    }
    const result = await mutateLocal(state => {
      if (state.app_invite_codes.some(item => item.code === code)) return null;
      state.app_invite_codes.push(row);
      return row;
    });
    if (result) return result;
  }
  throw inviteError(503, 'INVITE_GENERATION_FAILED');
}
async function findInviteCode(code) {
  return (await select('app_invite_codes', { code: normalizeInviteCode(code) }))[0] || null;
}
async function redeemInviteCode(code, volunteerId) {
  const normalized = normalizeInviteCode(code);
  if (supabase) {
    const { data, error } = await supabase.rpc('app_redeem_invite', { p_code: normalized, p_volunteer_id: volunteerId });
    if (error) throw error;
    if (data.error) throw inviteError(data.error === 'INVITE_NO_UPGRADE' ? 409 : data.error === 'INVITE_FORBIDDEN' ? 403 : 400, data.error);
    return data;
  }
  // Both mutations are inside one serialized JSON write, matching the Supabase transaction.
  return mutateLocal(state => {
    const actor = state.app_volunteers.find(row => row.id === volunteerId);
    const invite = state.app_invite_codes.find(row => row.code === normalized);
    if (!actor || actor.status !== 'active') throw inviteError(403, 'INVITE_FORBIDDEN');
    const value = toCamel(invite);
    if (!value || value.status !== 'active' || value.usedBy != null || value.usedAt != null || (value.expiresAt != null && (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()))) throw inviteError(400, 'INVITE_INVALID');
    const ranks = { guest: 0, volunteer: 1, admin: 2 };
    if (!(ranks[value.targetRole] > ranks[actor.role])) throw inviteError(409, 'INVITE_NO_UPGRADE');
    actor.role = value.targetRole;
    Object.assign(invite, { used_by: volunteerId, used_at: new Date().toISOString(), status: 'used' });
    delete invite.usedBy;
    delete invite.usedAt;
    return { role: actor.role };
  });
}
async function revokeInviteCode(id, actorId) {
  if (supabase) {
    const { data, error } = await supabase.rpc('app_revoke_invite', { p_id: id, p_actor_id: actorId });
    if (error) throw error;
    if (data.error) throw inviteError(data.error === 'INVITE_NOT_FOUND' ? 404 : data.error === 'INVITE_FORBIDDEN' ? 403 : 409, data.error);
    return toCamel(data);
  }
  return mutateLocal(state => {
    const actor = state.app_volunteers.find(row => row.id === actorId);
    if (!actor || actor.role !== 'admin' || actor.status !== 'active') throw inviteError(403, 'INVITE_FORBIDDEN');
    const invite = state.app_invite_codes.find(row => row.id === id);
    if (!invite) throw inviteError(404, 'INVITE_NOT_FOUND');
    if (invite.status === 'used') throw inviteError(409, 'INVITE_ALREADY_USED');
    invite.status = 'revoked';
    return invite;
  });
}
module.exports = {
  mode: supabase ? 'supabase' : 'json', toCamel, toSnake,
  findVolunteerByOpenid, findVolunteerById, findOrCreateVolunteer,
  createSession, findSession, deleteSession, listRelations, hasRelation,
  listStudents, findStudent, listRecords,
  createInviteCode, findInviteCode, redeemInviteCode, revokeInviteCode,
  listInviteCodes: async () => (await select('app_invite_codes')).sort(newestFirst),
  listVolunteers: () => select('app_volunteers'),
  createRelation, deleteRelation, updatePoemCover, newestFirst,
  listCompanionLogs: filters => select('app_companion_logs', toSnake(filters || {})),
  createCompanionLog: value => insert('app_companion_logs', value),
  listGrowthPoems: filters => select('app_growth_poems', toSnake(filters || {})),
  createGrowthPoem: value => insert('app_growth_poems', value),
  listAiSuggestions: filters => select('app_ai_suggestions', toSnake(filters || {})),
  createAiSuggestion: value => insert('app_ai_suggestions', value),
  setLocalFileForTests(file) {
    if (supabase || !path.resolve(file).startsWith(path.resolve(__dirname, '..') + path.sep)) throw new Error('测试存储必须位于 backend 内且使用 JSON 模式');
    localFile = file;
  }
};
