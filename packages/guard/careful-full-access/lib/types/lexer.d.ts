/**
 * The in-process lexical pre-scan: a conservative, dependency-free first pass
 * over a PowerShell or bash command string. It never spawns anything, runs for
 * every pwsh/bash call, and answers two questions: does this command carry any
 * destructive signal at all (fast allow when not), and which crude facts are
 * visible without an AST (used by the fast disaster path and as fallback when
 * the AST analyzer is unavailable).
 *
 * False positives are acceptable here — the AST pass refines; false negatives
 * are not, so the tokenizer errs toward flagging.
 *
 * @module @deepseek-ai/dsh-careful-full-access/lexer
 */
import { type GitFacts } from './git.ts';
import { type VerbFamily } from './verbs.ts';
/** The crude facts one lexical pass extracts from a command string. */
export interface LexFacts {
    /** Canonical risk families of the verbs found (aliases resolved). */
    families: VerbFamily[];
    /** Raw verbs found, lowercase, in order. */
    verbs: string[];
    /** Literal path-like tokens (quoted strings and drive-letter tokens). */
    literalPaths: string[];
    /** A `.NET` `[IO.Directory]::Delete` style call is present. */
    netDeleteCall: boolean;
    /** `diskpart` appears together with the `clean` word. */
    diskpartClean: boolean;
    /** `robocopy` appears with a mirror switch. */
    robocopyMir: boolean;
    /** A recursive marker is present (`-Recurse`, cmd `/s`, bash `-r`/`-R`). */
    recursive: boolean;
    /** A force marker is present (`-Force`, cmd `/q`/`/f`, bash `-f`). */
    force: boolean;
    /** A glob wildcard (`*` or `?`) appears in a path-like token. */
    wildcard: boolean;
    /** Dynamic markers: `$` variables, `iex`, parenthesized sub-expressions, backticks. */
    dynamic: boolean;
    /** A dynamic-execution verb (`iex`/`Invoke-Expression`) heads a command. */
    dynamicVerb: boolean;
    /** Bash `find` appears with `-delete`. */
    findDelete: boolean;
    /** Top-level `git` dispatch facts; set only when `git` heads the command. */
    git?: GitFacts;
}
/** A Windows drive-letter path form: `C:`, `C:\`, `C:\foo` (with or without quotes already removed). */
declare const DRIVE_FORM: RegExp;
/** An extended-length root: `\\?\C:\` and `\\?\C:\path`. */
declare const EXTENDED_ROOT_FORM: RegExp;
/** A UNC root: `\\server\share\` (exactly two components). */
declare const UNC_ROOT_FORM: RegExp;
/**
 * Whether the raw command contains a `.NET` deletion-primitive call.
 * @param command - the full command text.
 * @returns whether the `.NET` delete-call pattern matches.
 */
export declare function hasNetDeleteCall(command: string): boolean;
/**
 * Lex one PowerShell-family command string into crude facts. Verbs are
 * canonicalized through {@link pwshVerbFamily}; switches and path tokens fill
 * the rest. The `verb` filter accepts every token that could be a command
 * position, so aliases and cmd-style binaries both surface.
 * @param command - the model-supplied command text.
 * @returns the crude facts; never throws.
 */
export declare function lexPwsh(command: string): LexFacts;
/**
 * Lex one bash command string into the same crude-facts vocabulary.
 * @param command - the model-supplied command text.
 * @returns the crude facts; never throws.
 */
export declare function lexBash(command: string): LexFacts;
/**
 * Whether the crude facts contain any destructive signal at all — the cheap
 * allow gate before any analyzer spawn. Dynamic-execution verbs count: their
 * payload is opaque, so they must never slip through the gate.
 * @param facts - the lex result.
 * @returns whether the command deserves further analysis.
 */
export declare function hasDestructiveSignal(facts: LexFacts): boolean;
export { EXTENDED_ROOT_FORM, UNC_ROOT_FORM, DRIVE_FORM };
//# sourceMappingURL=lexer.d.ts.map