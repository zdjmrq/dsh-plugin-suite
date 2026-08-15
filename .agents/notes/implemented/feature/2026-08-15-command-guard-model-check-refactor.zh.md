# Agent Note：command-guard 仅守 careful 的 model-check 重构

Status: implemented

[English](2026-08-15-command-guard-model-check-refactor.md) | 中文

## 问题

v1 守卫与它所依附的沙箱模式相矛盾：它在**所有**模式下拦截灾难级删除（包括用户明确选择的放手模式 `danger-full-access`），而 careful 档的"首次提交拒绝、原样重发执行"指纹协议每条删除都要多花一整轮模型往返，且盘符根级灾难也只由模型自查兜底。用户的下一轮需求：守卫只守 careful-full-access；复核改为向模型提出三个明确问题（意图、安全、范围），取代盲发协议；灾难级命令永不自动放行——必须有人工兜底；会话日志审计（无限增长）改为轮转文件日志 + 有界会话窗口。

## 决策

- 模式门控：`tools/pre-execute` 监听器对除 `careful-full-access` 外的所有模式直接 `next()`——workspace-write（沙箱已约束）与 danger-full-access（用户明确放手）下零守卫工作、零审计。
- 新决策流：静态四档（`normal` 放行、`elevated` 走 model-check、`disaster` 走 model-check 且永不自动放行、`unparseable` 按 disaster 对待）。每条被标记命令进入复核路由：pwsh 删除先经 WhatIf 干跑 + 子树枚举解析真实范围（干跑解析到受保护根时升级为 disaster 档），随后 model-check——一次对**会话当前路由模型**的有界调用（`ctx.get('llm')`，温度 0、约 300 token 上限、超时即弃、fail-closed），展示命令全文/档位/原因/范围，要求以严格 JSON 回答三个问题。结果映射：`intent: no` → 直接拒绝并附模型自己的解释；`intent: yes + safe` → elevated 放行、disaster → 红色人工确认；`yes + dangerous` → 无论哪档一律人工确认并附风险自述；不可用/超时/不可解析 → 按 disaster 兜底（人工确认，`never` 下自动拒绝）。
- 人工兜底：确认走常规审批通道，新增 `severity: 'danger'` 标注，从 `PreToolDecision.ask` → `ApprovalRequest` → `approval/asked` → `approval/requested` mux 帧 → 审批面板红色条带/边框/圆点（error alias token）一路透传，灾难级确认视觉上不可混淆。
- 审计重构：完整流水写入轮转文件日志 `$DSH_HOME/logs/command-guard.log`（默认 5 MB × 3 份、串行异步追加、失败吞入 `onError`），会话事件设上限（默认每会话 20 条），相同命令在去重 TTL（默认 10 分钟）内合并计数（重复只向文件日志追加紧凑的 `{event: repeat, count}` 标记行）。所有判定——放行/拒绝/确认——都审计。
- 词法修正（实战反馈）：顶层动词分派（`git.ts`）——`git rm --cached`/`-n`/`--staged` 只动索引（normal），不带它们的 `git rm`、`git clean`、`git reset --hard` 为 elevated，`git -C repo status` 式取值选项正确跳过，非顶层 git 退回通用扫描（记为已知局限）。旧两步指纹协议（`PendingConfirmations`）由去重窗口取代。

## 后果

- 其他沙箱模式零成本、不再被二次猜疑；careful 档用户得到预期中的"全权限体验 + 删除审慎"。
- 每条被标记命令花费一次小型 model-check 调用（有界 token、温度 0），删除命令另有一次 WhatIf 子进程；灾难档与模型自称危险的命令永不只由模型自己说了算。
- 会话日志不再因守卫决策无限膨胀；文件日志成为持久、轮转的完整流水。
- 新词汇：审批请求/帧/事件的 `severity?: 'danger'`；`command-guard/decision` 事件新增 `tier` 与 `modelCheck` 字段；配置键 `dedupeTtlMs`、`modelCheckTimeoutMs`、`modelCheckMaxTokens`、`auditLogPath`、`auditLogMaxBytes`、`auditLogRotations`、`sessionDecisionCap`（取代 `confirmTtlMs`）。

## 备选方案

- 保留重发指纹协议：否决——多花一整轮模型往返，且盘符根删除的唯一权威是复核模型自己。
- 以会话轮次而非旁路调用向模型提问：否决——结构化一次性 JSON 调用不动历史 KV 前缀，答案解析确定。
- 每条被标记命令都人工确认：否决——elevated 单文件删除正是 careful 档应该让模型确认意图后放行的场景。
- 持久化规则表（"始终允许此模式"）与 L4 软删除恢复：仍为后续项，与 v1 笔记一致。
