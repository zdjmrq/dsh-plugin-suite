/**
 * The command-guard plugin: a host-plane `tools/pre-execute` listener that is
 * ACTIVE ONLY in `careful-full-access`. Every other sandbox mode passes
 * through untouched — workspace-write is already confined by the sandbox
 * itself and danger-full-access is the user's explicit opt-out. Inside
 * careful mode every flagged command runs the model-check three-question
 * review (intent, safety, scope), disaster-tier or model-declared-dangerous
 * commands additionally require human confirmation (red-marked in the
 * approval panel, fail-closed under the `never` policy), and every non-allow
 * decision is audited twice: the complete trail goes to the rotated file log
 * `$DSH_HOME/logs/command-guard.log`, while the session log keeps only a
 * bounded, deduplicated window of decision events.
 *
 * @module @deepseek-ai/dsh-careful-full-access
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { CallId } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * One command-guard judgment for a shell tool call in careful-full-access
         * mode — the session-log side of the audit. Only non-allow judgments are
         * appended, capped per session and deduplicated by command fingerprint;
         * the complete trail lives in the rotated file log. `tier` names the
         * classifier tier, `reason` the model-facing denial or ask text, `mode`
         * the per-call sandbox mode, `modelCheck` the review outcome.
         */
        'command-guard/decision': {
            toolName: string;
            decision: 'allow' | 'deny' | 'ask';
            tier?: string;
            reason?: string;
            mode?: string;
            callId?: CallId;
            modelCheck?: 'not-intended' | 'safe' | 'dangerous' | 'unavailable';
        };
    }
}
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "command-guard";
/** The tool registry whose pre-execute waterfall this plugin listens on. */
export declare const inject: string[];
/** Plugin config. All optional — the schema supplies every default. */
export interface Config {
    /** Extra protected roots beyond the platform-derived ones (absolute paths). */
    extraProtectedPaths?: string[];
    /** How long identical commands merge into one audited entry. */
    dedupeTtlMs?: number;
    /** Kill deadline for the AST analysis spawn. */
    analyzeTimeoutMs?: number;
    /** Kill deadline for each preview/enumeration spawn. */
    previewTimeoutMs?: number;
    /** Sample-path cap in preview summaries. */
    previewSampleLimit?: number;
    /** Kill deadline for the whole model-check call. */
    modelCheckTimeoutMs?: number;
    /** Output budget for the model-check call. */
    modelCheckMaxTokens?: number;
    /** Explicit audit file path; defaults to `$DSH_HOME/logs/command-guard.log`. */
    auditLogPath?: string;
    /** Rotate the audit file once it reaches this many bytes. */
    auditLogMaxBytes?: number;
    /** How many rotated audit copies (`.1` … `.N`) are kept. */
    auditLogRotations?: number;
    /** How many decision events one session log keeps. */
    sessionDecisionCap?: number;
    /** The PowerShell helper executable. */
    pwshPath?: string;
    /** Register the deletion-discipline prompt section. */
    enablePrompt?: boolean;
}
/** Default kill deadline for the AST analysis spawn. */
export declare const DEFAULT_ANALYZE_TIMEOUT_MS = 15000;
/** Default kill deadline for each preview/enumeration spawn. */
export declare const DEFAULT_PREVIEW_TIMEOUT_MS = 15000;
/** Default sample-path cap in preview summaries. */
export declare const DEFAULT_PREVIEW_SAMPLE_LIMIT = 10;
/** Default dedupe window for identical commands. */
export declare const DEFAULT_DEDUPE_TTL_MS = 600000;
/** Default kill deadline for the model-check call. */
export declare const DEFAULT_MODEL_CHECK_TIMEOUT_MS = 20000;
/** Default output budget for the model-check call. */
export declare const DEFAULT_MODEL_CHECK_MAX_TOKENS = 300;
/** Default audit rotation size (5 MB). */
export declare const DEFAULT_AUDIT_LOG_MAX_BYTES: number;
/** Default rotated audit copies. */
export declare const DEFAULT_AUDIT_LOG_ROTATIONS = 3;
/** Default per-session decision-event cap. */
export declare const DEFAULT_SESSION_DECISION_CAP = 20;
export declare const Config: z<Config>;
/**
 * Register the pre-execute listener, the audit sinks, and the prompt section.
 * @param ctx - the host context the row mounts under.
 * @param config - the validated plugin config.
 */
export declare function apply(ctx: Context, config: Config): void;
export { GuardEngine } from './engine.ts';
export type { EngineDecision, EngineOptions, JudgeInput } from './engine.ts';
export { AuditLogger, SessionAuditGate } from './audit.ts';
export type { AuditDecision, AuditLine } from './audit.ts';
export { DedupeWindow, fingerprintCommand } from './fingerprint.ts';
export type { FingerprintNote } from './fingerprint.ts';
export { analyzeGit, isGitInvocation } from './git.ts';
export type { GitFacts } from './git.ts';
export { ModelCheckRunner, parseModelAnswer } from './model-check.ts';
export type { ModelCheckInput, ModelCheckOutcome, ModelCheckRoute, ModelCompleter } from './model-check.ts';
export { PwshAnalyzer, encodeCommand, nodeSpawner, parsePwshReport } from './analyzer.ts';
export { PreviewRunner, parseEnumeration, parseWhatIfLines, previewDenyReason, renderPreviewSummary } from './preview.ts';
export { classifyBash, classifyPwsh } from './tiers.ts';
export type { GuardTier, TierContext } from './tiers.ts';
export type { GuardVerdict } from './types.ts';
export { hasDestructiveSignal, lexBash, lexPwsh } from './lexer.ts';
export type { LexFacts } from './lexer.ts';
export { buildProtectedRoots, isBareDriveForm, isDriveRootPath, isDriveRootWildcard, isExtendedRoot, isInside, isPosixRoot, isProtectedTarget, isUncRoot, normalizeTarget, } from './protected.ts';
export type { ProtectedRoots } from './protected.ts';
export { bashVerbFamily, isPwshDynamicVerb, pwshVerbFamily } from './verbs.ts';
export type { VerbFamily } from './verbs.ts';
export type { PreviewOutcome, PwshCommandReport, PwshReport, SpawnOptions, SpawnResult, Spawner } from './types.ts';
//# sourceMappingURL=index.d.ts.map