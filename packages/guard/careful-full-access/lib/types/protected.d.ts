/**
 * Protected-path predicates: the registry of absolute roots whose recursive
 * deletion (or mirror-overwrite) is disaster-tier, plus the containment
 * helper the classifier uses to decide "inside the workspace". All
 * comparisons are case-insensitive on Windows path forms and byte-exact
 * otherwise, decided from the path text itself so the same code classifies
 * both PowerShell and bash targets on any host.
 *
 * @module @deepseek-ai/dsh-careful-full-access/protected
 */
/**
 * Strip trailing separators and a trailing glob star from a target path.
 * @param raw - the raw path token.
 * @returns the normalized path.
 */
export declare function normalizeTarget(raw: string): string;
/**
 * Whether a raw target string is a drive root (`C:\` or `C:`-with-separator forms).
 * @param raw - the raw path token.
 * @returns whether the form is a drive root.
 */
export declare function isDriveRootPath(raw: string): boolean;
/**
 * Whether a raw target string is a drive-root glob (`C:\*`, `C:\*.*`).
 * @param raw - the raw path token.
 * @returns whether the form is a drive-root glob.
 */
export declare function isDriveRootWildcard(raw: string): boolean;
/**
 * Whether a raw target string is an extended-length root (`\\?\C:\`).
 * @param raw - the raw path token.
 * @returns whether the form is an extended-length root.
 */
export declare function isExtendedRoot(raw: string): boolean;
/**
 * Whether a raw target string is a bare drive form (`C:`) whose meaning depends
 * on that drive's current directory.
 * @param raw - the raw path token.
 * @returns whether the form is a bare drive.
 */
export declare function isBareDriveForm(raw: string): boolean;
/**
 * Whether a raw target string is a UNC share root (`\\server\share\`).
 * @param raw - the raw path token.
 * @returns whether the form is a UNC share root.
 */
export declare function isUncRoot(raw: string): boolean;
/**
 * Whether a raw target string is the POSIX filesystem root.
 * @param raw - the raw path token.
 * @returns whether the form is the POSIX root.
 */
export declare function isPosixRoot(raw: string): boolean;
/** The protected roots resolved for one engine lifetime (config + platform environment). */
export interface ProtectedRoots {
    /** Absolute roots whose recursive deletion is disaster-tier (already normalized). */
    readonly roots: readonly string[];
    /** The user profile root (normalized). */
    readonly home: string;
    /** The system roots (SystemRoot, ProgramFiles, …) (normalized). */
    readonly system: readonly string[];
}
/**
 * Build the protected-root set from platform environment facts plus
 * user-configured extra roots. Every entry is normalized and folded.
 * @param extra - user-configured extra protected roots (absolute paths).
 * @param env - the environment facts to read roots from.
 * @returns the normalized registry.
 */
export declare function buildProtectedRoots(extra: readonly string[], env: NodeJS.ProcessEnv): ProtectedRoots;
/**
 * Whether a raw target equals one of the registered protected roots, or is a
 * drive/UNC/extended root, or a drive-root glob — the disaster-tier targets.
 * @param raw - the raw target token.
 * @param protectedRoots - the normalized registry.
 * @returns whether the target is disaster-tier.
 */
export declare function isProtectedTarget(raw: string, protectedRoots: ProtectedRoots): boolean;
/**
 * Whether two target paths name the same object after normalization and
 * case folding.
 * @param left - one normalized-or-raw target.
 * @param right - the other normalized-or-raw target.
 * @returns whether both normalize to the same path.
 */
export declare function targetEquals(left: string, right: string): boolean;
/**
 * Whether `child` is `parent` itself or a strict descendant of it.
 * @param parent - the normalized root.
 * @param child - the normalized candidate.
 * @returns whether `child` sits inside `parent`.
 */
export declare function isInside(parent: string, child: string): boolean;
//# sourceMappingURL=protected.d.ts.map