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
import { type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
/** The narrow completion seam the runner needs; the real `llm` service fits it. */
export interface ModelCompleter {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
/** The session's resolved model route for the check. */
export interface ModelCheckRoute {
    provider: string;
    model: string;
}
/** One review request: the flagged command plus everything the model needs. */
export interface ModelCheckInput {
    /** The full command text. */
    command: string;
    /** The static tier (unparseable is presented as treated-like-disaster). */
    tier: 'elevated' | 'disaster' | 'unparseable';
    /** Why the classifier flagged the command. */
    reason: string;
    /** Optional resolved scope summary from the WhatIf preview. */
    scopeSummary?: string;
    /** The session's provider/model route; an undefined route fails closed. */
    route: ModelCheckRoute | undefined;
    /** The tool-call abort signal, also honored around the check call. */
    signal?: AbortSignal;
}
/** The settled review answer. */
export type ModelCheckOutcome = {
    kind: 'not-intended';
    explanation: string;
} | {
    kind: 'safe';
} | {
    kind: 'dangerous';
    explanation: string;
} | {
    kind: 'unavailable';
    detail: string;
};
/** The strict answer schema the prompt demands. */
interface ModelAnswer {
    intent: 'yes' | 'no';
    assessment: 'safe' | 'dangerous';
    explanation: string;
}
/**
 * Extract and validate the strict JSON answer from the model's reply.
 * @param text - the raw reply text from the review call.
 * @returns the validated answer, or `undefined` when nothing parses.
 */
export declare function parseModelAnswer(text: string): ModelAnswer | undefined;
/** Runner options. */
export interface ModelCheckOptions {
    /** The completion seam; an undefined completer fails every check closed. */
    completer: ModelCompleter | undefined;
    /** Kill deadline for the whole check call. */
    timeoutMs: number;
    /** Output budget for the check call. */
    maxTokens: number;
}
/**
 * Run one review.
 * @param input - the flagged command and its route.
 * @returns the settled outcome; failures settle `unavailable`.
 */
export declare class ModelCheckRunner {
    private readonly options;
    constructor(options: ModelCheckOptions);
    /**
     * Run one review.
     * @param input - the flagged command and its route.
     * @returns the settled outcome; failures settle `unavailable`.
     */
    check(input: ModelCheckInput): Promise<ModelCheckOutcome>;
}
export {};
//# sourceMappingURL=model-check.d.ts.map