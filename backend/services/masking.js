/**
 * 数据脱敏服务 - 隐私保护层
 *
 * 脱敏规则：
 * - 姓名：2字掩后1字（张*），3字掩中间（张*丰），4+字掩中间（李**亮）
 * - 手机号：138****5678
 * - 住址：仅保留县/镇级（省市区及以下截断）
 * - 监护人信息：设为"已隐藏"
 */

/**
 * 姓名脱敏
 */
function maskName(name) {
  if (!name) return name;
  name = String(name).trim();
  const len = name.length;
  if (len <= 1) return name;
  if (len === 2) return name[0] + '*';
  if (len === 3) return name[0] + '*' + name[2];
  return name[0] + '*'.repeat(len - 2) + name[len - 1];
}

/**
 * 手机号脱敏
 */
function maskPhone(phone) {
  if (!phone) return '';
  const s = String(phone).replace(/\D/g, '');
  if (s.length === 11) return s.slice(0, 3) + '****' + s.slice(7);
  if (s.length >= 8) return s.slice(0, 3) + '****' + s.slice(-4);
  return s.slice(0, 1) + '****' + s.slice(-1);
}

/**
 * 仅展示县/区 + 乡镇/街道。优先使用结构化字段；自由文本从起点逐级解析，
 * 不跳过村组、道路等细节去搜索后面的行政区划词。歧义一律隐藏。
 * 这是保守的格式识别，不是行政区划名称库；不支持的名称/格式宁可隐藏。
 */
function maskAddress(address, areas = {}) {
  const hidden = '已隐藏';
  // 名称必须为汉字，且不能夹带行政后缀或村组、门牌、道路细节。
  // Use a negative lookahead per character for compatibility with Node.js 22 (no v flag).
  const stem = '(?:(?!社区|[省市县区镇乡村组屯路街巷号栋室])\\p{Script=Han}){1,20}?';
  const countyPattern = new RegExp(`^${stem}(?:县|区)$`, 'u');
  const townPattern = new RegExp(`^${stem}(?:镇|乡|街道)$`, 'u');
  const county = areas.county ?? areas.district;
  const township = areas.township ?? areas.town;
  if (county != null || township != null) {
    const coarse = county == null ? '' : typeof county === 'string' ? county.trim() : null;
    const town = township == null ? '' : typeof township === 'string' ? township.trim() : null;
    if (coarse === null || town === null || (coarse && !countyPattern.test(coarse)) || (town && !townPattern.test(town))) return hidden;
    return coarse + town || hidden;
  }
  if (typeof address !== 'string' || !address.trim()) return hidden;
  let rest = address.trim();
  function take(suffix) {
    const match = rest.match(new RegExp(`^${stem}(?:${suffix})`, 'u'));
    if (!match) return '';
    rest = rest.slice(match[0].length);
    return match[0];
  }
  take('省');
  take('市');
  const coarse = take('县|区');
  const town = take('镇|乡|街道');
  if (!coarse && !town) return hidden;
  // “某镇西路”“某镇路”“某镇东街”等不能证明镇的行政边界。
  if (town.endsWith('镇') && /^[^\d村组屯社区号栋室\s,，。]*[路街巷]/u.test(rest)) return hidden;
  // 未解析部分须为空或具有明确的下级细节边界，不能再猜测行政区划。
  if (rest && !/^(?:[\p{Script=Han}]*?(?:村|组|屯|社区|路|街|巷|号|栋|室)|\d|[\s,，。])/u.test(rest)) return hidden;
  return coarse + town;
}

/**
 * 身份证号脱敏
 */
function maskIdCard(id) {
  if (!id) return '';
  const s = String(id).trim();
  if (s.length >= 18) return s.slice(0, 6) + '********' + s.slice(-4);
  if (s.length >= 15) return s.slice(0, 6) + '*****' + s.slice(-4);
  return s;
}

/**
 * 对学生对象进行脱敏
 * @param {object} student - 原始学生数据
 * @param {boolean} strict - 严格模式（公开页面用，隐藏所有隐私字段）
 * @returns {object} 脱敏后的学生数据
 */
function maskStudent(student, strict = false) {
  if (!student) return student;
  const masked = { ...student };
  masked.name = maskName(student.name);
  if (student.phone) masked.phone = maskPhone(student.phone);
  if (student.address !== undefined || student.county !== undefined || student.district !== undefined || student.township !== undefined || student.town !== undefined) {
    masked.address = maskAddress(student.address, student);
  }
  if (student.idCard) masked.idCard = maskIdCard(student.idCard);
  if (strict) {
    masked.guardian = '已隐藏';
    masked.phone = '已隐藏';
    masked.address = '已隐藏';
  }
  return masked;
}

/**
 * 批量脱敏
 */
function maskStudents(students, strict = false) {
  if (!Array.isArray(students)) return students;
  return students.map(s => maskStudent(s, strict));
}

module.exports = { maskName, maskPhone, maskAddress, maskIdCard, maskStudent, maskStudents };
