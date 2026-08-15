# `@deepseek-ai/dsh-careful-full-access`

English | [中文](README.zh.md)

The command guard: a host-plane `tools/pre-execute` listener that is **active only in `careful-full-access`**. Every other sandbox mode passes through untouched — `workspace-write` is already confined by the sandbox itself and `danger-full-access` is the user's explicit opt-out. Inside careful mode the guard classifies every `pwsh`/`bash` call with a zero-cost in-process lexical pre-scan (destructive verb/alias table, cmd-style switches, `.NET` deletion calls, dynamic markers, top-level `git` subcommand dispatch) that gates a PowerShell AST pass (`Parser::ParseInput` through a helper `pwsh -EncodedCommand` invocation; the spawner is injectable, so every process-backed path is testable). Four tiers:

- **normal — allow**: non-destructive commands, and `git rm --cached`/`-n` (index-only).
- **elevated — model-check**: every delete/format/mirror verb — including single explicit deletions, `git clean`, `git reset --hard`, recycle-bin clearing, recursive deletions with dynamic targets, and batch deletions.
- **disaster — model-check, never auto-allowed**: drive roots, root wildcards (`X:\*`), UNC and `\\?\` roots, the user profile, system directories, the workspace root, the format/disk family (`Format-*`, `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`), `diskpart clean`, `robocopy /MIR` into a protected root, and recursive `.NET` deletion of a protected root.
- **unparseable — treated as disaster**: AST/lex failures and dynamic execution; `iex` never slips through the gate.

Every flagged command runs the review route. Deletions in the pwsh dialect first resolve their REAL scope through a WhatIf dry run (`$WhatIfPreference = $true` — PowerShell itself expands wildcards, variables, and `$env:`, so the guard's parsing cannot be the thing that misreads them), plus a read-only subtree enumeration for recursive directory targets. The resolved scope then rides into the **model-check**: a one-shot call to the session's routed model that shows the command text, its static tier, why it was flagged, and the previewed scope, and demands a strict JSON answer to three questions (is this the intended command? is it safe and in scope? is it genuinely dangerous?). The answer decides the outcome:

- **model says "not intended"** → the command is denied outright with the model's own explanation (the misparse case the guard exists for — no human confirmation needed, the model disowned the command itself).
- **model says "intended and safe"** → elevated commands run; disaster-tier commands still require **human confirmation** (the heaviest tier is always backstopped by a human).
- **model says "dangerous"** → human confirmation for every tier, carrying the model's own risk statement.
- **model-check unavailable** (no route, timeout, failure, unparseable answer) → fail closed as disaster: human confirmation.

Human confirmations route through the ordinary approval seam: the request carries the command text, the tier heading (`DISASTER tier` in red via `severity: 'danger'`), and the model-check conclusion; under approval policy `never` they are auto-rejected (flagged commands simply cannot run in that session).

Every decision — allow, deny, or human-confirm — is audited twice. The complete trail goes to the rotated file log `$DSH_HOME/logs/command-guard.log` (5 MB × 3 rotated copies by default), while the session log keeps only a bounded window of `command-guard/decision` events (20 per session by default) with identical commands merged into one counted entry inside the dedupe TTL (10 minutes by default).

## Plugin

- name: `command-guard`
- inject: `['tools']`; reads `ctx.sandboxPolicy` for the per-call mode and workspace root, and `ctx.llm` for the model-check route.
- Config: `extraProtectedPaths`, `dedupeTtlMs`, `analyzeTimeoutMs`, `previewTimeoutMs`, `previewSampleLimit`, `modelCheckTimeoutMs`, `modelCheckMaxTokens`, `auditLogPath`, `auditLogMaxBytes`, `auditLogRotations`, `sessionDecisionCap`, `pwshPath`, `enablePrompt`.

## Model Experience

### Deletion-discipline prompt section

#### What the model sees

A `command-guard:deletion-discipline` section (order 112): the deletion rules the guard enforces — prefer a `-WhatIf` dry run or an explicit listing, never recurse into protected roots, treat undefined `$env:` variables as errors, and the careful-mode review protocol (flagged commands are reviewed by the model itself; disaster-tier targets additionally require human confirmation).

#### Token effect

One fixed paragraph per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the section text is unchanged; plugin activation or disposal may invalidate reuse.

### Guarded call outcomes

#### What the model sees

Denied calls materialize as `Error: command guard: …` tool results (including the model-check's own explanation when it disowned the command); human confirmations surface through the ordinary approval panel with the command text, the tier heading, and the model-check conclusion; allowed flagged commands return their normal tool results.

#### Token effect

Each flagged command costs one extra small model-check call (bounded to ~300 output tokens, temperature 0) plus the preview summary where a deletion runs one. Non-flagged commands pay only the lexical scan; commands in other sandbox modes pay nothing (the guard does not engage).

#### KV Cache effect

Append-only: the model-check call is a side query, not a conversation turn, so it does not disturb the transcript's cache prefix; human confirmations enter history like any approval exchange.

## Known Limitations and Deferred Work

- `iex`/dynamic construction cannot be statically analyzed — fail closed (treated as disaster: human confirmation, or auto-reject under `never`).
- Bash has no WhatIf equivalent: the review runs without a resolved scope summary on POSIX.
- Only a TOP-LEVEL `git` invocation gets subcommand dispatch; a piped or nested `git` falls back to the generic scan, which may misread its subcommand semantics.
- The model-check consumes one model call per flagged command (latency and tokens), and its quality inherits the reviewing model's judgment — which is exactly why disaster tiers and model-declared-dangerous commands always end at a human.
- The manual/auto confirmation strategies, the persistent rules table ("always allow this"), and the L4 recoverability layer (soft delete/git undo) are deferred.
