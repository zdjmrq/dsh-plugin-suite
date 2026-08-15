# `@deepseek-ai/dsh-command-guard`

[English](README.md) | 中文

命令守卫：宿主平面的 `tools/pre-execute` 监听器，在派发前判定每一条 `pwsh`/`bash` 调用。进程内零成本词法预筛（危险动词/别名表、cmd 风格开关、.NET 删除调用、动态标记）把关后，才拉起 PowerShell AST 分析（`Parser::ParseInput`，经 `pwsh -EncodedCommand` 辅助进程；spawner 可注入，因此每条进程支撑路径都可测试）。四档分级，设计上独立于模式：

- **灾难级——任何模式下都拒绝**（含 `danger-full-access`）：盘符根、根级通配（`X:\*`）、UNC 与 `\\?\` 根、用户主目录、系统目录、工作区根、format/磁盘家族（`Format-*`、`Clear-Disk`、`Initialize-Disk`、`Remove-Partition`）、`diskpart clean`、向受保护根 `robocopy /MIR`、以及受保护根的递归 .NET 删除。
- **高风险——审批**（approval 为 `never` 时 fail-closed）：工作区外递归强制删除、动态目标（`$var`、`$env:`、`iex`）的递归删除、清空回收站、批量删除。
- **普通——放行**：单个显式路径的非递归删除。
- **无法解析——审批**：AST/词法失败与动态执行；`iex` 绝不漏过闸门。

每次非放行判定都写入 log-only 的 `command-guard/decision` 会话事件，并由系统提示段教授模型配合遵守的删除纪律。

在 `careful-full-access` 沙箱模式下，每条非灾难删除还要走预演管线：WhatIf 干跑（`$WhatIfPreference = $true`——由 PowerShell 自身解析真实范围，通配、变量与 `$env:` 展开不可能被误读）、递归目录目标的只读子树枚举（干跑只打印顶层目录）、以及 model-check 两步协议——首次提交被拒绝并附有界预览摘要（"…原样重发以确认执行"），原样重发（命令指纹，会话隔离、带 TTL、一次性）直接执行且不再预演，无法预演的删除（`iex`、原生 exe、干跑失败）直接拒绝。解析出的目标若命中受保护根，在确认环节之前直接拒绝。

## 插件

- 名称：`command-guard`
- inject：`['tools']`；挂载 `ctx.sandboxPolicy` 时读取每次调用的模式与工作区根。
- Config：`extraProtectedPaths`、`confirmTtlMs`、`analyzeTimeoutMs`、`previewTimeoutMs`、`previewSampleLimit`、`pwshPath`、`enablePrompt`。

## 模型体验

### 删除纪律提示段

#### 模型看到什么

`command-guard:deletion-discipline` 段（order 112）：守卫执行的删除规则——优先 `-WhatIf` 干跑或显式列举、绝不递归进入受保护根、把未定义的 `$env:` 变量视为错误、以及 careful 模式的原样重发协议。

#### Token 影响

插件激活期间每个请求固定一段话。

#### KV Cache 影响

文本不变的条件下前缀稳定；插件激活或卸载可能使复用失效。

### 受守卫调用的结果

#### 模型看到什么

被拒调用物化为 `Error: command guard: …` 工具结果；高风险审批走普通审批通道；careful 模式的预演拒绝携带有界范围摘要（"此删除将影响 N 个对象…原样重发以确认执行"）。

#### Token 影响

预览摘要上有界（≤约 150 token）；两步协议每次删除约多一次模型往返，只与删除次数成正比。非删除调用零开销。

#### KV Cache 影响

仅追加；预演拒绝与重发的调用像普通工具交换一样进入历史。

## 已知局限与暂缓项

- `iex`/动态构造无法静态分析——fail-closed（普通模式审批，careful 模式拒绝）。
- bash 没有 WhatIf 等价物：POSIX 上 careful 模式退化为分级规则。
- 跟随 junction 的递归删除（[PowerShell#26913](https://github.com/PowerShell/PowerShell/issues/26913)）被通配/递归规则归为高风险，但静态上无法识别其具体形态。
- manual/auto 确认策略、持久化规则表（"始终允许此模式"）与 L4 可恢复层（软删除/git undo）暂缓。
