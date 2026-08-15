/**
 * The guard engine: one judge pass per shell tool call. It runs the cheap
 * lexical scan first (the fast allow/deny gate for the overwhelming majority
 * of commands), spawns the AST analyzer only for destructive signals, maps the
 * tier verdict onto the per-mode decision, and in `careful-full-access` routes
 * every non-disaster deletion through the preview pipeline and the model-check
 * two-step confirmation.
 *
 * @module @deepseek-ai/dsh-command-guard/engine
 */
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { PwshAnalyzer } from './analyzer.ts';
import type { ProtectedRoots } from './protected.ts';
import { PreviewRunner } from './preview.ts';
/** The engine's settled decision for one call. */
export type EngineDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    reason: string;
} | {
    kind: 'ask';
    reason: string;
};
/** Engine construction facts resolved once per plugin apply. */
export interface EngineOptions {
    analyzer: PwshAnalyzer;
    preview: PreviewRunner;
    protectedRoots: ProtectedRoots;
    /** How long an unconfirmed preview stays confirmable. */
    confirmTtlMs: number;
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
    /** Scopes the pending-confirmation memory to one session. */
    sessionKey: string;
}
/**
 * The stateless-per-call orchestrator. Instance state is only the pending
 * confirmation memory, keyed per session by the caller.
 */
export declare class GuardEngine {
    private readonly options;
    private readonly pending;
    constructor(options: EngineOptions);
    /**
     * Judge one shell call.
     * @param input - the call facts.
     * @returns the mode-aware decision.
     */
    judge(input: JudgeInput): Promise<EngineDecision>;
    private judgePwsh;
    private judgeBash;
    private route;
    /** The careful-full-access route: preview + model-check two-step confirmation. */
    private carefulRoute;
    /** Session-scoped pending key: the same command in another session previews again. */
    private pendingKey;
}
//# sourceMappingURL=engine.d.ts.map