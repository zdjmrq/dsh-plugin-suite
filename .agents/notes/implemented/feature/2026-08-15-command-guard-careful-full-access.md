# Agent Note: command-guard and the careful-full-access mode

Status: implemented

English | [中文](2026-08-15-command-guard-careful-full-access.zh.md)

## Problem

Accidental deletion was the top unguarded failure mode: a misparsed `Remove-Item -Recurse -Force C:\` ran verbatim under `danger-full-access` (sandbox off, approvals off), and even under `workspace-write` the whole workspace tree — root included — was deletable, because `GRANT_MASK` (`0x00110156`) carried DELETE and FILE_DELETE_CHILD with OI|CI inheritance onto every object including the workspace root itself. Research (three parallel investigations of AI-CLI permission systems, safe-deletion tools, and filesystem interception) converged on three layers: command semantic analysis (gemini-cli's AST-over-regex approach), a guarded full-access mode with a two-step model-check confirmation, and an ACE split that keeps the workspace root undeletable.

## Decision

- New package `@deepseek-ai/dsh-careful-full-access` (`packages/guard/careful-full-access`): a host-plane `tools/pre-execute` listener judging every `pwsh`/`bash` call. A zero-cost in-process lexical pre-scan (destructive verb/alias table, cmd-style switches, `.NET` deletion calls, dynamic markers) gates a PowerShell AST pass (`Parser::ParseInput` via a helper `pwsh -EncodedCommand` invocation, injectable spawner for tests). Four tiers: disaster (deny in EVERY mode — drive roots, root wildcards, UNC/extended roots, user profile, system dirs, workspace root, format/disk family, `diskpart clean`, `robocopy /MIR` into protected roots, recursive `.NET` deletion), high-risk (ask: recursive+force outside the workspace, dynamic targets, recycle-bin clearing, batch deletes), normal (allow), unparseable (fail-closed ask; `iex`/dynamic construction never slips through). Every non-allow judgment is audited as a log-only `command-guard/decision` session event; a system-prompt section teaches the deletion discipline.
- New sandbox mode `careful-full-access`: unconfined like `danger-full-access`, but every non-disaster deletion runs a WhatIf dry run (`$WhatIfPreference = $true` — the engine resolves the REAL scope, so wildcards/variables/`$env:` cannot be misread), a recursive-directory subtree enumeration, then the model-check two-step protocol: the first submission is denied with a bounded preview summary ("this deletion resolves to N objects… re-send the identical command to confirm"), a command-fingerprint match on the identical resubmission executes without re-previewing, and unpreviewable deletions (`iex`, native exes) are denied outright. Unconfirmed fingerprints expire after a TTL. Preview summaries are bounded (≤ ~150 tokens) so the protocol costs roughly one extra model round-trip per deletion, proportional to deletion count only.
- `sandbox-windows-acl` workspace grants split into TWO ACEs: an inherit-only `(OI|CI|IO)` full-GRANT_MASK ACE (descendants keep the Write+Delete the child needs for delete/rename/git) and a root-only `ROOT_GRANT_MASK` (`0x00100116` — no DELETE, no FILE_DELETE_CHILD) ACE. The pre-split single-ACE shape is migrated in place (one revoke+pair merge). Renaming the root is denied universally (rename checks DELETE on the object). Root DELETION goes through the parent's FILE_DELETE_CHILD, so the ACL blocks it whenever the parent carries no grant for the caller — parents with ambient same-user/Everyone-style ACEs stay the documented partial boundary, and the command guard's disaster tier is the primary root-deletion defense.
- Permission presets gain the third entry `careful-full-access` (sandbox: careful-full-access, approval: ask) between `workspace-write` and `danger-full-access`; the existing settings persistence makes the choice durable. `WIDER_MODES`/`ESCALATION_TARGETS` place the mode as the intermediate escalation rung, and every unconfined-mode branch (`pwsh-sandbox`, `bash-sandbox`, `fs-sandbox`, `terminal-bash`) shares the new `isUnconfinedMode` predicate.

## Consequences

- Disaster-tier deletions are refused in every sandbox mode, including `danger-full-access` with approvals off.
- `careful-full-access` keeps the full-access experience; only deletions pay the preview + model-check round-trip.
- The workspace root can no longer be renamed by the confined child, and root deletion is blocked whenever the parent grants the caller nothing — the ambient-parent case stays the documented partial boundary.
- New durable vocabulary: the `command-guard/decision` session event and the `careful-full-access` sandbox mode (policy text, tool escalation enums, preset table, UI picker).

## Alternatives considered

- `workspace-granted` path-level escalation: rejected — the user wanted the full-access experience with deletion caution, not per-path approvals.
- Recycle-bin soft delete: measured to silently degrade to permanent deletion under the restricted token (`$Recycle.Bin` unwritable), so it would be a false sense of security; deferred with the rest of L4.
- minifilter deletion interception: highest assurance, highest cost (signing, driver, BSOD risk) — future option only.
- Manual/auto confirmation strategies and the persistent rules table: deferred; model-check is the only v1 strategy.
