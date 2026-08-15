/**
 * The command-guard plugin: a host-plane `tools/pre-execute` listener that
 * judges every `pwsh`/`bash` call before dispatch. Disaster-tier deletions are
 * denied in every sandbox mode; high-risk ones ask through the ordinary
 * approval pipeline (fail-closed under `never`); and in `careful-full-access`
 * every non-disaster deletion runs the WhatIf preview plus the model-check
 * two-step confirmation. Every non-allow judgment is audited as a
 * `command-guard/decision` session event, and a system-prompt section teaches
 * the deletion discipline the model cooperates with.
 *
 * @module @deepseek-ai/dsh-command-guard
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { CallId } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * One command-guard judgment for a shell tool call — log-only audit. Only
         * non-allow judgments are appended (an allow leaves no trail by design:
         * the call ran normally). `tier` names the classifier tier, `reason` the
         * model-facing denial or ask text, `mode` the per-call sandbox mode.
         */
        'command-guard/decision': {
            toolName: string;
            decision: 'allow' | 'deny' | 'ask';
            tier?: string;
            reason?: string;
            mode?: string;
            callId?: CallId;
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
    /** How long an unconfirmed preview stays confirmable. */
    confirmTtlMs?: number;
    /** Kill deadline for the AST analysis spawn. */
    analyzeTimeoutMs?: number;
    /** Kill deadline for each preview/enumeration spawn. */
    previewTimeoutMs?: number;
    /** Sample-path cap in preview summaries. */
    previewSampleLimit?: number;
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
/** Default confirmation window for an unconfirmed preview. */
export declare const DEFAULT_CONFIRM_TTL_MS = 120000;
export declare const Config: z<Config>;
/**
 * Register the pre-execute listener, the audit append, and the prompt section.
 * @param ctx - the host context the row mounts under.
 * @param config - the validated plugin config.
 */
export declare function apply(ctx: Context, config: Config): void;
export { GuardEngine } from './engine.ts';
export type { EngineDecision, EngineOptions, JudgeInput } from './engine.ts';
export { PendingConfirmations, fingerprintCommand } from './fingerprint.ts';
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