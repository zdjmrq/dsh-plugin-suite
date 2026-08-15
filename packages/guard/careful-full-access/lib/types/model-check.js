/**
 * The model-check step: a small one-shot call to the SESSION's routed model
 * that reviews a flagged command before it runs. The model sees the command
 * text, its static tier, why it was flagged, and (for deletions) the resolved
 * WhatIf scope, and must answer three questions as one strict JSON object.
 *
 * The answer decides the next step: `intent: "no"` denies outright (the model
 * disowns the command — the guard's core purpose), `intent: "yes"` plus
 * `assessment: "safe"` lets the caller route elevated commands to allow and
 * disaster commands to human confirmation, and `assessment: "dangerous"`
 * always escalates to human confirmation. An unavailable route, a timeout, an
 * aborted or failed stream, or an unparseable answer all fail closed as
 * `unavailable` — the caller then treats the command as disaster-tier.
 *
 * @module @deepseek-ai/dsh-careful-full-access/model-check
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
const SYSTEM_PROMPT = 'You are the command-review step of a deletion guard inside a coding-agent harness. '
    + 'A flagged shell command is shown with its risk tier and the reason it was flagged. '
    + 'Answer whether the command is what its author intended and whether it is safe, '
    + 'STRICTLY as one JSON object with exactly these fields: '
    + '{"intent":"yes"|"no","assessment":"safe"|"dangerous","explanation":"one short sentence"}. '
    + '"intent":"no" means the command is NOT what was meant (likely misparsed or miswritten). '
    + '"assessment":"dangerous" means the command is genuinely risky or exceeds its expected scope. '
    + 'Output the JSON object only — no prose, no code fences.';
/** Human label for each tier as presented to the reviewing model. */
function tierLabel(tier) {
    switch (tier) {
        case 'elevated': return 'elevated (dangerous verb)';
        case 'disaster': return 'DISASTER (protected root or disk-level operation)';
        case 'unparseable': return 'unparseable (cannot be statically analyzed; treated as disaster)';
    }
}
/** Build the one-shot user message the reviewing model answers. */
function buildUserText(input) {
    const lines = [
        'Review this shell command before it executes.',
        '',
        'Command:',
        '```',
        input.command,
        '```',
        '',
        `Static tier: ${tierLabel(input.tier)}`,
        `Flagged because: ${input.reason}`,
    ];
    if (input.scopeSummary !== undefined && input.scopeSummary.length > 0) {
        lines.push('', 'Resolved scope (WhatIf dry run):', input.scopeSummary);
    }
    lines.push('', 'Answer these three questions:', '1. Intent: is this command what you originally meant to run?', '2. If yes: is it safe and within the expected scope?', '3. If yes but genuinely dangerous or out of scope: say so explicitly.');
    return lines.join('\n');
}
/**
 * Extract and validate the strict JSON answer from the model's reply.
 * @param text - the raw reply text from the review call.
 * @returns the validated answer, or `undefined` when nothing parses.
 */
export function parseModelAnswer(text) {
    const trimmed = text.trim();
    const candidates = [trimmed];
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1] !== undefined)
        candidates.push(fenced[1]);
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace !== null)
        candidates.push(brace[0]);
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if ((parsed.intent === 'yes' || parsed.intent === 'no')
                && (parsed.assessment === 'safe' || parsed.assessment === 'dangerous')
                && typeof parsed.explanation === 'string' && parsed.explanation.length > 0) {
                return { intent: parsed.intent, assessment: parsed.assessment, explanation: parsed.explanation };
            }
        }
        catch {
            // Not this candidate — try the next extraction.
        }
    }
    return undefined;
}
/**
 * Run one review.
 * @param input - the flagged command and its route.
 * @returns the settled outcome; failures settle `unavailable`.
 */
export class ModelCheckRunner {
    options;
    constructor(options) {
        this.options = options;
    }
    /**
     * Run one review.
     * @param input - the flagged command and its route.
     * @returns the settled outcome; failures settle `unavailable`.
     */
    async check(input) {
        if (this.options.completer === undefined || input.route === undefined) {
            return { kind: 'unavailable', detail: 'no model route available for the model-check call' };
        }
        const controller = new AbortController();
        const timedOut = () => controller.signal.aborted && input.signal?.aborted !== true;
        const onOuterAbort = () => { controller.abort(); };
        input.signal?.addEventListener('abort', onOuterAbort, { once: true });
        const timer = setTimeout(() => { controller.abort(); }, this.options.timeoutMs);
        try {
            const messages = [createUserMessage({
                    content: [{ type: 'text', text: buildUserText(input) }],
                    source: { kind: 'plugin', plugin: 'command-guard' },
                })];
            const stream = this.options.completer.stream({
                provider: input.route.provider,
                model: input.route.model,
                messages,
                system: SYSTEM_PROMPT,
                temperature: 0,
                maxTokens: this.options.maxTokens,
                signal: controller.signal,
            });
            let text = '';
            for await (const chunk of stream) {
                if (chunk.type === 'text-delta')
                    text += chunk.text;
                else if (chunk.type === 'finish') {
                    if (chunk.reason.kind === 'stop')
                        continue;
                    if (chunk.reason.kind === 'aborted') {
                        return timedOut()
                            ? { kind: 'unavailable', detail: 'the model-check call timed out' }
                            : { kind: 'unavailable', detail: 'the model-check call was aborted' };
                    }
                    if (chunk.reason.kind === 'error') {
                        return { kind: 'unavailable', detail: `the model-check call failed: ${chunk.reason.failure.message}` };
                    }
                    return { kind: 'unavailable', detail: `the model-check call ended abnormally (${chunk.reason.kind})` };
                }
            }
            if (controller.signal.aborted) {
                return timedOut()
                    ? { kind: 'unavailable', detail: 'the model-check call timed out' }
                    : { kind: 'unavailable', detail: 'the model-check call was aborted' };
            }
            const answer = parseModelAnswer(text);
            if (answer === undefined) {
                return { kind: 'unavailable', detail: 'the model-check answer could not be parsed' };
            }
            if (answer.intent === 'no')
                return { kind: 'not-intended', explanation: answer.explanation };
            if (answer.assessment === 'dangerous')
                return { kind: 'dangerous', explanation: answer.explanation };
            return { kind: 'safe' };
        }
        catch (error) {
            // A signal-honoring stream rejects with an abort error; classify it by
            // which side cancelled so timeouts and outer aborts stay distinct.
            if (controller.signal.aborted) {
                return timedOut()
                    ? { kind: 'unavailable', detail: 'the model-check call timed out' }
                    : { kind: 'unavailable', detail: 'the model-check call was aborted' };
            }
            return { kind: 'unavailable', detail: `the model-check call threw: ${error instanceof Error ? error.message : String(error)}` };
        }
        finally {
            clearTimeout(timer);
            input.signal?.removeEventListener('abort', onOuterAbort);
        }
    }
}
//# sourceMappingURL=model-check.js.map