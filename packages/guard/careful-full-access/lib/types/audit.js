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
import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
function renderLine(line) {
    return JSON.stringify(line);
}
/**
 * Size-capped, rotated JSONL audit file. Appends are serialized through one
 * promise chain so concurrent decisions never interleave; every failure is
 * contained into the supplied `onError` so an audit problem can never flip a
 * guard decision.
 */
export class AuditLogger {
    options;
    chain = Promise.resolve();
    constructor(options) {
        this.options = options;
    }
    /**
     * Append one line (serialized with every other write).
     * @param line - the decision or repeat-marker line.
     */
    write(line) {
        this.chain = this.chain
            .then(() => this.append(renderLine(line)))
            .catch((error) => { this.options.onError(error); });
    }
    /** Settle once every queued write has finished (test and shutdown hook). */
    flush() {
        return this.chain;
    }
    async append(rendered) {
        try {
            await mkdir(dirname(this.options.path), { recursive: true });
        }
        catch (error) {
            /* v8 ignore next -- mkdir fails only on hostile paths; contained by the caller's onError chain */
            if (error.code !== 'EEXIST')
                throw error;
        }
        const size = await stat(this.options.path)
            .then(info => info.size)
            .catch(() => 0);
        if (size >= this.options.maxBytes)
            await this.rotate();
        await appendFile(this.options.path, rendered + '\n', 'utf8');
    }
    /** Shift `.i-1` → `.i` down to `.1`, then move the live file to `.1`. */
    async rotate() {
        for (let index = this.options.rotations; index >= 2; index -= 1) {
            try {
                await rename(`${this.options.path}.${index - 1}`, `${this.options.path}.${index}`);
            }
            catch (error) {
                /* v8 ignore next -- ENOENT means no such older copy yet; any other error must surface */
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        try {
            await rename(this.options.path, `${this.options.path}.1`);
        }
        catch (error) {
            /* v8 ignore next -- the live file exists once it crossed maxBytes; only hostile paths fail here */
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
}
/**
 * The session-log side of the audit: caps decision events per session and
 * merges identical commands inside the dedupe TTL. The file log keeps the
 * complete trail; the session log keeps only what the model context and
 * projections need.
 */
export class SessionAuditGate {
    options;
    counts = new Map();
    constructor(options) {
        this.options = options;
    }
    /**
     * Whether the next decision event should append to the session log.
     * @param sessionKey - the per-session scope key for cap and dedupe.
     * @param fingerprint - the normalized command fingerprint.
     * @returns the append decision and the merged fingerprint note.
     */
    shouldAppend(sessionKey, fingerprint) {
        const note = this.options.dedupe.note(sessionKey + '\n' + fingerprint);
        if (note.repeat)
            return { append: false, note };
        const count = (this.counts.get(sessionKey) ?? 0) + 1;
        this.counts.set(sessionKey, count);
        return { append: count <= this.options.maxEvents, note };
    }
}
//# sourceMappingURL=audit.js.map