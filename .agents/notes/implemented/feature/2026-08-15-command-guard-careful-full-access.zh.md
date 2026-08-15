# Agent Note: command-guard 与 careful-full-access 模式

Status: implemented

[English](2026-08-15-command-guard-careful-full-access.md) | 中文

## Problem

误删是之前完全无防护的失败模式：一条解析错误的 `Remove-Item -Recurse -Force C:\` 在 `danger-full-access`（沙箱关、审批关）下原样执行；即使在 `workspace-write` 下，整个工作区树——包括根目录对象——也可被删除，因为 `GRANT_MASK`（`0x00110156`）携带 DELETE 与 FILE_DELETE_CHILD，并以 OI|CI 继承到每个对象（含工作区根本身）。三路调研（AI-CLI 权限体系、防误删工具、文件系统拦截）收敛为三层：命令语义分析（gemini-cli 的"AST 而非正则"思路）、带两步模型复核确认的审慎全权限模式、以及让工作区根不可删除的 ACE 拆分。

## Decision

- 新包 `@deepseek-ai/dsh-command-guard`（`packages/guard/command-guard`）：宿主平面的 `tools/pre-execute` 监听器，判定每一条 `pwsh`/`bash` 调用。进程内零成本词法预筛（危险动词/别名表、cmd 风格开关、.NET 删除调用、动态标记）把关后，才拉起 PowerShell AST 分析（`Parser::ParseInput`，经 `pwsh -EncodedCommand` 辅助进程，spawner 可注入以便测试）。四档分级：灾难级（任何模式下拒绝——盘符根、根级通配、UNC/扩展根、用户主目录、系统目录、工作区根、format/磁盘家族、`diskpart clean`、向受保护根 `robocopy /MIR`、递归 .NET 删除）、高风险（审批：工作区外递归强制删除、动态目标、清空回收站、批量删除）、普通（放行）、无法解析（fail-closed 审批；`iex`/动态构造绝不漏过）。每次非放行判定都写入 log-only 的 `command-guard/decision` 会话事件；系统提示段教授删除纪律。
- 新沙箱模式 `careful-full-access`：与 `danger-full-access` 同样不受限，但每条非灾难删除都要走 WhatIf 干跑（`$WhatIfPreference = $true`——由引擎解析真实范围，通配/变量/`$env:` 不可能被误读）、递归目录子树枚举，然后是 model-check 两步协议：首次提交被拒绝并附有界预览摘要（"此删除将影响 N 个对象…原样重发以确认执行"），命令指纹匹配的原样重发直接执行（不再重复预演），无法预演的删除（`iex`、原生 exe）直接拒绝。未确认的指纹按 TTL 过期。预览摘要上有界（≤约 150 token），协议成本约为每次删除一次额外模型往返，只与删除次数成正比。
- `sandbox-windows-acl` 的工作区授权拆为两条 ACE：inherit-only `(OI|CI|IO)` 完整 GRANT_MASK ACE（子孙保留子进程删除/改名/git 所需的 Write+Delete）与仅根的 `ROOT_GRANT_MASK`（`0x00100116`——无 DELETE、无 FILE_DELETE_CHILD）ACE。拆分前的单 ACE 形态原地迁移（一次 revoke+pair 合并）。根改名被普遍拒绝（改名检查对象自身 DELETE）。根删除走父目录的 FILE_DELETE_CHILD，因此只要父目录没有授予调用者的 ACE，ACL 就能拦住；带环境同用户/Everyone 类 ACE 的父目录仍是既有文档记载的 partial 边界，命令守卫的灾难级才是根删除的主防线。
- 权限预设新增第三档 `careful-full-access`（sandbox: careful-full-access，approval: ask），位于 `workspace-write` 与 `danger-full-access` 之间；既有 settings 持久化使选择跨会话保持。`WIDER_MODES`/`ESCALATION_TARGETS` 把它作为中间提升档位，所有非受限模式分支（`pwsh-sandbox`、`bash-sandbox`、`fs-sandbox`、`terminal-bash`）共享新的 `isUnconfinedMode` 谓词。

## Consequences

- 灾难级删除在任何沙箱模式下都被拒绝，包括关闭审批的 `danger-full-access`。
- `careful-full-access` 保留全权限体验；只有删除付出预演 + model-check 往返。
- 受限子进程无法再改名工作区根，且父目录未向调用者授权时根删除被阻止——带环境授权的父目录仍属既有 partial 边界。
- 新增持久化词汇：`command-guard/decision` 会话事件与 `careful-full-access` 沙箱模式（策略文案、工具提升枚举、预设表、UI 选择器）。

## Alternatives considered

- `workspace-granted` 路径级授权：否决——用户要的是全权限体验 + 删除审慎，而非逐路径申请授权。
- 回收站软删除：实测在受限令牌下会静默降级为永久删除（`$Recycle.Bin` 不可写），是虚假安全感；与 L4 其余内容一并暂缓。
- minifilter 删除拦截：保证最高、成本最高（签名/驱动/蓝屏风险）——仅作远期选项。
- manual/auto 确认策略与持久化规则表：暂缓；model-check 是 v1 唯一策略。
