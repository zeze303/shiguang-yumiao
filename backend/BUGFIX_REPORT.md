# 已确认缺陷修复报告

修改范围仅 backend，未修改前端。

## 缺陷 2：陪伴记录保存幂等

根因：POST /companion-logs 未传递操作键，createCompanionLog 直接插入，数据库没有对应唯一约束。

改动：routes/app.js、services/database.js、supabase_schema_app.sql。

- 可选 Idempotency-Key，1 到 128 位可见 ASCII 字符。
- volunteer_id + idempotency_key 唯一。相同键及相同业务参数返回首次记录，HTTP 200。
- 比较 studentId、type、规范化后的 content 和 images；student_id 别名与省略 images 按路由现有规则规范化。
- 相同键不同参数返回 409、IDEMPOTENCY_CONFLICT，message 为“操作键已被不同请求使用”。
- 无键仍直接新增；不同志愿者可以使用相同键。
- Supabase 依靠唯一索引处理并发，冲突后读取首次记录再比较；JSON 模式在现有单进程写队列内完成查重与新增。

新增字段：public.app_companion_logs.idempotency_key text，可空。新增唯一索引 idx_app_logs_volunteer_idempotency。无新增表。

## 缺陷 4：AI failed 同键重试

根因：账本把所有非 done 状态当作 409；同进程重复请求等待原 promise；统一错误处理将所有 409 映射为结对关系冲突。

改动：services/aiUsage.js、server.js。

- done 返回首次结果；pending 返回 HTTP 202，响应顶层带 status: pending、code: AI_PENDING，data 为 { status: 'pending' }。
- failed 同键同参数重新预留并执行，覆盖账本；仍受现有账号配额、全局预算与并发限制。
- failed 账本保存 error.code 与可读 error.message。未知外部错误使用安全文案，避免将 provider URL、凭据写入账本或返回客户端。
- AI 失败响应带 AI_FAILED；NO_MATERIAL、INVALID_PERIOD 保留领域错误码与文案。
- 同键不同参数返回 IDEMPOTENCY_CONFLICT，不再误报结对关系已存在。
- 修改现有账本 JSON 结构，无 SQL 迁移。账本仍沿用单实例、持久磁盘约束；进程重启遗留的 pending 仍返回 202，不自动重放不确定是否已扣费的请求。

## 缺陷 5：成长诗周期素材

根因：陪伴日志没有按周期过滤；成长记录先取前三条再做字符串完全匹配，遗漏较旧的目标周期记录，并且不兼容年月表示差异。

改动：services/companionAI.js、server.js。

- 解析明确的左闭右开时间范围，统一按北京时间 UTC+8。
- 支持 2026年10月、2026-10、2026/10、年份、季度（2026年第4季度、2026-Q4）及现有季节写法（2026年秋）。春为 3—5 月，夏为 6—8 月，秋为 9—11 月，冬为当年 12 月至次年 2 月。
- 本期、本月指北京时间当前月份；非法周期返回 400 + INVALID_PERIOD。
- 日志按 createdAt 先筛周期，再倒序取最多 10 条；无有效日期的日志不参与指定周期素材。
- 成长记录按解析后的 period 筛选，再取最多 3 条；明确 period 优先，缺失时使用 createdAt，无法解析的明确 period 不回退到创建日期。
- 成长记录的来源周期必须完整落在请求范围内，避免将跨周期汇总混入月度素材。
- 无素材返回 422 + NO_MATERIAL，message 明确提示该周期无素材并建议添加陪伴记录。
- 不混入其他周期的素材或评分。未改变原有内容审核与安全降级行为。

## 线上必须先执行的 SQL

已加入 supabase_schema_app.sql。已有线上库仅需在部署新版后端前执行下列增量语句：

```sql
begin;
alter table public.app_companion_logs
  add column if not exists idempotency_key text;
create unique index if not exists idx_app_logs_volunteer_idempotency
  on public.app_companion_logs(volunteer_id, idempotency_key);
commit;
```

历史记录该列为 NULL，保持无键行为。未连接或修改线上库，未在真实 Supabase/PostgreSQL 执行迁移；SQL 的线上执行及真实库并发验证仍需部署时完成。

## 验证

修复前基线：24 项测试通过。新增回归测试先运行，3 项均失败，确认可复现缺陷。

新增 tests/confirmed-defects.test.js、tests/ai-http-state.test.js。调整 tests/ai-usage.test.js 的并发 pending 断言，以及 tests/ai-material-scope.test.js、tests/ai-resilience.test.js、tests/stage2.test.js 的周期与日期测试素材。

覆盖：HTTP 并发幂等命中、冲突文案、志愿者隔离、无键兼容、failed 同键重试、错误原因持久化、运行中与账本 pending、done 缓存、HTTP 202/502/409 响应、周期过滤先于截断、年月兼容、北京时间边界、空素材及非法周期。

最终验证（在 backend 目录执行）：

- npm test：28 项通过，0 失败。
- npm run check：29 个项目 JS 文件通过 node --check 与无 emoji 检查。

测试使用本地 JSON 与模拟服务，没有调用真实付费 AI 或线上数据库。无新增依赖。
