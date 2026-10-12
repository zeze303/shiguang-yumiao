const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (Boolean(url) !== Boolean(key)) throw new Error('SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 必须同时配置');
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let localFile = path.join(__dirname, '..', 'data', 'db.json');
const tables = ['app_volunteers', 'app_sessions', 'app_relations', 'app_companion_logs', 'app_growth_poems', 'app_ai_suggestions', 'growth_students', 'growth_records'];

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
  const row = { id: crypto.randomUUID(), openid, name: '', phone: '', avatar: '', org: '', role: 'volunteer', status: 'active', created_at: new Date().toISOString() };
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
module.exports = {
  mode: supabase ? 'supabase' : 'json', toCamel, toSnake,
  findVolunteerByOpenid, findVolunteerById, findOrCreateVolunteer,
  createSession, findSession, deleteSession, listRelations, hasRelation,
  listStudents, findStudent, listRecords,
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
