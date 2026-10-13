# 拾光育苗 · 原生小程序前端阶段 1

项目根：`E:/WorkSpace/Competition/项目/拾光育苗/`，小程序根为本目录。AppID 保留 `wxcc4fb5516852d560`。直接在微信开发者工具导入本目录，无 npm 依赖和构建步骤。建议使用支持 Canvas 2D、chooseMedia 与 CSS 变量的当前稳定基础库（至少 2.20.2），发布前在目标设备验收。

## 文件结构

```text
app.js / app.json / app.wxss / config.js / sitemap.json
project.config.json             保留 AppID，明确根目录及打包排除项
utils/
  request.js                    HTTPS 基址、Bearer、响应解包、错误、可选全局加载
  api.js                        接口路径与集中数据适配
  page.js                       登录角色守卫、导航、信息说明
  charts.js                     Canvas 2D 雷达/趋势、设备像素比、节点命中
  share.js                      动态高度分享 PNG、长诗换行
mock/
  data.js                       原型虚构孩子、周期、诗文、记录、志愿者
  index.js                      mock 路由、权限、会话内新增、三态模拟
components/child-card/           孩子卡
components/state-view/           加载骨架、空态、常驻错误
custom-tab-bar/                  两角色四项导航，同组件复用
assets/icons/                   自制 SVG，普通/选中状态
assets/landscape.svg / empty.svg 本地品牌封面与空态插画
pages/                          各页 index.js/json/wxml/wxss
scripts/check-frontend.js       零依赖静态与行为自查
```

## 页面与路径

| 页面 | 路径 | 范围 |
|---|---|---|
| 我的结对 | pages/bindings/index | 志愿者，筛选与孩子卡 |
| 成长诗列表 | pages/poems/index | 志愿者，按孩子筛选、封面回退 |
| 陪伴记录列表 | pages/logs/index | 志愿者，筛选、摘要与图片 |
| 我的 | pages/profile/index | 两角色身份、统计/菜单、退出 |
| 孩子详情 | pages/child-detail/index | 两角色，四维雷达、历史趋势、节点、AI、诗、陪伴时间轴 |
| AI 陪伴建议 | pages/advice/index | 两角色，复制、重新生成、原建议保留 |
| 成长诗阅读 | pages/poem-detail/index | 两角色，完整诗文与封面回退 |
| 生成成长诗 | pages/poem-generate/index | 权限内对象、有效周期、依据、禁止重复点击 |
| 分享卡预览 | pages/poem-share/index | 默认匿名、昵称确认、Canvas PNG、相册设置 |
| 新增陪伴记录 | pages/log-create/index | 仅志愿者，10–1000 字、类型、最多 3 张图片 |
| 陪伴记录详情 | pages/log-detail/index | 完整正文、图片预览 |
| 我的结对管理 | pages/pairing/index | 志愿者只读 |
| 管理总览 | pages/overview/index | 阶段 1 骨架，指标、预警、等级分布占位 |
| 管理孩子 | pages/students/index | 阶段 1 骨架，搜索、筛选、详情 |
| 管理志愿者 | pages/volunteers/index | 阶段 1 骨架，搜索、结对数量占位 |

18 页已注册，均包含 state-view。提交/生成失败在表单内显示常驻错误，保留选择、正文及图片。AI 局部失败不会隐藏孩子档案。无观察显示缺失文案，图表不补零。陪伴时间轴使用 companion-logs，评分趋势使用 records。

三级角色：guest 进入 pages/guest/index，只显示项目介绍与公开统计；volunteer/admin 共用“我的结对/成长诗/记录/我的”四项 tab。管理员从“我的”进入管理总览、孩子管理、志愿者管理、邀请码管理。游客深链访问业务页会被角色守卫清理内容并返回游客首页。认证页面为 pages/redeem/index；邀请码管理为 pages/invite-codes/index。

## Mock 与真实后端切换

默认 config.js：

```js
useMock: true,
mockRole: 'volunteer', // 开发验收可改为 admin 并重新编译
mockState: 'normal',   // empty / error 可检查状态页
mockDelay: 450
```

mock 数据集中在 mock/。新增记录与生成诗仅保存在运行内存，重新编译或退出登录后重置；图片临时路径仅在 mock 中演示。草稿仅存 app.globalData.logDraft，不写无限期本地存储，退出即清除。

真实后端：

```js
useMock: false,
baseURL: 'https://实际接口域名/api/app'
```

基址包含 `/api/app`，无需再改页面接口路径。微信公众平台配置 request 合法 HTTPS 域名，重新编译。wx.login code 提交 POST /login，读取 token/role/profile，请求头 `Authorization: Bearer <token>`。返回按 `{success:true,data:...}` 解包；401 清除会话，403 显示权限变更，其他业务错误显示 message。真实角色只能由服务器授权，mockRole 在真实模式不参与登录。

request(options.loading=true) 支持并行计数加载；页面常规请求用各自骨架与局部等待，避免叠加全局遮罩。重试需由用户触发，不自动重复 POST。

## 已验证与实机待验

运行：`node scripts/check-frontend.js`。

检查 15 页文件完整性、JS/JSON 解析、WXML 标签结构与事件方法、组件/静态资源、tabBar 数量、AppID、无 emoji。行为检查覆盖志愿者仅两位结对孩子、越权 403、四维口径、记录新增/校验、诗歌生成/无周期拒绝、mock 空/错误、管理员统计、真实 URL/Bearer/请求体/业务错误/401/403、长诗换行。

这些是静态和 Node 模拟验证，不等同于微信编译器、iOS/Android 实机验收。尚需在开发者工具编译，逐页检查 320/375/390/430 宽度、安全区、大字、SVG 显示、Canvas 节点触控、键盘遮挡、离开草稿提醒、相册拒绝与长诗保存。

## 下一阶段与接口联调缺口

1. api.js 已按 backend/routes/app.js 的 camelCase 契约统一映射页面字段（studentId/createdAt/coverUrl/gradeClass/relationCount/levelDistribution 等），snake_case 仅保留 mock 兼容。管理端读取 /admin/relations 判断结对，缺少姓名不再推断未结对。总览预警与未结对数使用 /admin/alerts、/admin/students、/admin/relations 补充；后续继续联调分页、真实昵称与展示字段。
2. 生成诗接口文档只有 title/content，没有 id。前端生成后重新 GET 列表确认持久化对象，不伪造服务端 id；需后端返回完整诗对象或保证列表及时可见，并补幂等键/任务查询后再支持超时恢复。当前没有后台任务完成承诺。
3. 图片上传未定义。mock 支持用户触发 chooseMedia、数量/大小验证、预览删除；真实模式仅提交文字，禁止将临时路径当 URL。下一阶段补压缩、签名/上传接口、进度、单图重试、审核与删除契约。
4. AI 建议来源周期、时间、logIds 未定义。缺字段时界面明确没有来源周期，不伪造。AI 封面生成、存储、cover_url 审核/过期与标识仍需联调。
5. 管理端预警完整汇总、志愿者详情、分配/解除确认仍在下一阶段，骨架入口只显示说明，不执行关系修改。
6. 补分页、审核错误码、关系解除/记录撤回状态、资料/联系人/反馈接口、隐私协议与未成年人授权。前端隐藏入口不替代后端权限验证。
7. 退出已接入 POST /api/app/logout，成功或失败均清除本机凭证与账号页面数据；网络失败说明服务器撤销未确认。在途登录使用 sessionEpoch 校验，旧登录及迟到的旧 401 不能污染新会话。401 返回重新登录入口，403 清空受影响内容。

未修改 backend/ 与 design/ 内容。project.config.json 增加打包排除 backend/design/scripts/文档等，不将后端源码打包进小程序。

审查修复自测：check-frontend.js 已集成 scripts/check-fields.js（真实响应结构脱敏样例）与 scripts/check-session.js（服务器注销、登录竞态、401/403列表清理与网络保留），单次命令运行全部检查。

## 三级身份与邀请码

默认配置保留当前真实基址与 useMock=false，不自动改为演示模式。真实角色由 /login 返回，/redeem 成功后采纳服务器返回的 role，递增会话 epoch、清理旧业务页，再进入相应界面。新账号默认 guest（旧接口文档中的 volunteer 描述以最新后端实现为准）。

游客统计只调用 GET /public/overview，显示孩子数/学校数/记录数。suppressed=true 时显示“数据尚不足以公开”，不展示或推导 averageScores/levelDistribution；公开请求不附带 Bearer。

mock 演示：设置 useMock=true、mockRole=guest 后重新编译。邀请码 DEMO-VOLUNTEER 升为志愿者，DEMO-ADMIN 升为管理员；DEMO-EXPIRED/DEMO-USED 演示过期/已用。邀请状态与角色升级仅在本次模拟会话生效，重编译或注销重置。mockRole 也可设 volunteer/admin 直接验收。生成、列表、作废调用真实接口同一路径的 mock；非 admin 不允许管理邀请码。

认证失败：当前后端将无效/过期/已使用/已作废统一返回400，界面明确列出可能原因并要求向组织核对；409 显示同级或更高无需升级且未消耗码。前端不会伪造更细的后端原因。邀请码管理可选 volunteer/admin、有效天数1–365（留空长期有效），生成与作废均需用户确认，处理中禁止重复提交，失效码不提供作废按钮。

新增 scripts/check-roles.js 已集成 check-frontend.js，覆盖三级权限、游客汇总抑制、认证失败与升级、邀请码创建/列表/作废及camelCase适配。页面完整检查现为18页。仍需微信开发者工具、真机与真实邀请码联调验收。
