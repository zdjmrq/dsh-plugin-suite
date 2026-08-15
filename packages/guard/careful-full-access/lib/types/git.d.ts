/**
 * The git subcommand analyzer: top-level-verb dispatch for `git` invocations.
 * When the first verb of a command is `git`, the generic destructive-verb scan
 * must not see inside it — `git rm --cached` only rewrites the index and must
 * classify as normal, while `git clean -fd` and `git reset --hard` destroy
 * working-tree files and must classify as elevated.
 *
 * Pure — no processes, no state. The same rules run for both PowerShell and
 * bash dialects.
 *
 * @module @deepseek-ai/dsh-careful-full-access/git
 */
/** The analysis of one `git …` invocation; `undefined` when the command is not one. */
export interface GitFacts {
    /** The git subcommand (e.g. `rm`, `clean`, `reset`); undefined when unreadable. */
    subcommand?: string;
    /**
     * Whether the invocation destroys working-tree or index content:
     * `git rm` without `--cached`/`-n`, `git clean`, `git reset --hard`.
     */
    destructive: boolean;
    /** Model-facing explanation of why the invocation was flagged. */
    reason?: string;
}
/**
 * Whether the first verb of the token list is a git invocation.
 * @param verbs - the leading verb tokens in order (case-insensitive).
 * @returns whether the list heads with `git`/`git.exe`.
 */
export declare function isGitInvocation(verbs: readonly string[]): boolean;
/**
 * Analyze one git invocation's subcommand semantics.
 * @param tokens - the raw command tokens AFTER the leading `git` verb.
 * @returns the git facts; never throws.
 */
export declare function analyzeGit(tokens: readonly string[]): GitFacts;
//# sourceMappingURL=git.d.ts.map