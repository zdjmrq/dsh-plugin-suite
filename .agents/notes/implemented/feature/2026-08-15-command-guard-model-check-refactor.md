# Agent Note: command-guard careful-only model-check refactor

Status: implemented

English | [中文](2026-08-15-command-guard-model-check-refactor.zh.md)

## Problem

The v1 guard contradicted the sandbox modes it rode on: it blocked disaster-tier deletions in EVERY mode (including `danger-full-access`, which users chose as the explicit opt-out), while the careful mode's "first submission denied, identical resubmission executes" fingerprint protocol demanded a full extra model round-trip per deletion and left the model's self-check as the only authority even for drive-root disasters. The user's next-round requirements: the guard must be careful-full-access only; the review must ask the model three explicit questions (intent, safety, scope) instead of the blind resend protocol; disaster-tier commands must never be auto-allowed — a human backstop is mandatory; and the session-log-only audit (unbounded growth) must move to a rotated file log with a bounded session window.

## Decision

- Mode gate: the `tools/pre-execute` listener returns `next()` for every mode except `careful-full-access` — no guard work, no audit, in workspace-write (already confined) and danger-full-access (user's opt-out).
- New decision flow: four static tiers (`normal` allow, `elevated` model-check, `disaster` model-check + never auto-allow, `unparseable` treated as disaster). Every flagged command runs the review route: pwsh deletions first resolve their real scope via the WhatIf dry run + subtree enumeration (a protected-root hit upgrades the tier to disaster), then a model-check — one bounded call to the SESSION's routed model (`ctx.get('llm')`, temperature 0, ~300 token cap, kill deadline, fail-closed) that shows command/tier/reason/scope and demands a strict JSON answer to three questions. Outcomes: `intent: no` → deny outright with the model's own explanation; `intent: yes + safe` → elevated allow, disaster → danger-marked human confirmation; `yes + dangerous` → human confirmation for every tier with the model's risk statement; unavailable/timeout/unparseable → fail closed as disaster (human confirmation; auto-reject under `never`).
- Human backstop: the confirmation rides the ordinary approval seam with a new `severity: 'danger'` marking threaded from `PreToolDecision.ask` → `ApprovalRequest` → `approval/asked` → the `approval/requested` mux frame → the approval panel's red band/border/dot (error alias tokens), so disaster-tier confirmations are visually unmistakable.
- Audit rework: the complete trail goes to the rotated file log `$DSH_HOME/logs/command-guard.log` (default 5 MB × 3 copies, serialized async appends, failures contained into `onError`), while session events are capped (default 20 per session) and identical commands merge into one counted entry inside the dedupe TTL (default 10 minutes; repeats append a compact `{event: repeat, count}` marker line to the file log only). Every decision — allow, deny, ask — is audited.
- Lexer fixes from field findings: top-level verb dispatch (`git.ts`) — `git rm --cached`/`-n`/`--staged` is index-only (normal), `git rm` without it, `git clean`, and `git reset --hard` are elevated, `git -C repo status`-style option skipping is handled, and non-top-level git falls back to the generic scan (documented limitation). The old two-step fingerprint protocol (`PendingConfirmations`) is replaced by the dedupe window.

## Consequences

- Other sandbox modes pay nothing and are never second-guessed; careful mode users get the intended "full-access experience with deletion caution".
- Every flagged command costs one small model-check call (bounded tokens, temperature 0) plus one WhatIf spawn for deletions; the model's judgment is never the final word for disaster tiers or self-declared-dangerous commands.
- Session logs stop growing without bound from guard decisions; the file log is the durable, rotated trail.
- New vocabulary: `severity?: 'danger'` on the approval request/frame/event; `command-guard/decision` events now carry `tier` and `modelCheck`; config keys `dedupeTtlMs`, `modelCheckTimeoutMs`, `modelCheckMaxTokens`, `auditLogPath`, `auditLogMaxBytes`, `auditLogRotations`, `sessionDecisionCap` (replacing `confirmTtlMs`).

## Alternatives considered

- Keep the resend-fingerprint protocol: rejected — it cost a full model round-trip and made the reviewing model the sole authority even for root deletions.
- Ask the model through a conversation turn instead of a side call: rejected — a structured one-shot JSON call keeps the transcript's KV prefix untouched and answers parse deterministically.
- Human confirmation for every flagged command: rejected — elevated single deletes are exactly what careful mode should let flow after the model confirms intent.
- Persistent rules table ("always allow this") and L4 soft-delete recovery: still deferred; unchanged from the v1 note.
