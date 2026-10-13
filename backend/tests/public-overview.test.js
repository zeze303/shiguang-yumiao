const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.PUBLIC_OVERVIEW_MIN_SAMPLES = '5';
const db = require('../services/database');
const { createApp } = require('../server');

test('public statistics suppress single-child, sparse scoring and small grade cells', async t => {
  const originals = { listStudents: db.listStudents, listRecords: db.listRecords };
  let students = [];
  let records = [];
  db.listStudents = async () => students;
  db.listRecords = async () => records;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { Object.assign(db, originals); await new Promise(resolve => server.close(resolve)); });
  const student = id => ({ id, name: '秘密姓名', school: '秘密学校' });
  const record = (id, score) => ({ id: `r${id}`, studentId: id, psychology: score, aesthetic: score, finance: score, behavior: score });
  const get = async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/app/public/overview`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(JSON.stringify(body).includes('秘密'), false);
    return body.data;
  };
  const hidden = data => {
    assert.equal(data.suppressed, true);
    assert.equal(data.averageScores, null);
    assert.equal(data.levelDistribution, null);
    assert.deepEqual(Object.keys(data).sort(), ['studentCount', 'schoolCount', 'recordCount', 'averageScores', 'levelDistribution', 'suppressed'].sort());
  };
  students = [student('s1')]; records = [record('s1', 23)];
  hidden(await get());
  students = Array.from({ length: 8 }, (_, i) => student(`s${i}`)); records = [record('s0', 23)];
  hidden(await get());
  // Repeated records of one child never inflate the privacy cohort.
  records = Array.from({ length: 8 }, (_, i) => ({ ...record('s0', 23), id: `r${i}` }));
  hidden(await get());
  records = students.map((row, i) => record(row.id, i === 0 ? 23 : 90));
  hidden(await get());
  // Two small cells must not reveal either count, or complementary counts.
  records = students.map((row, i) => record(row.id, i < 4 ? 50 : 90));
  hidden(await get());
  students = Array.from({ length: 5 }, (_, i) => student(`s${i}`));
  records = students.map(row => record(row.id, 80));
  const released = await get();
  assert.equal(released.suppressed, false);
  assert.deepEqual(released.averageScores, { psychology: 80, aesthetic: 80, finance: 80, behavior: 80 });
  assert.deepEqual(released.levelDistribution, { '优秀': 5, '关注': 0, '预警': 0, '高危': 0 });
  records = records.map((row, i) => i === 0 ? { id: row.id, studentId: row.studentId } : row);
  hidden(await get());
});
