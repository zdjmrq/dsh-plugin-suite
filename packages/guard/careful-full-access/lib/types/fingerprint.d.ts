/**
 * The audit dedupe memory: command fingerprints with their repeat counts.
 * Identical commands within the TTL window merge into one counted entry
 * instead of appending duplicate audit records, and entries expire so a
 * long-lived session never keeps fingerprints forever.
 *
 * @module @deepseek-ai/dsh-careful-full-access/fingerprint
 */
/**
 * Normalize a command into its fingerprint: trimmed, with every whitespace
 * run collapsed, so cosmetic re-formatting still matches while any real
 * change produces a different fingerprint.
 * @param command - the raw command text.
 * @returns the normalized fingerprint string.
 */
export declare function fingerprintCommand(command: string): string;
/** One fingerprint's dedupe state. */
export interface FingerprintNote {
    /** How many times this fingerprint was seen inside the current window. */
    count: number;
    /** The note repeats an earlier one (same fingerprint, window still open). */
    repeat: boolean;
}
/**
 * Sliding-window dedupe memory: fingerprint → last-seen timestamp. Entries are
 * pruned lazily on every read and write; a note inside the TTL window extends
 * the count, and a note after expiry starts a fresh window.
 */
export declare class DedupeWindow {
    private readonly ttlMs;
    private readonly entries;
    /** @param ttlMs - how long an identical command merges into one entry. */
    constructor(ttlMs: number);
    /**
     * Note one fingerprint.
     * @param fingerprint - the normalized command fingerprint.
     * @returns whether this note repeats an earlier one, and the merged count.
     */
    note(fingerprint: string): FingerprintNote;
    /** Drop every expired entry. */
    private prune;
}
//# sourceMappingURL=fingerprint.d.ts.map