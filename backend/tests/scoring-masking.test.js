const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskAddress } = require('../services/masking');
const scoring = require('../services/scoring');

test('unrecognized addresses are hidden, recognized administrative areas remain masked', () => {
  assert.equal(maskAddress('幸福路12号'), '已隐藏');
  assert.equal(maskAddress('很长但无法识别行政区划的详细门牌地址'), '已隐藏');
  assert.equal(maskAddress('某县某镇一村12号'), '某县某镇');
  assert.equal(maskAddress('某乡一村12号'), '某乡');
  assert.equal(maskAddress('某街道幸福路12号'), '某街道');
});

test('address parsing rejects details before boundaries and road names containing town', () => {
  for (const address of ['幸福村一组镇西路12号', '镇西路12号', '幸福路12号', '某镇西路12号', '某镇路12号', '某镇东街12号', '某县某镇西巷12号']) {
    assert.equal(maskAddress(address), '已隐藏', address);
  }
  for (const detail of ['村', '组', '屯', '社区', '路', '街', '巷', '号', '栋', '室']) {
    assert.equal(maskAddress(`幸福${detail}某镇12号`), '已隐藏');
  }
  assert.equal(maskAddress('某县某镇幸福村一组12号'), '某县某镇');
  assert.equal(maskAddress('河北省某市某县某镇幸福村一组12号'), '某县某镇');
  assert.equal(maskAddress('某区某街道幸福社区12号'), '某区某街道');
});

test('validated structured county and township take priority without exposing raw fields', () => {
  assert.equal(maskAddress('幸福村一组镇西路12号', { county: '某县', township: '某镇' }), '某县某镇');
  assert.equal(maskAddress('', { district: '某区', town: '某街道' }), '某区某街道');
  assert.equal(maskAddress('幸福路12号', { county: '幸福村某县', township: '某镇' }), '已隐藏');
  assert.equal(maskAddress('幸福路12号', { county: '某县', township: '某镇西路' }), '已隐藏');
});

test('default subscores total 60 per dimension and stay within 100', () => {
  const subscores = scoring.defaultSubscores();
  const dims = scoring.calcFromSubscores(subscores);
  for (const [dim, def] of Object.entries(scoring.SCOPE)) {
    assert.equal(dims[dim], 60);
    assert.ok(dims[dim] <= 100);
    for (const value of Object.values(subscores[dim])) assert.ok(value >= 0 && value <= def.perScore);
  }
  assert.equal(scoring.calcOverallFromRecord({ subscores }), 60);
  assert.equal(scoring.getLevel(60).label, '关注');
});

test('subscore validation rejects invalid contributions and accepts boundaries', () => {
  for (const invalid of [-1, 21, Infinity, NaN, null, undefined, '', '12', true]) {
    const subscores = scoring.defaultSubscores();
    subscores.psychology.emotion = invalid;
    assert.equal(scoring.calcFromSubscores(subscores), null);
  }
  const maximum = scoring.defaultSubscores();
  for (const [dim, def] of Object.entries(scoring.SCOPE)) {
    for (const key of def.keys) maximum[dim][key] = def.perScore;
  }
  assert.deepEqual(scoring.calcFromSubscores(maximum), { psychology: 100, aesthetic: 100, finance: 100, behavior: 100 });
  assert.deepEqual(scoring.calcFromSubscores(scoring.emptySubscores()), { psychology: 0, aesthetic: 0, finance: 0, behavior: 0 });
  const fallback = { psychology: 60, aesthetic: 60, finance: 60, behavior: 60 };
  assert.deepEqual(scoring.extractDims({ ...fallback, subscores: '{bad json' }), fallback);
});
