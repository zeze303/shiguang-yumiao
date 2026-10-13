const db = require('../services/database');

async function appAuth(req, res, next) {
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(req.get('Authorization') || '');
  if (!match) return res.status(401).json({ success: false, data: null, message: '请先登录' });
  try {
    const session = await db.findSession(match[1]);
    if (!session || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
      return res.status(401).json({ success: false, data: null, message: '登录已失效，请重新登录' });
    }
    const volunteer = await db.findVolunteerById(session.volunteerId);
    if (!volunteer) return res.status(401).json({ success: false, data: null, message: '账号不存在' });
    if (volunteer.status !== 'active' || !['guest', 'admin', 'volunteer'].includes(volunteer.role)) {
      return res.status(403).json({ success: false, data: null, message: '账号不可用' });
    }
    req.volunteer = volunteer;
    req.appToken = session.token;
    next();
  } catch (error) { next(error); }
}
function requireAppRole(...roles) {
  return (req, res, next) => {
    if (!req.volunteer) return res.status(401).json({ success: false, data: null, message: '请先登录' });
    if (!roles.includes(req.volunteer.role)) return res.status(403).json({ success: false, data: null, message: req.volunteer.role === 'guest' ? '当前为游客身份，请先完成认证' : '无权访问' });
    next();
  };
}
module.exports = appAuth;
module.exports.requireAppRole = requireAppRole;
