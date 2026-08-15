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
import { hasDestructiveSignal, lexBash, lexPwsh } from "./lexer.js";
import { renderPreviewSummary } from "./preview.js";
import { classifyBash, classifyPwsh } from "./tiers.js";
/**
 * The stateless-per-call orchestrator. All instance state lives in the
 * injected runners (model-check, preview, analyzer), so one engine instance
 * serves every session.
 */
export class GuardEngine {
    options;
    constructor(options) {
        this.options = options;
    }
    /**
     * Judge one shell call.
     * @param input - the call facts.
     * @returns the careful-mode decision; every other mode allows outright.
     */
    async judge(input) {
        if (input.mode !== 'careful-full-access')
            return { kind: 'allow' };
        const context = {
            ...input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot },
            protectedRoots: this.options.protectedRoots,
        };
        if (input.dialect === 'bash')
            return this.judgeBash(input, context);
        return this.judgePwsh(input, context);
    }
    async judgePwsh(input, context) {
        const facts = lexPwsh(input.command);
        if (!hasDestructiveSignal(facts))
            return { kind: 'allow' };
        // The lex-only pass already proves disaster and git subcommand semantics;
        // everything else is refined through the AST analyzer.
        const fast = classifyPwsh(input.command, undefined, facts, context);
        const verdict = fast.tier === 'disaster' || facts.git !== undefined
            ? fast
            : classifyPwsh(input.command, await this.options.analyzer.analyze(input.command, input.signal), facts, context);
        return this.route(input, verdict, 'pwsh', facts);
    }
    async judgeBash(input, context) {
        const facts = lexBash(input.command);
        if (!hasDestructiveSignal(facts))
            return { kind: 'allow' };
        const verdict = classifyBash(facts, context);
        return this.route(input, verdict, 'bash', facts);
    }
    /** Every flagged command runs the review route; only `normal` allows straight through. */
    async route(input, verdict, dialect, facts) {
        if (verdict.tier === 'normal')
            return { kind: 'allow' };
        return this.review(input, verdict, dialect, facts);
    }
    /** The review route: optional WhatIf scope, then the model-check three questions. */
    async review(input, verdict, dialect, facts) {
        // route() only reaches the review for non-normal verdicts; the cast is the
        // one place the classifier's closed union narrows to the review tiers.
        const reviewTier = verdict.tier;
        let effectiveTier = reviewTier;
        let scopeSummary;
        let previewDetail;
        if (dialect === 'pwsh' && facts.families.includes('delete')) {
            const outcome = await this.options.preview.preview(input.command, input.signal);
            switch (outcome.kind) {
                case 'zero-targets':
                    // The dry run proved the command deletes nothing — nothing to review.
                    return { kind: 'allow', tier: effectiveTier };
                case 'previewed':
                    scopeSummary = renderPreviewSummary(outcome.fileCount, outcome.directoryCount, outcome.samples, outcome.truncated);
                    break;
                case 'protected-hit':
                    // The resolved scope IS a protected root: upgrade to the disaster tier
                    // so the human confirmation carries the red disaster marking.
                    effectiveTier = 'disaster';
                    scopeSummary = `resolved to the protected root "${outcome.target}"`;
                    break;
                case 'unpreviewable':
                    previewDetail = outcome.detail;
                    break;
                /* v8 ignore next 3 -- PreviewOutcome is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
                default: {
                    const never = outcome;
                    throw new Error(`unreachable preview outcome: ${String(never)}`);
                }
            }
        }
        const outcome = await this.options.modelCheck.check({
            command: input.command,
            tier: reviewTier,
            reason: verdict.reason,
            ...scopeSummary === undefined ? {} : { scopeSummary },
            route: input.route,
            ...input.signal === undefined ? {} : { signal: input.signal },
        });
        switch (outcome.kind) {
            case 'not-intended':
                // The model disowns the command — this is the misparse case the guard
                // exists for. No human confirmation: the model said no itself.
                return {
                    kind: 'deny',
                    tier: verdict.tier,
                    modelCheck: 'not-intended',
                    reason: `command guard: model-check concluded this command was not the intended one: ${outcome.explanation}`,
                };
            case 'safe':
                if (effectiveTier === 'elevated')
                    return { kind: 'allow', tier: 'elevated', modelCheck: 'safe' };
                return {
                    kind: 'ask',
                    tier: effectiveTier,
                    severity: 'danger',
                    modelCheck: 'safe',
                    reason: this.confirmReason(effectiveTier, verdict, 'the model confirms this is the intended, expected operation', previewDetail),
                };
            case 'dangerous':
                return {
                    kind: 'ask',
                    tier: effectiveTier,
                    ...effectiveTier === 'disaster' || effectiveTier === 'unparseable' ? { severity: 'danger' } : {},
                    modelCheck: 'dangerous',
                    reason: this.confirmReason(effectiveTier, verdict, `the model itself declared it dangerous: ${outcome.explanation}`, previewDetail),
                };
            case 'unavailable':
                // Fail closed: a review that could not run is treated as disaster.
                return {
                    kind: 'ask',
                    tier: effectiveTier,
                    severity: 'danger',
                    modelCheck: 'unavailable',
                    reason: this.confirmReason(effectiveTier === 'elevated' ? 'unparseable' : effectiveTier, verdict, `model-check unavailable: ${outcome.detail}`, previewDetail),
                };
            /* v8 ignore next 3 -- ModelCheckOutcome is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
            default: {
                const never = outcome;
                throw new Error(`unreachable model-check outcome: ${String(never)}`);
            }
        }
    }
    /** Assemble the human-confirmation request body: tier heading, finding, conclusion, preview note. */
    confirmReason(tier, verdict, conclusion, previewDetail) {
        let heading;
        switch (tier) {
            case 'disaster':
                heading = 'DISASTER tier';
                break;
            case 'unparseable':
                heading = 'unparseable (treated as disaster)';
                break;
            case 'elevated':
                heading = 'elevated tier';
                break;
            /* v8 ignore next 3 -- the review tiers are a closed union; this branch is only the static exhaustiveness guard. */
            default: {
                const never = tier;
                throw new Error(`unreachable review tier: ${String(never)}`);
            }
        }
        const base = `command guard: ${heading} — ${verdict.reason} — ${conclusion}`;
        return previewDetail === undefined ? base : `${base}; the command could not be dry-run previewed (${previewDetail})`;
    }
}
//# sourceMappingURL=engine.js.map