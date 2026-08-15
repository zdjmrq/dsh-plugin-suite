/**
 * The tier classifier: maps an analyzer report (plus the lexical fallback
 * facts) onto the four guard tiers. Pure — no processes, no sessions — so the
 * same rules run identically for the fast lex-only path and the full AST path.
 *
 * The tiers are mode-independent by design: which tier becomes deny, ask, or
 * the careful-preview pipeline is the engine's per-mode decision, not the
 * classifier's.
 *
 * @module @deepseek-ai/dsh-command-guard/tiers
 */
import type { GuardTier, GuardVerdict, PwshReport } from './types.ts';
import type { LexFacts } from './lexer.ts';
import { type ProtectedRoots } from './protected.ts';
/** The classifier context: per-call policy facts plus the engine's protected registry. */
export interface TierContext {
    /** The session workspace root (absolute), when the policy service supplied one. */
    workspaceRoot?: string;
    /** The normalized protected-root registry. */
    protectedRoots: ProtectedRoots;
}
/**
 * Classify one PowerShell command.
 * @param rawCommand - the full command text (for `.NET` call argument checks).
 * @param report - the AST report, or `undefined` when the analysis failed.
 * @param facts - the lexical facts (always present).
 * @param context - per-call policy facts and protected roots.
 * @returns the tier verdict with its model-facing reason.
 */
export declare function classifyPwsh(rawCommand: string, report: PwshReport | undefined, facts: LexFacts, context: TierContext): GuardVerdict;
/**
 * Classify one bash command from its lexical facts (POSIX has no AST pass).
 * @param facts - the lexical facts.
 * @param context - per-call policy facts and protected roots.
 * @returns the tier verdict with its model-facing reason.
 */
export declare function classifyBash(facts: LexFacts, context: TierContext): GuardVerdict;
export type { GuardTier };
//# sourceMappingURL=tiers.d.ts.map