/**
 * The destructive-command vocabulary the guard classifies: PowerShell and
 * cmd-style verbs with their alias maps, the format/disk family, the recycle
 * verb, and the POSIX (bash-dialect) set. Pure data plus canonicalization
 * helpers — the analyzer and tier classifier both consume it.
 *
 * @module @deepseek-ai/dsh-command-guard/verbs
 */
/** The risk families the guard tiers route on. */
export type VerbFamily = 'delete' | 'format' | 'recycle';
/** cmd-style switches that mark a recursive delete (`rd /s`, `del /s`). */
export declare const CMD_RECURSIVE_SWITCHES: ReadonlySet<string>;
/** cmd-style switches that mark a forced delete (`rd /q`, `del /q`, `del /f`). */
export declare const CMD_FORCE_SWITCHES: ReadonlySet<string>;
/** The robocopy mirror switch — mirroring INTO a protected root destroys its content. */
export declare const CMD_MIRROR_SWITCHES: ReadonlySet<string>;
/**
 * The `.NET` deletion-primitive call pattern: `[IO.Directory]::Delete(path, $true)`
 * and friends. Member expressions are not `CommandAst`s, so both the lexer and
 * the AST analyzer match this signature textually.
 */
export declare const NET_DELETE_CALL: RegExp;
/** The PowerShell dynamic-execution verbs the static analyzer cannot see through. */
export declare const PWSH_DYNAMIC_VERBS: ReadonlySet<string>;
/** The cmd `diskpart` verb plus the `clean` subcommand word that makes it destructive. */
export declare const DISKPART_VERB = "diskpart";
export declare const DISKPART_CLEAN_WORD = "clean";
/** The robocopy verb whose `/MIR` against a protected root is disaster-tier. */
export declare const ROBOCOPY_VERB = "robocopy";
/** Bash `find` plus the `-delete` action word. */
export declare const FIND_VERB = "find";
export declare const FIND_DELETE_WORD = "-delete";
/**
 * Canonicalize a PowerShell verb into its risk family.
 * @param verb - the raw command verb (aliases stay as written in the AST).
 * @returns the family, or `undefined` for a non-destructive verb.
 */
export declare function pwshVerbFamily(verb: string): VerbFamily | undefined;
/**
 * Whether a PowerShell verb is a dynamic-execution verb (`iex`).
 * @param verb - the raw command verb.
 */
export declare function isPwshDynamicVerb(verb: string): boolean;
/**
 * Canonicalize a bash verb into its risk family.
 * @param verb - the raw command verb.
 * @returns the family, or `undefined` for a non-destructive verb.
 */
export declare function bashVerbFamily(verb: string): VerbFamily | undefined;
//# sourceMappingURL=verbs.d.ts.map