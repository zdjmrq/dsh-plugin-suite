# `@deepseek-ai/dsh-careful-full-access`

[English](README.md) | 中文

命令守卫：一个挂在 `tools/pre-execute` 的宿主侧监听器，**只在 `careful-full-access` 模式下生效**。其他沙箱模式完全不受干预——`workspace-write` 本身已受沙箱约束，`danger-full-access` 是用户明确的放手选择。在 careful 模式下，守卫用零成本的进程内词法预筛（危险动词/别名表、cmd 风格开关、`.NET` 删除调用、动态标记、顶层 `git` 子命令分派）为每条 `pwsh`/`bash` 调用分级，必要时再拉起 PowerShell AST 精析（经辅助 `pwsh -EncodedCommand` 调用 `Parser::ParseInput`；spawner 可注入，所有进程路径都可测试）。四级：

- **normal —— 放行**：非破坏性命令，以及 `git rm --cached`/`-n`（只操作索引）。
- **elevated —— model-check**：所有删除/格式化/镜像动词——包括单个显式删除、`git clean`、`git reset --hard`、清空回收站、动态目标的递归删除、批量删除。
- **disaster —— model-check 且永不自动放行**：盘符根、根通配（`X:\*`）、UNC 与 `\\?\` 根、用户主目录、系统目录、工作区根、格式化族（`Format-*`、`Clear-Disk`、`Initialize-Disk`、`Remove-Partition`）、`diskpart clean`、向受保护根 `robocopy /MIR`、受保护根的递归 `.NET` 删除。
- **unparseable —— 按 disaster 对待**：AST/词法失败与动态执行；`iex` 绝不漏过闸门。

每个被标记的命令进入复核路由。pwsh 方言的删除命令先经 WhatIf 干跑解析**真实范围**（`$WhatIfPreference = $true`——通配、变量、`$env:` 由 PowerShell 自己展开，守卫的解析不可能成为误读的那一环），递归目录目标再补一次只读子树枚举。解析出的范围随后送入 **model-check**：一次对会话当前路由模型的小调用，展示命令全文、静态档位、标记原因与预演范围，要求模型以严格 JSON 回答三个问题（这是不是本意的命令？是否安全且在预期范围内？是否确实危险？）。回答决定走向：

- **模型说"非本意"** → 直接拒绝，附模型自己的解释（这正是守卫存在的误解析场景——模型自己否认了命令，无需人工确认）。
- **模型说"本意且安全"** → elevated 档放行；disaster 档仍需**人工确认**（最重一级永远由人类兜底）。
- **模型说"危险"** → 无论哪档一律人工确认，附模型的风险自述。
- **model-check 不可用**（无路由、超时、失败、答案不可解析）→ 按 disaster 兜底：人工确认。

人工确认走常规审批通道：请求携带命令全文、档位标注（`DISASTER tier`，经 `severity: 'danger'` 在审批面板红色突出）与模型复核结论；审批策略为 `never` 时自动拒绝（该会话中被标记的命令不可执行）。

每个判定——放行、拒绝、人工确认——都双重审计。完整流水写入轮转文件日志 `$DSH_HOME/logs/command-guard.log`（默认 5 MB × 3 份轮转），会话日志只保留有限的 `command-guard/decision` 事件窗口（默认每会话 20 条），相同命令在去重 TTL（默认 10 分钟）内合并计数。

## 插件

- name：`command-guard`
- inject：`['tools']`；挂载时读取 `ctx.sandboxPolicy` 获取每次调用的模式与工作区根，读取 `ctx.llm` 获取 model-check 路由。
- Config：`extraProtectedPaths`、`dedupeTtlMs`、`analyzeTimeoutMs`、`previewTimeoutMs`、`previewSampleLimit`、`modelCheckTimeoutMs`、`modelCheckMaxTokens`、`auditLogPath`、`auditLogMaxBytes`、`auditLogRotations`、`sessionDecisionCap`、`pwshPath`、`enablePrompt`。

## 模型体验

### 删除纪律提示段

#### 模型看到什么

一段 `command-guard:deletion-discipline`（order 112）：守卫执行的删除规则——优先 `-WhatIf` 干跑或显式列举，绝不递归进受保护根，把未定义的 `$env:` 变量当错误，以及 careful 模式的复核协议（被标记命令由模型自查，disaster 档还需人工确认）。

#### Token 影响

插件激活期间每次请求一段固定文本。

#### KV 缓存影响

段落文本不变时前缀稳定；插件激活或卸载可能使复用失效。

### 被守卫的调用结果

#### 模型看到什么

被拒绝的调用以 `Error: command guard: …` 工具结果呈现（模型否认命令时附模型自己的解释）；人工确认经常规审批面板呈现命令全文、档位标注与复核结论；被放行的标记命令返回正常工具结果。

#### Token 影响

每条被标记命令多一次小型 model-check 调用（输出上限约 300 token、温度 0），删除命令另有预演摘要。未标记命令只付词法扫描成本；其他沙箱模式的命令零成本（守卫不介入）。

#### KV 缓存影响

纯追加：model-check 是旁路查询而非会话轮次，不扰动历史前缀；人工确认像任何审批交换一样进入历史。

## 已知局限与后续项

- `iex`/动态构造无法静态分析——fail-closed（按 disaster：人工确认，`never` 下自动拒绝）。
- bash 无 WhatIf 等价物：POSIX 上复核不带解析出的范围摘要。
- 只有**顶层** `git` 调用获得子命令分派；管道或嵌套的 `git` 退回通用扫描，可能误读其子命令语义。
- model-check 每条被标记命令消耗一次模型调用（延迟与 token），其判断质量取决于复核模型——这正是 disaster 档与模型自称危险的命令永远以人工收尾的原因。
- manual/auto 确认策略、持久化规则表（"始终允许此模式"）与 L4 可恢复层（软删除/git 撤销）为后续项。
