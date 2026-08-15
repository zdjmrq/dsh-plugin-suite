/**
 * The durable audit trail: every non-allow guard decision is written as one
 * JSON line to `$DSH_HOME/logs/command-guard.log` (or the configured path),
 * with size-capped rotation (default 5 MB, three rotated copies), while the
 * session log only keeps a bounded window (default 20 decisions per session)
 * with identical commands merged into one counted entry inside the dedupe TTL.
 *
 * The file log is append-only, so a merged repeat appends one compact
 * `{event:"repeat", count, fingerprint}` line instead of duplicating the full
 * decision record; the session gate skips repeat appends entirely.
 *
 * @module @deepseek-ai/dsh-careful-full-access/audit
 */
import { DedupeWindow, type FingerprintNote } from './fingerprint.ts';
/** One audited decision, shared by the file line and the session event. */
export interface AuditDecision {
    toolName: string;
    decision: 'allow' | 'deny' | 'ask';
    tier?: string;
    reason?: string;
    mode?: string;
    callId?: string;
    modelCheck?: 'not-intended' | 'safe' | 'dangerous' | 'unavailable';
}
/** One file-log line: the decision plus its durable envelope. */
export interface AuditLine extends AuditDecision {
    /** ISO timestamp of the append. */
    ts: string;
    /** The session the decision belongs to, when routed through one. */
    sessionId?: string;
    /** The normalized command fingerprint (dedupe identity). */
    fingerprint?: string;
    /** Merged occurrence count inside the dedupe window (≥ 1). */
    count?: number;
}
/** A compact merged-repeat marker line for an append-only log. */
interface RepeatLine {
    event: 'repeat';
    fingerprint: string;
    count: number;
}
/**
 * Size-capped, rotated JSONL audit file. Appends are serialized through one
 * promise chain so concurrent decisions never interleave; every failure is
 * contained into the supplied `onError` so an audit problem can never flip a
 * guard decision.
 */
export declare class AuditLogger {
    private readonly options;
    private chain;
    constructor(options: {
        /** Absolute path of the live log file. */
        path: string;
        /** Rotate once the live file reaches this many bytes. */
        maxBytes: number;
        /** How many rotated copies (`.1` … `.N`) are kept beside the live file. */
        rotations: number;
        /** Receives every contained append/rotation failure. */
        onError: (error: unknown) => void;
    });
    /**
     * Append one line (serialized with every other write).
     * @param line - the decision or repeat-marker line.
     */
    write(line: AuditLine | RepeatLine): void;
    /** Settle once every queued write has finished (test and shutdown hook). */
    flush(): Promise<void>;
    private append;
    /** Shift `.i-1` → `.i` down to `.1`, then move the live file to `.1`. */
    private rotate;
}
/** Options for the session-event gate. */
export interface SessionAuditGateOptions {
    /** How many decision events one session keeps (older ones stop appending). */
    maxEvents: number;
    /** The dedupe window shared with the file log's repeat counting. */
    dedupe: DedupeWindow;
}
/**
 * The session-log side of the audit: caps decision events per session and
 * merges identical commands inside the dedupe TTL. The file log keeps the
 * complete trail; the session log keeps only what the model context and
 * projections need.
 */
export declare class SessionAuditGate {
    private readonly options;
    private readonly counts;
    constructor(options: SessionAuditGateOptions);
    /**
     * Whether the next decision event should append to the session log.
     * @param sessionKey - the per-session scope key for cap and dedupe.
     * @param fingerprint - the normalized command fingerprint.
     * @returns the append decision and the merged fingerprint note.
     */
    shouldAppend(sessionKey: string, fingerprint: string): {
        append: boolean;
        note: FingerprintNote;
    };
}
export {};
//# sourceMappingURL=audit.d.ts.map