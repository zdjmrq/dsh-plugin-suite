# `@deepseek-ai/dsh-command-guard`

English | [中文](README.zh.md)

The command guard: a host-plane `tools/pre-execute` listener that judges every `pwsh`/`bash` call before dispatch. A zero-cost in-process lexical pre-scan (destructive verb/alias table, cmd-style switches, `.NET` deletion calls, dynamic markers) gates a PowerShell AST pass (`Parser::ParseInput` through a helper `pwsh -EncodedCommand` invocation; the spawner is injectable, so every process-backed path is testable). Four tiers, mode-independent by design:

- **disaster — denied in EVERY mode** (including `danger-full-access`): drive roots, root wildcards (`X:\*`), UNC and `\\?\` roots, the user profile, system directories, the workspace root, the format/disk family (`Format-*`, `Clear-Disk`, `Initialize-Disk`, `Remove-Partition`), `diskpart clean`, `robocopy /MIR` into a protected root, and recursive `.NET` deletion of a protected root.
- **high-risk — ask** (fails closed under approval `never`): recursive+force outside the workspace, recursive deletion with dynamic targets (`$var`, `$env:`, `iex`), recycle-bin clearing, batch deletions.
- **normal — allow**: single explicit non-recursive deletions.
- **unparseable — ask**: AST/lex failures and dynamic execution; `iex` never slips through the gate.

Every non-allow judgment is audited as a log-only `command-guard/decision` session event, and a system-prompt section teaches the deletion discipline the model cooperates with.

In the `careful-full-access` sandbox mode every non-disaster deletion additionally runs the preview pipeline: a WhatIf dry run (`$WhatIfPreference = $true` — PowerShell itself resolves the REAL scope, so wildcards, variables, and `$env:` expansions cannot be misread), a read-only subtree enumeration for recursive directory targets (the dry run alone prints only the top directory), and the model-check two-step protocol — the first submission is denied with a bounded preview summary (`…re-send the identical command to confirm execution`), an identical resubmission (command fingerprint, session-scoped, TTL'd, one-shot) executes without re-previewing, and unpreviewable deletions (`iex`, native executables, dry-run failures) are denied outright. Resolved targets that ARE protected roots refuse before the confirmation leg.

## Plugin

- name: `command-guard`
- inject: `['tools']`; reads `ctx.sandboxPolicy` when mounted for the per-call mode and workspace root.
- Config: `extraProtectedPaths`, `confirmTtlMs`, `analyzeTimeoutMs`, `previewTimeoutMs`, `previewSampleLimit`, `pwshPath`, `enablePrompt`.

## Model Experience

### Deletion-discipline prompt section

#### What the model sees

A `command-guard:deletion-discipline` section (order 112): the deletion rules the guard enforces — prefer a `-WhatIf` dry run or an explicit listing, never recurse into protected roots, treat undefined `$env:` variables as errors, and the careful-mode resubmission protocol.

#### Token effect

One fixed paragraph per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the section text is unchanged; plugin activation or disposal may invalidate reuse.

### Guarded call outcomes

#### What the model sees

Denied calls materialize as `Error: command guard: …` tool results; high-risk asks surface through the ordinary approval channel; careful-mode preview denials carry the bounded scope summary ("this deletion resolves to N objects … re-send the identical command to confirm execution").

#### Token effect

Preview summaries are bounded (≤ ~150 tokens); the two-step protocol costs roughly one extra model round-trip per deletion, proportional to deletion count only. Non-deletion calls pay nothing.

#### KV Cache effect

Append-only; the preview denial and the resubmitted call enter history like any tool exchange.

## Known Limitations and Deferred Work

- `iex`/dynamic construction cannot be statically analyzed — fail-closed (ask in ordinary modes, deny in careful mode).
- Bash has no WhatIf equivalent: careful mode degrades to the tier rules on POSIX.
- Junction-following recursive deletion ([PowerShell#26913](https://github.com/PowerShell/PowerShell/issues/26913)) is flagged high-risk by the wildcard/recursion rules but not statically detected as such.
- The manual/auto confirmation strategies, the persistent rules table ("always allow this"), and the L4 recoverability layer (soft delete/git undo) are deferred.
