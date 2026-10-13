# 拾光育苗独立后端（阶段 1 + 阶段 2）

Node.js 22+、Express、Supabase。独立运行，连接既有 growth_students / growth_records；只新增 app_* 表，不依赖其他项目代码或进程。

## 启动与验证

```powershell
Set-Location 'E:/WorkSpace/Competition/项目/拾光育苗/backend'
npm install
Copy-Item .env.example .env
# 编辑 .env 后启动
npm start
```

```powershell
npm run check
npm test
```

check 逐一执行项目 JS 的 node --check 并检查禁止的 emoji，排除 node_modules。测试使用 Node 内置运行器、backend 内临时 JSON 和 mock；不调用真实微信、DeepSeek、生图或 Supabase，不改正式 data/db.json。

## 配置与数据库

| 环境变量 | 说明 |
| --- | --- |
| SUPABASE_URL | 既有 Supabase 项目 URL |
| SUPABASE_SERVICE_ROLE_KEY | 仅服务端持有的 service_role 密钥 |
| WX_APPID、WX_SECRET | 小程序微信登录及内容安全凭据 |
| DEEPSEEK_API_KEY | DeepSeek 密钥，模型固定 deepseek-chat |
| PORT | 监听端口，默认 3000 |
| IMAGE_API_KEY | 生图密钥，空值直接使用默认封面 |
| IMAGE_API_BASE | 默认 https://quanzil.com/v1 |
| IMAGE_MODEL | 默认 gpt-image-2 |
| WX_CONTENT_SECURITY | 默认 false；设为 true 且微信凭据齐全后启用文本审核 |

在既有 Supabase 库执行 supabase_schema_app.sql；前提是 growth_students.id 为 text，growth_records 已存在。SQL 包含七张 app_* 表的索引、外键、唯一约束、RLS，以及原子兑换/作废函数；没有修改 growth_*。本次未执行远程迁移。阶段 2 不需要新增表或列。

Supabase URL/密钥同时配置则使用 Supabase，两项都空则使用 backend/data/db.json，只填一项拒绝启动。远程错误直接失败，不静默回退或缓存远程数据。JSON 使用 snake_case 顶层列；API/服务返回 camelCase，JSON content/subscores 内部键保持原样。兼容本地顶层 camelCase 列。JSON 模式使用单进程写队列和临时文件替换，仅用于单进程开发。

JSON 顶层数组：app_volunteers、app_sessions、app_relations、app_companion_logs、app_growth_poems、app_ai_suggestions、app_invite_codes、growth_students、growth_records。首次登录自动创建 guest/active。既有 volunteer/admin 角色不变；管理员可用数据库手工设置或由 admin 邀请码升级。

## 认证与数据范围

响应统一为 `{ success, data, message? }`，错误 data=null。除 login 外请求均传 `Authorization: Bearer <token>`。token 为随机 32 字节的十六进制字符串，会话有效期 7 天；每次请求重新加载角色和账号状态。logout 删除当前会话，旧 token 立即失效，其他会话不受影响。

guest 静默登录默认角色，只能访问公开聚合统计、redeem、登录和注销；学生、记录、陪伴日志、AI、诗及管理接口均 403 并提示“当前为游客身份，请先完成认证”。volunteer 只可访问当前结对孩子；解除结对后所有孩子数据读写、AI 请求均失去权限。陪伴记录 GET 进一步限制为自己的记录。poems 返回当前结对孩子的诗，允许同孩子的协作展示。admin 不受结对范围限制。所有 admin 接口统一 requireAppRole('admin')。

401：未认证/过期；403：禁用/无权限；404：数据不存在；409：重复结对；422：审核拒绝或写诗素材不足；502：模型异常；503：凭据未配置或审核服务异常。

## 接口清单

所有路由前缀为 /api/app。

| 方法 | 路由 | 请求/用途 |
| --- | --- | --- |
| POST | /login | `{ code }`，返回 token、role、profile（id/name/avatar） |
| POST | /logout | 删除当前会话，返回 data=null |
| GET | /public/overview | 无需登录；只返回孩子/学校/记录数量、四维平均分及等级分布，不返回任何孩子明细 |
| POST | /redeem | 需登录，`{ code }`；一次性邀请码原子升级为 volunteer/admin。同级或降级兑换拒绝且不消费。 |
| GET | /students | 当前范围的孩子，含最新四维、等级和预警 |
| GET | /students/:id | 脱敏详情 |
| GET | /students/:id/records | 成长记录时间倒序 |
| GET | /companion-logs | 我的陪伴记录；可传 ?student_id=...，admin 可看全部 |
| POST | /companion-logs | `{ studentId, type, content, images }`；兼容 student_id |
| POST | /ai/suggest | `{ studentId }` |
| POST | /ai/poem | `{ studentId, period }` |
| GET | /poems | 当前结对范围的成长诗；可传 ?student_id=... |
| GET | /admin/overview | studentCount、volunteerCount、averageScore、alertCount、unscoredCount、levelDistribution |
| GET | /admin/students | 全部孩子，沿用脱敏及评分字段 |
| GET | /admin/volunteers | 志愿者/管理员列表，含 relationCount，不返回 openid；电话脱敏 |
| GET | /admin/relations | 全部结对 |
| POST | /admin/relations | `{ volunteerId, studentId }`，重复返回 409 |
| DELETE | /admin/relations/:id | 解除结对，成功 data=null，不存在 404 |
| GET | /admin/alerts | 最新四维存在预警/高危的孩子及 warnings |
| POST | /admin/invite-codes | `{ targetRole: "volunteer"|"admin", expiresInDays? }`，生成16位可读随机码 |
| GET | /admin/invite-codes | 邀请码管理列表 |
| POST | /admin/invite-codes/:id/revoke | 作废 active 邀请码，used 码不能撤销 |

陪伴记录 type 为 探访/通话/活动/其他，content 为 1..4000 字符，images 可省略（默认 []），最多 9 个 HTTPS URL；不接受带账号密码的 URL。只有服务端认证账号能写 volunteerId。没有图片上传接口，不抓取 images 中的 URL。

列表按 createdAt 降序，再按 period/id 稳定排序。overview 按每个孩子最新一条成长记录计算；无记录不参与平均分、等级分布；volunteerCount 只计 role=volunteer（含 disabled），alertCount 按孩子去重。

邀请码由 app_invite_codes 保存：id、唯一 code、target_role（volunteer/admin）、created_by、used_by（可空）、used_at、expires_at（可空）、status（active/used/revoked）、created_at。兑换时账号和邀请码均加行锁，角色升级与 used 状态在同一事务提交；数据库已有账号角色不会因迁移被重置。管理员列表返回码及使用者信息，创建者始终由已认证 admin 确定。

公开统计的小样本保护由 PUBLIC_OVERVIEW_MIN_SAMPLES 配置，默认5，非法值或小于2时回退5。样本量按具有有效最新四维评分的不同孩子计数，缺失、非有限或越界评分不计入；同孩子多条记录不增加样本。样本不足或任一非空等级单元人数低于阈值时，整组隐藏 averageScores 和 levelDistribution（均为 null），suppressed=true，仅发布孩子总数、学校数、成长记录数。不发布其他等级计数、参与评分人数或隐藏单元数量，避免用互补计数恢复被抑制单元；仅在所有发布条件满足时 suppressed=false。零人数等级不是小单元。

## 四维与脱敏

子指标采用贡献分求和：心理 5 项 × 上限20，其余 4 项 × 上限25；默认 12/15，使四维均为60。缺项、非有限数值、越界或错误 JSON 回退旧四维列；不自动猜测历史每项百分制数据。综合分为四维均值四舍五入，等级按 80/60/40 阈值；hasWarning 对“预警”“高危”为 true，“关注”仅列入 warnings。无记录时分数/等级为 null。

学生响应使用字段白名单，隐藏 note/审计字段，自由文本评语不直接返回。姓名、电话、身份证脱敏，监护人隐藏。地址优先经校验的 county/district + township/town；自由文本从开头逐级解析，禁止村组道路门牌进入行政名称，“某镇西路”等歧义或无法确认边界返回“已隐藏”。admin 同样脱敏。

AI 只传年龄、性别、四维、等级及近10条陪伴记录/近3条成长评语。volunteer 的陪伴素材同时按 studentId 和当前 volunteerId 过滤，即使多人结对或结对交接也不使用他人记录；admin 可使用该孩子全部陪伴记录。模型调用前替换该孩子已知姓名、监护人、学校、地址、手机号及身份证，另过滤常见电话/证件/地址模式。自由文本脱敏是有限的规则处理，真实数据仍须遵守录入脱敏规范，不把未知第三人的隐私写入内容。

## AI、去重与内容审核

services/ai.js 已按 拾光育苗_AI_Prompt设计_v1.md 换成正式系统和用户文案。建议严格校验 status 字符串、2..3条 openers、3条 activities、2..3条 cautions；统一附 disclaimer="仅供参考，非专业诊断"。诗标题最多8字，正文6..10行。DeepSeek 超时30秒，错误结构不落库。

陪伴建议流程：读取四维/最近记录，输入审核与脱敏；空记录或空白评语不作为素材，无素材直接返回说明“当前缺少成长记录，建议先补充陪伴记录”的兜底，不调用模型、不落库。摘要子调用产出2..3句；摘要失败则用最多3条、每条200字符的已脱敏素材继续生成，若后续生成也失败则返回兜底；所有兜底保留独立危机标记对应引导。再取该孩子跨志愿者最近3条建议，追加“避免与以下雷同”；以字符二元组 Dice 相似度 >=0.8 判断过度雷同，最多重生成1次。仍重复或模型输出审核拒绝时返回固定兜底，不落库。审核通过才写 app_ai_suggestions（kind=suggest、model=deepseek-chat）。危机检测使用完整选取素材，在脱敏及每条1500字符截断之前计算独立 crisis 布尔标记；截断不清除此标记。危机词匹配到自伤/极端情绪等时，状态和注意事项加入“建议尽快联系孩子的监护人或老师，共同关注。”，兜底也保留该引导。规则检测不能替代人工判断。

services/contentSecurity.js 提供 checkText(content, openid)、setChecker(asyncChecker)、resetChecker()。WX_CONTENT_SECURITY=true 且 WX_APPID/WX_SECRET 完整时，缓存微信 access_token 并调用 msg_sec_check v2；文本分段审核，任一段 reject/review/未知结果均拒绝。凭据缺失或开关关闭按阶段要求放行；启用后的网络、token 或接口异常返回503，不放行。真实上线应明确开启并验证。审核点包含陪伴记录入库、AI素材输入、摘要输出、最终建议/诗输出。输出拒绝不落库，返回安全兜底。当前实现为文本审核，图片审核仍需额外接入。

## 异步封面

POST /ai/poem 先审核文字并写 app_growth_poems，立即返回包含 title/content 的诗记录，另有 id、studentId、period、coverUrl 等字段。初始 coverUrl=/assets/default-poem-cover.svg。无素材返回422，并明确提示“暂无可用于写诗的素材，请先添加陪伴记录”；成长诗不调用摘要。模型调用/结构校验失败或审核拒绝返回静态兜底文字，没有诗 ID，不入库也不生图；审核服务和数据库错误仍阻断。

响应后后台调用 IMAGE_API_BASE/images/generations，风格为童趣手绘、暖色、红金协调、无文字无水印。生图超时60秒，失败不影响文字并保留默认封面。成功 URL 更新 cover_url；支持 HTTPS URL 或 b64_json（PNG/JPEG/WebP）保存到 public/assets/generated。前端轮询 GET /poems?student_id=... 并按诗 ID 找 coverUrl，不需要再次调用 AI。一次 POST 是新诗；同诗 ID 进行中任务去重，不受缓存淘汰影响。完成去重缓存最多1024条、TTL为24小时，入队和任务结束时清理过期项并淘汰最旧项；过期或淘汰后再次显式入队允许生成。GET 永不触发生图，已保存封面复用。

后台任务是单进程内存任务，进程中断保留默认封面，不自动重试。选用了规格允许的失败回退策略；多实例/需要可靠重试时应增加持久任务队列。base64 图片需部署持久磁盘，长期有效性取决于存储；上游 URL 的有效期需真实联调确认。静态封面可由 URL 访问，不包含姓名/地址，只用已审核诗文生成。

## 测试与真实联调

测试覆盖阶段1登录/注销、结对权限、地址脱敏、评分；阶段2陪伴记录校验/权限、admin所有接口、重复结对、解除后权限、摘要子调用、最近3条历史、去重重生成及重复兜底、危机引导、审核拒绝不落库、微信token缓存与失败阻断、生图成功/失败、任务去重及不阻塞文字。所有外部 fetch 均 mock。

仍需真实环境联调：Supabase迁移及并发唯一约束、微信登录和 msg_sec_check 权限/配额、DeepSeek JSON遵循率/实际文案、quanzil的模型参数与URL/base64返回格式、小程序静态封面域名配置。部署需HTTPS与合法域名，配置网关登录/AI限流；定期清理过期会话，按部署拓扑收紧CORS。密钥不入库、不下发前端、不写日志。
