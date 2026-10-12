require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });
const express = require('express');
const cors = require('cors');
const compression = require('compression');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));
  app.use('/assets', express.static(require('node:path').join(__dirname, 'public', 'assets')));
  app.use('/api/app', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, require('./routes/app'));
  app.use((req, res) => res.status(404).json({ success: false, data: null, message: '接口不存在' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : [400, 403, 404, 409, 422, 502, 503].includes(error.status) ? error.status : 500;
    // Do not log provider URLs, query strings, tokens or request bodies.
    if (status === 500) console.error('请求处理失败', { name: error.name || 'Error', code: error.code || 'INTERNAL_ERROR' });
    const messages = { 400: '请求格式错误', 403: '无权访问', 404: '数据不存在', 409: '结对关系已存在', 413: '请求内容过大', 422: '内容未通过审核或素材不足', 502: '生成服务暂不可用', 503: '服务未配置或暂不可用' };
    res.status(status).json({ success: false, data: null, message: messages[status] || '服务暂不可用' });
  });
  return app;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1-65535 的整数');
  createApp().listen(port, () => console.log(`拾光育苗后端已启动，端口 ${port}，存储模式 ${require('./services/database').mode}`));
}
module.exports = { createApp };
