/**
 * The guard engine: one judge pass per shell tool call. The guard is active
 * ONLY in `careful-full-access` — every other sandbox mode passes through
 * untouched (workspace-write is already confined by the sandbox itself, and
 * danger-full-access is the user's explicit opt-out). Inside careful mode the
 * engine runs the cheap lexical scan first (the fast allow gate for the
 * overwhelming majority of commands), spawns the AST analyzer only for
 * destructive signals, maps the tier verdict onto the review route, and
 * resolves every flagged command through the WhatIf preview (deletions) and
 * the model-check three-question review — with human confirmation as the last
 * layer for disaster-tier or model-declared-dangerous commands.
 *
 * @module @deepseek-ai/dsh-careful-full-access/engine
 */
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { PwshAnalyzer } from './analyzer.ts';
import type { ModelCheckOutcome, ModelCheckRoute, ModelCheckRunner } from './model-check.ts';
import { PreviewRunner } from './preview.ts';
import type { ProtectedRoots } from './protected.ts';
import type { GuardTier } from './types.ts';
/** The engine's settled decision for one call. */
export type EngineDecision = {
    kind: 'allow';
    tier?: GuardTier;
    modelCheck?: ModelCheckOutcome['kind'];
} | {
    kind: 'deny';
    tier?: GuardTier;
    reason: string;
    modelCheck?: ModelCheckOutcome['kind'];
} | {
    kind: 'ask';
    tier?: GuardTier;
    reason: string;
    severity?: 'danger';
    modelCheck?: ModelCheckOutcome['kind'];
};
/** Engine construction facts resolved once per plugin apply. */
export interface EngineOptions {
    analyzer: PwshAnalyzer;
    preview: PreviewRunner;
    protectedRoots: ProtectedRoots;
    modelCheck: ModelCheckRunner;
}
/** One judgment request: the shell call facts the engine needs. */
export interface JudgeInput {
    dialect: 'pwsh' | 'bash';
    command: string;
    /** The per-call resolved sandbox mode; undefined when no policy is mounted. */
    mode: SandboxMode | undefined;
    /** The per-call workspace root; undefined when no policy is mounted. */
    workspaceRoot: string | undefined;
    /** The tool-call abort signal, observed around every spawn. */
    signal?: AbortSignal;
    /** Scopes the session audit gate to one session. */
    sessionKey: string;
    /** The session's model route for the model-check call. */
    route: ModelCheckRoute | undefined;
}
/**
 * The stateless-per-call orchestrator. All instance state lives in the
 * injected runners (model-check, preview, analyzer), so one engine instance
 * serves every session.
 */
export declare class GuardEngine {
    private readonly options;
    constructor(options: EngineOptions);
    /**
     * Judge one shell call.
     * @param input - the call facts.
     * @returns the careful-mode decision; every other mode allows outright.
     */
    judge(input: JudgeInput): Promise<EngineDecision>;
    private judgePwsh;
    private judgeBash;
    /** Every flagged command runs the review route; only `normal` allows straight through. */
    private route;
    /** The review route: optional WhatIf scope, then the model-check three questions. */
    private review;
    /** Assemble the human-confirmation request body: tier heading, finding, conclusion, preview note. */
    private confirmReason;
}
//# sourceMappingURL=engine.d.ts.map