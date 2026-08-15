/**
 * The careful-full-access preview pipeline: a read-only dry run that resolves
 * the command's REAL deletion scope before anything executes. The dry run sets
 * `$WhatIfPreference = $true` — the engine-level switch every ShouldProcess
 * cmdlet honors — so wildcards, variables, and `$env:` expansions are resolved
 * by PowerShell itself, not by the guard's parsing. `What if:` lines give the
 * concrete target list; recursive directory targets get one extra read-only
 * subtree enumeration (the dry run alone prints only the top directory), and
 * any resolved target that IS a protected root refuses outright.
 *
 * The command runs once with WhatIf on, so non-delete side effects before a
 * delete cmdlet DO execute during the preview — a documented tradeoff of
 * asking the shell itself for the truth.
 *
 * @module @deepseek-ai/dsh-command-guard/preview
 */
import type { PreviewOutcome, Spawner } from './types.ts';
import { type ProtectedRoots } from './protected.ts';
/** One parsed dry-run target. */
interface DryRunTarget {
    op: string;
    target: string;
}
/** One enumerated directory subtree. */
interface EnumeratedSubtree {
    path: string;
    files: number;
    dirs: number;
    samples: string[];
    truncated: boolean;
    missing?: boolean;
}
/** The preview configuration. */
export interface PreviewOptions {
    /** Kill deadline for each helper spawn. */
    timeoutMs: number;
    /** Sample-path cap in the final summary. */
    sampleLimit: number;
    /** The helper executable, already resolved from config defaults. */
    pwshPath: string;
}
/** Parse every `What if:` line (English or zh-CN form) from the dry-run output. */
export declare function parseWhatIfLines(stdout: string): DryRunTarget[];
/** Parse and validate the enumeration script's JSON output. */
export declare function parseEnumeration(stdout: string): EnumeratedSubtree[] | undefined;
/** Render the bounded model-facing preview summary. */
export declare function renderPreviewSummary(fileCount: number, directoryCount: number, samples: readonly string[], truncated: boolean): string;
/**
 * Run the two-stage preview: WhatIf dry run, then subtree enumeration for the
 * resolved directory targets. Protected-root hits refuse before enumeration.
 */
export declare class PreviewRunner {
    private readonly spawner;
    private readonly options;
    private readonly protectedRoots;
    constructor(spawner: Spawner, options: PreviewOptions, protectedRoots: ProtectedRoots);
    /**
     * Dry-run one command and resolve its real deletion scope.
     * @param command - the model-supplied command text.
     * @param signal - the tool-call abort signal.
     * @returns the preview outcome; every failure shape is fail-closed.
     */
    preview(command: string, signal?: AbortSignal): Promise<PreviewOutcome>;
}
/** A summary line for tests and the engine's deny reason. */
export declare function previewDenyReason(outcome: Extract<PreviewOutcome, {
    kind: 'previewed';
}>): string;
export {};
//# sourceMappingURL=preview.d.ts.map