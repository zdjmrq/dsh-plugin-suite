/**
 * The model-check two-step protocol's memory: command fingerprints that were
 * previewed but not yet confirmed. A matching resubmission consumes the entry
 * (one-shot) and executes; a changed command gets a new fingerprint and a new
 * preview. Unconsumed entries expire after the configured TTL so a preview
 * never stays confirmable forever.
 *
 * @module @deepseek-ai/dsh-command-guard/fingerprint
 */
/**
 * Normalize a command into its confirmation fingerprint: trimmed, with every
 * whitespace run collapsed, so cosmetic re-formatting still confirms while any
 * real change re-previews.
 * @param command - the raw command text.
 * @returns the normalized fingerprint string.
 */
export declare function fingerprintCommand(command: string): string;
/**
 * Scoped pending-confirmation memory: fingerprint → expiry. Entries are pruned
 * lazily on every read and write, and consumed exactly once.
 */
export declare class PendingConfirmations {
    private readonly ttlMs;
    private readonly entries;
    /** @param ttlMs - how long an unconfirmed preview stays confirmable. */
    constructor(ttlMs: number);
    /**
     * Whether a fingerprint was previewed and its confirmation window is open.
     * @param fingerprint - the normalized command fingerprint.
     */
    has(fingerprint: string): boolean;
    /**
     * Record one previewed fingerprint.
     * @param fingerprint - the normalized command fingerprint.
     */
    add(fingerprint: string): void;
    /**
     * Consume one confirmation: returns true exactly once per recorded entry.
     * @param fingerprint - the normalized command fingerprint.
     */
    consume(fingerprint: string): boolean;
    /** Drop every expired entry. */
    private prune;
}
//# sourceMappingURL=fingerprint.d.ts.map