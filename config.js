// 修改此文件后重新编译。真实角色始终取自 /login，不由页面切换。
module.exports = {
  useMock: false,
  mockRole: 'volunteer',
  baseURL: 'https://sgym.api.13701.top/api/app',
  timeout: 30000,
  mockDelay: 450,
  // 调试三态：normal / empty / error（仅在 mock 模式生效）
  mockState: 'normal'
};
