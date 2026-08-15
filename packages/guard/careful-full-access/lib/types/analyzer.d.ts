/**
 * The process-backed analyzer: a PowerShell AST pass over one command string,
 * run as a helper `pwsh` invocation through an injectable {@link Spawner}. The
 * analyzer script travels as a UTF-16LE `-EncodedCommand`, so the command text
 * itself never crosses a command line — it rides the environment — and no
 * quoting layer can corrupt it. The script parses WITHOUT executing: it walks
 * every `CommandAst` and reports verbs, literal/expandable strings, variables,
 * parameters, and `.NET` deletion member calls as one compact JSON line.
 *
 * @module @deepseek-ai/dsh-careful-full-access/analyzer
 */
import type { PwshReport, Spawner, SpawnOptions, SpawnResult } from './types.ts';
/**
 * Encode a script for `pwsh -EncodedCommand`.
 * @param script - the script text to encode.
 * @returns the UTF-16LE base64 payload.
 */
export declare function encodeCommand(script: string): string;
/**
 * The default spawner: ordinary `node:child_process` spawn with a kill
 * deadline and bounded stream collection. The host process is never confined
 * when the guard runs, so pipe capture is safe here.
 * @param argv - program plus arguments.
 * @param options - environment overlay, timeout, and per-stream cap.
 * @returns the settled output; never throws.
 */
export declare function nodeSpawner(argv: string[], options: SpawnOptions): Promise<SpawnResult>;
/**
 * Parse and validate the analyzer script's single JSON output line. Rogue or
 * truncated output fails closed into a non-ok report.
 * @param stdout - the helper's captured stdout.
 * @returns the validated report.
 */
export declare function parsePwshReport(stdout: string): PwshReport;
/** The analyzer configuration the engine resolves per call. */
export interface AnalyzerOptions {
    /** Kill deadline for the analysis spawn. */
    timeoutMs: number;
    /** The helper executable, already resolved from config defaults. */
    pwshPath: string;
}
/**
 * The PowerShell AST analyzer. One instance per guard engine; every analysis
 * is a fresh helper process, so no state accumulates.
 */
export declare class PwshAnalyzer {
    private readonly spawner;
    private readonly options;
    constructor(spawner: Spawner, options: AnalyzerOptions);
    /**
     * Run the read-only AST pass over one command.
     * @param command - the model-supplied PowerShell command text.
     * @param signal - the tool-call abort signal; an aborted caller yields an aborted report.
     * @returns the validated report; spawn failures and timeouts fail closed.
     */
    analyze(command: string, signal?: AbortSignal): Promise<PwshReport>;
    /**
     * The `.NET` deletion member calls the caller-visible regex already found, for cross-checks.
     * @param command - the raw command text.
     * @returns whether the `.NET` delete-call pattern matches.
     */
    static hasNetDelete(command: string): boolean;
}
//# sourceMappingURL=analyzer.d.ts.map