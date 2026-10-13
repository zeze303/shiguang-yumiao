const HIDDEN = '已隐藏';
const fields = ['name', 'guardian', 'guardianName', 'phone', 'guardianPhone', 'address', 'homeAddress', 'idCard', 'school'];
function filterText(value, student = {}) {
  let text = String(value ?? '').normalize('NFKC');
  for (const key of fields) {
    if (!student[key]) continue;
    const chars = [...String(student[key]).normalize('NFKC').replace(/[\s\-—·.]/g, '')];
    if (chars.length < 2) continue;
    const pattern = chars.map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\-—·.]*');
    text = text.replace(new RegExp(pattern, 'gu'), HIDDEN);
  }
  text = text.replace(/(?<!\d)(?:\+?86[\s-]*)?1[3-9](?:[\s().-]*\d){9}(?!\d)/g, HIDDEN)
    .replace(/(?<!\d)0\d{2,3}[\s-]*\d{7,8}(?!\d)/g, HIDDEN)
    .replace(/(?<!\d)\d(?:[\s-]*\d){16}[\s-]*[\dXx](?!\d)/g, HIDDEN)
    .replace(/[\p{Script=Han}\d]+(?:村|组|屯|社区|路|街|巷)[\p{Script=Han}\d]*(?:号|栋|室)?/gu, HIDDEN);
  // Ambiguous contact/address fragments are hidden as a whole rather than sent to a model.
  text = text.replace(/(?:电话|手机号|联系方式|微信号|住址|地址|住在)[^，。；\n]{0,100}/gu, HIDDEN);
  return text;
}
function sanitize(value, student = {}) {
  if (typeof value === 'string') return filterText(value, student);
  if (Array.isArray(value)) return value.map(item => sanitize(item, student));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, student)]));
  return value;
}
function isSafe(value, student = {}) {
  if (typeof value === 'string') return filterText(value, student) === value.normalize('NFKC');
  if (Array.isArray(value)) return value.every(item => isSafe(item, student));
  if (value && typeof value === 'object') return Object.values(value).every(item => isSafe(item, student));
  return true;
}
module.exports = { filterText, sanitize, isSafe };
