import z from "@deepseek-ai/schemastery";
import { spawn } from "node:child_process";
//#region lib/types/fingerprint.js
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
function fingerprintCommand(command) {
	return command.trim().replace(/\s+/g, " ");
}
/**
* Scoped pending-confirmation memory: fingerprint → expiry. Entries are pruned
* lazily on every read and write, and consumed exactly once.
*/
var PendingConfirmations = class {
	ttlMs;
	entries = /* @__PURE__ */ new Map();
	/** @param ttlMs - how long an unconfirmed preview stays confirmable. */
	constructor(ttlMs) {
		this.ttlMs = ttlMs;
	}
	/**
	* Whether a fingerprint was previewed and its confirmation window is open.
	* @param fingerprint - the normalized command fingerprint.
	*/
	has(fingerprint) {
		this.prune();
		const expiresAt = this.entries.get(fingerprint);
		return expiresAt !== void 0 && expiresAt > Date.now();
	}
	/**
	* Record one previewed fingerprint.
	* @param fingerprint - the normalized command fingerprint.
	*/
	add(fingerprint) {
		this.prune();
		this.entries.set(fingerprint, Date.now() + this.ttlMs);
	}
	/**
	* Consume one confirmation: returns true exactly once per recorded entry.
	* @param fingerprint - the normalized command fingerprint.
	*/
	consume(fingerprint) {
		this.prune();
		const expiresAt = this.entries.get(fingerprint);
		if (expiresAt === void 0 || expiresAt <= Date.now()) return false;
		this.entries.delete(fingerprint);
		return true;
	}
	/** Drop every expired entry. */
	prune() {
		const now = Date.now();
		for (const [fingerprint, expiresAt] of this.entries) if (expiresAt <= now) this.entries.delete(fingerprint);
	}
};
//#endregion
//#region lib/types/verbs.js
/**
* The destructive-command vocabulary the guard classifies: PowerShell and
* cmd-style verbs with their alias maps, the format/disk family, the recycle
* verb, and the POSIX (bash-dialect) set. Pure data plus canonicalization
* helpers — the analyzer and tier classifier both consume it.
*
* @module @deepseek-ai/dsh-command-guard/verbs
*/
/** PowerShell delete verbs and their cmd aliases, canonicalized to `delete`. */
const PWSH_DELETE_VERBS = new Set([
	"remove-item",
	"rm",
	"del",
	"erase",
	"rd",
	"rmdir",
	"ri"
]);
/** The disk/format family — always disaster-tier in every mode. */
const PWSH_FORMAT_VERBS = new Set([
	"format",
	"format-volume",
	"clear-disk",
	"initialize-disk",
	"remove-partition"
]);
/** The recycle verb — high-risk in every mode. */
const PWSH_RECYCLE_VERBS = new Set(["clear-recyclebin"]);
/** Bash-dialect delete verbs. */
const BASH_DELETE_VERBS = new Set([
	"rm",
	"rmdir",
	"unlink",
	"shred"
]);
/** Bash-dialect format/disk verbs — always disaster-tier. */
const BASH_FORMAT_VERBS = new Set([
	"mkfs",
	"mkfs.ext4",
	"mkfs.xfs",
	"mkfs.btrfs",
	"mkswap",
	"fdisk",
	"wipefs"
]);
/** cmd-style switches that mark a recursive delete (`rd /s`, `del /s`). */
const CMD_RECURSIVE_SWITCHES = new Set(["/s", "-s"]);
/** cmd-style switches that mark a forced delete (`rd /q`, `del /q`, `del /f`). */
const CMD_FORCE_SWITCHES = new Set([
	"/q",
	"-q",
	"/f",
	"-f"
]);
/** The robocopy mirror switch — mirroring INTO a protected root destroys its content. */
const CMD_MIRROR_SWITCHES = new Set(["/mir", "-mir"]);
/**
* The `.NET` deletion-primitive call pattern: `[IO.Directory]::Delete(path, $true)`
* and friends. Member expressions are not `CommandAst`s, so both the lexer and
* the AST analyzer match this signature textually.
*/
const NET_DELETE_CALL = /\[(?:System\.IO\.|IO\.)(Directory|File|FileInfo|DirectoryInfo)\]\s*::\s*Delete\s*\(/i;
/** The PowerShell dynamic-execution verbs the static analyzer cannot see through. */
const PWSH_DYNAMIC_VERBS = new Set(["iex", "invoke-expression"]);
/** Lowercase a verb for the canonical set lookups. */
function lower(verb) {
	return verb.toLowerCase();
}
/**
* Canonicalize a PowerShell verb into its risk family.
* @param verb - the raw command verb (aliases stay as written in the AST).
* @returns the family, or `undefined` for a non-destructive verb.
*/
function pwshVerbFamily(verb) {
	const canonical = lower(verb);
	if (PWSH_DELETE_VERBS.has(canonical)) return "delete";
	if (PWSH_FORMAT_VERBS.has(canonical)) return "format";
	if (PWSH_RECYCLE_VERBS.has(canonical)) return "recycle";
}
/**
* Whether a PowerShell verb is a dynamic-execution verb (`iex`).
* @param verb - the raw command verb.
*/
function isPwshDynamicVerb(verb) {
	return PWSH_DYNAMIC_VERBS.has(lower(verb));
}
/**
* Canonicalize a bash verb into its risk family.
* @param verb - the raw command verb.
* @returns the family, or `undefined` for a non-destructive verb.
*/
function bashVerbFamily(verb) {
	const canonical = lower(verb);
	if (BASH_DELETE_VERBS.has(canonical)) return "delete";
	if (BASH_FORMAT_VERBS.has(canonical)) return "format";
}
//#endregion
//#region lib/types/lexer.js
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
* @module @deepseek-ai/dsh-command-guard/lexer
*/
const EMPTY_FACTS = {
	families: [],
	verbs: [],
	literalPaths: [],
	netDeleteCall: false,
	diskpartClean: false,
	robocopyMir: false,
	recursive: false,
	force: false,
	wildcard: false,
	dynamic: false,
	dynamicVerb: false,
	findDelete: false
};
/** Split a command into whitespace-separated tokens while keeping quoted spans intact. */
function tokenize(command) {
	const tokens = [];
	let current = "";
	let quote;
	for (const char of command) {
		if (quote !== void 0) {
			current += char;
			if (char === quote) quote = void 0;
			continue;
		}
		if (char === "\"" || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === " " || char === "	" || char === "\r" || char === "\n") {
			if (current.length > 0) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current.length > 0) tokens.push(current);
	return tokens;
}
/** Strip one pair of matching surrounding quotes from a token. */
function unquote(token) {
	if (token.length >= 2) {
		const first = token[0];
		const last = token[token.length - 1];
		if ((first === "\"" || first === "'") && last === first) return token.slice(1, -1);
	}
	return token;
}
/** A Windows drive-letter path form: `C:`, `C:\`, `C:\foo` (with or without quotes already removed). */
const DRIVE_FORM = /^[A-Za-z]:[\\/]?/;
/** Whether a token looks like an absolute or drive-anchored path worth extracting. */
function isPathToken(token) {
	const bare = unquote(token);
	return DRIVE_FORM.test(bare) || bare.startsWith("\\\\") || bare.startsWith("/");
}
/** Whether a token carries a glob wildcard. */
function hasWildcardChar(token) {
	return token.includes("*") || token.includes("?");
}
/**
* Lex one PowerShell-family command string into crude facts. Verbs are
* canonicalized through {@link pwshVerbFamily}; switches and path tokens fill
* the rest. The `verb` filter accepts every token that could be a command
* position, so aliases and cmd-style binaries both surface.
* @param command - the model-supplied command text.
* @returns the crude facts; never throws.
*/
function lexPwsh(command) {
	const facts = {
		...EMPTY_FACTS,
		families: [],
		verbs: [],
		literalPaths: []
	};
	if (command.includes("$") || command.includes("${") || command.includes("`")) facts.dynamic = true;
	if (NET_DELETE_CALL.test(command)) facts.netDeleteCall = true;
	const tokens = tokenize(command);
	const verbs = [];
	const switches = /* @__PURE__ */ new Set();
	for (const token of tokens) {
		const bare = unquote(token);
		if (bare.length === 0) continue;
		const lowerBare = bare.toLowerCase();
		if (token.startsWith("-") || token.startsWith("/")) {
			if (bare.startsWith("--")) {
				if (lowerBare === "--recurse") facts.recursive = true;
				if (lowerBare === "--force") facts.force = true;
				continue;
			}
			const lowerSwitch = token.toLowerCase();
			switches.add(lowerSwitch);
			if (CMD_RECURSIVE_SWITCHES.has(lowerSwitch)) facts.recursive = true;
			if (CMD_FORCE_SWITCHES.has(lowerSwitch)) facts.force = true;
			if (CMD_MIRROR_SWITCHES.has(lowerSwitch)) facts.robocopyMir = true;
			if (lowerSwitch === "-recurse") facts.recursive = true;
			if (lowerSwitch === "-force") facts.force = true;
			continue;
		}
		const family = pwshVerbFamily(bare);
		if (family !== void 0) {
			facts.families.push(family);
			verbs.push(lowerBare);
			continue;
		}
		if (isPwshDynamicVerb(bare)) {
			facts.dynamicVerb = true;
			verbs.push(lowerBare);
			continue;
		}
		if (isPathToken(bare)) {
			facts.literalPaths.push(bare);
			if (hasWildcardChar(bare)) facts.wildcard = true;
			continue;
		}
		verbs.push(lowerBare);
	}
	facts.verbs = verbs;
	if (facts.verbs.includes("diskpart") && tokens.some((token) => token.toLowerCase() === "clean")) facts.diskpartClean = true;
	return facts;
}
/**
* Lex one bash command string into the same crude-facts vocabulary.
* @param command - the model-supplied command text.
* @returns the crude facts; never throws.
*/
function lexBash(command) {
	const facts = {
		...EMPTY_FACTS,
		families: [],
		verbs: [],
		literalPaths: []
	};
	if (command.includes("$") || command.includes("`") || command.includes("$((")) facts.dynamic = true;
	const tokens = tokenize(command);
	for (const token of tokens) {
		const bare = unquote(token);
		if (bare.length === 0) continue;
		const family = bashVerbFamily(bare);
		if (family !== void 0) {
			facts.families.push(family);
			facts.verbs.push(bare.toLowerCase());
			continue;
		}
		if (bare.startsWith("-")) {
			if (bare.includes("r") && !bare.startsWith("--")) facts.recursive = true;
			if (bare.includes("f") && !bare.startsWith("--")) facts.force = true;
			if (bare === "-delete") facts.findDelete = true;
			if (bare === "-r" || bare === "-R" || bare === "--recursive") facts.recursive = true;
			if (bare === "-f" || bare === "--force") facts.force = true;
			continue;
		}
		if (isPathToken(bare)) {
			facts.literalPaths.push(bare);
			if (hasWildcardChar(bare)) facts.wildcard = true;
			continue;
		}
		facts.verbs.push(bare.toLowerCase());
	}
	if (facts.verbs.includes("find") && facts.findDelete) facts.families.push("delete");
	return facts;
}
/**
* Whether the crude facts contain any destructive signal at all — the cheap
* allow gate before any analyzer spawn. Dynamic-execution verbs count: their
* payload is opaque, so they must never slip through the gate.
* @param facts - the lex result.
*/
function hasDestructiveSignal(facts) {
	return facts.families.length > 0 || facts.netDeleteCall || facts.diskpartClean || facts.robocopyMir || facts.dynamicVerb;
}
//#endregion
//#region lib/types/analyzer.js
/**
* The process-backed analyzer: a PowerShell AST pass over one command string,
* run as a helper `pwsh` invocation through an injectable {@link Spawner}. The
* analyzer script travels as a UTF-16LE `-EncodedCommand`, so the command text
* itself never crosses a command line — it rides the environment — and no
* quoting layer can corrupt it. The script parses WITHOUT executing: it walks
* every `CommandAst` and reports verbs, literal/expandable strings, variables,
* parameters, and `.NET` deletion member calls as one compact JSON line.
*
* @module @deepseek-ai/dsh-command-guard/analyzer
*/
/** The embedded analyzer script: parse `$env:DGUARD_CMD`, report, never execute. */
const ANALYZER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$cmd = $env:DGUARD_CMD
if ([string]::IsNullOrEmpty($cmd)) { Write-Output '{"ok":false,"parseErrors":1,"commands":[],"memberCalls":[]}'; exit 0 }
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($cmd, [ref]$tokens, [ref]$errors)
$commands = @()
$ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
  $strings = @()
  $expandables = @()
  $variables = @()
  $parameters = @()
  foreach ($el in $_.CommandElements) {
    if ($el -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $strings += $el.Value }
    elseif ($el -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) { $expandables += $el.Extent.Text }
    elseif ($el -is [System.Management.Automation.Language.VariableExpressionAst]) { $variables += ('$' + $el.VariablePath.UserPath) }
    elseif ($el -is [System.Management.Automation.Language.CommandParameterAst]) { $parameters += $el.ParameterName }
  }
  $commands += [ordered]@{ verb = $_.CommandElements[0].Extent.Text; strings = $strings; expandables = $expandables; variables = $variables; parameters = $parameters }
}
$memberCalls = @()
$match = [regex]::Match($cmd, '\[(?:System\.IO\.|IO\.)(Directory|File|FileInfo|DirectoryInfo)\]\s*::\s*Delete\s*\(')
while ($match.Success) { $memberCalls += $match.Groups[1].Value; $match = $match.NextMatch() }
[ordered]@{ ok = ($errors.Count -eq 0); parseErrors = $errors.Count; commands = $commands; memberCalls = $memberCalls } | ConvertTo-Json -Depth 6 -Compress
`;
/** UTF-16LE base64, the encoding `pwsh -EncodedCommand` requires. */
function encodeCommand(script) {
	return Buffer.from(script, "utf16le").toString("base64");
}
/**
* The default spawner: ordinary `node:child_process` spawn with a kill
* deadline and bounded stream collection. The host process is never confined
* when the guard runs, so pipe capture is safe here.
* @param argv - program plus arguments.
* @param options - environment overlay, timeout, and per-stream cap.
* @returns the settled output; never throws.
*/
async function nodeSpawner(argv, options) {
	const maxChars = options.maxChars ?? 262144;
	return await new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let stdoutTruncated = false;
		let stderrTruncated = false;
		let timedOut = false;
		let settled = false;
		const settle = (result) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};
		let child;
		try {
			child = spawn(argv[0], argv.slice(1), {
				env: {
					...process.env,
					...options.env
				},
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				]
			});
		} catch (error) {
			/* v8 ignore next -- spawn throws Error instances only; String(error) is a hostile-value guard */
			settle({
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: false,
				spawnError: error instanceof Error ? error.message : String(error)
			});
			return;
		}
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, options.timeoutMs);
		const outStream = child.stdout;
		/* v8 ignore next -- stdio: 'pipe' always yields streams; the null side only covers a hostile spawn result */
		if (outStream !== null) outStream.on("data", (chunk) => {
			const text = String(chunk);
			if (stdout.length + text.length > maxChars) {
				/* v8 ignore next -- one stream cannot cross the cap twice per run; the second cut is a defensive no-op */
				if (!stdoutTruncated) {
					stdout += "\n[output truncated]";
					stdoutTruncated = true;
				}
			} else stdout += text;
		});
		const errStream = child.stderr;
		/* v8 ignore next -- stdio: 'pipe' always yields streams; the null side only covers a hostile spawn result */
		if (errStream !== null) errStream.on("data", (chunk) => {
			const text = String(chunk);
			if (stderr.length + text.length > maxChars) {
				/* v8 ignore next -- one stream cannot cross the cap twice per run; the second cut is a defensive no-op */
				if (!stderrTruncated) {
					stderr += "\n[output truncated]";
					stderrTruncated = true;
				}
			} else stderr += text;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			settle({
				stdout,
				stderr,
				exitCode: null,
				timedOut,
				spawnError: error.message
			});
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			settle({
				stdout,
				stderr,
				exitCode: code,
				timedOut
			});
		});
	});
}
/** Whether the caller aborted before a pending spawn could start. */
function aborted(signal) {
	return signal !== void 0 && signal.aborted;
}
/** Validate and normalize one command entry from the untrusted script output. */
function parseCommandReport(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const record = value;
	if (typeof record["verb"] !== "string") return void 0;
	const strings = Array.isArray(record["strings"]) ? record["strings"].filter((item) => typeof item === "string").slice(0, 64) : [];
	const expandables = Array.isArray(record["expandables"]) ? record["expandables"].filter((item) => typeof item === "string").slice(0, 64) : [];
	const variables = Array.isArray(record["variables"]) ? record["variables"].filter((item) => typeof item === "string").slice(0, 64) : [];
	const parameters = Array.isArray(record["parameters"]) ? record["parameters"].filter((item) => typeof item === "string").slice(0, 64) : [];
	return {
		verb: record["verb"],
		strings,
		expandables,
		variables,
		parameters
	};
}
/**
* Parse and validate the analyzer script's single JSON output line. Rogue or
* truncated output fails closed into a non-ok report.
* @param stdout - the helper's captured stdout.
* @returns the validated report.
*/
function parsePwshReport(stdout) {
	const line = stdout.trim().split(/\r?\n/).filter((part) => part.length > 0).at(-1);
	if (line === void 0) return {
		ok: false,
		aborted: false,
		parseErrors: -1,
		commands: [],
		memberCalls: []
	};
	try {
		const parsed = JSON.parse(line);
		if (typeof parsed !== "object" || parsed === null) return {
			ok: false,
			aborted: false,
			parseErrors: -1,
			commands: [],
			memberCalls: []
		};
		const record = parsed;
		const commands = Array.isArray(record["commands"]) ? record["commands"].map(parseCommandReport).filter((item) => item !== void 0) : [];
		const memberCalls = Array.isArray(record["memberCalls"]) ? record["memberCalls"].filter((item) => typeof item === "string").slice(0, 16) : [];
		return {
			ok: record["ok"] === true && typeof record["parseErrors"] === "number" && record["parseErrors"] === 0,
			aborted: false,
			parseErrors: typeof record["parseErrors"] === "number" ? record["parseErrors"] : -1,
			commands,
			memberCalls
		};
	} catch {
		return {
			ok: false,
			aborted: false,
			parseErrors: -1,
			commands: [],
			memberCalls: []
		};
	}
}
/**
* The PowerShell AST analyzer. One instance per guard engine; every analysis
* is a fresh helper process, so no state accumulates.
*/
var PwshAnalyzer = class {
	spawner;
	options;
	constructor(spawner, options) {
		this.spawner = spawner;
		this.options = options;
	}
	/**
	* Run the read-only AST pass over one command.
	* @param command - the model-supplied PowerShell command text.
	* @param signal - the tool-call abort signal; an aborted caller yields an aborted report.
	* @returns the validated report; spawn failures and timeouts fail closed.
	*/
	async analyze(command, signal) {
		if (aborted(signal)) return {
			ok: false,
			aborted: true,
			parseErrors: -1,
			commands: [],
			memberCalls: []
		};
		const result = await this.spawner([
			this.options.pwshPath,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encodeCommand(ANALYZER_SCRIPT)
		], {
			env: { DGUARD_CMD: command },
			timeoutMs: this.options.timeoutMs
		});
		if (result.spawnError !== void 0 || result.exitCode === null || result.timedOut) return {
			ok: false,
			aborted: aborted(signal),
			parseErrors: -1,
			commands: [],
			memberCalls: []
		};
		if (result.exitCode !== 0) return {
			ok: false,
			aborted: aborted(signal),
			parseErrors: -1,
			commands: [],
			memberCalls: []
		};
		const report = parsePwshReport(result.stdout);
		return aborted(signal) ? {
			...report,
			ok: false,
			aborted: true
		} : report;
	}
	/** The `.NET` deletion member calls the caller-visible regex already found, for cross-checks. */
	static hasNetDelete(command) {
		return NET_DELETE_CALL.test(command);
	}
};
//#endregion
//#region lib/types/protected.js
/**
* Protected-path predicates: the registry of absolute roots whose recursive
* deletion (or mirror-overwrite) is disaster-tier in every sandbox mode, plus
* the containment helper the high-risk tier uses to decide "inside the
* workspace". All comparisons are case-insensitive on Windows path forms and
* byte-exact otherwise, decided from the path text itself so the same code
* classifies both PowerShell and bash targets on any host.
*
* @module @deepseek-ai/dsh-command-guard/protected
*/
/** A PowerShell-style drive-letter root WITH its separator: `C:\`. */
const DRIVE_ROOT = /^[A-Za-z]:\\$/;
/** A drive-root glob: `C:\*`, `C:\*.*`, `C:*`. */
const DRIVE_ROOT_WILDCARD = /^[A-Za-z]:\\?\*+(?:\.\*+)?$/;
/** An extended-length root: `\\?\C:\` (trailing separator optional). */
const EXTENDED_ROOT = /^\\\\\?\\[A-Za-z]:\\?$/;
/** A bare drive form without a separator: `C:` (relative to that drive's cwd). */
const BARE_DRIVE = /^[A-Za-z]:$/;
/** A UNC share root: exactly `\\server\share` with an optional trailing separator. */
const UNC_ROOT = /^\\\\[^\\]+\\([^\\]+)\\?$/;
/** The POSIX filesystem root. */
const POSIX_ROOT = "/";
/** Whether a path form uses Windows drive-letter semantics. */
function isWindowsForm(path) {
	return /^[A-Za-z]:/.test(path) || path.startsWith("\\\\");
}
/** Lowercase a path only when it uses Windows path forms. */
function fold(path) {
	return isWindowsForm(path) ? path.toLowerCase() : path;
}
/** Strip trailing separators and a trailing glob star from a target path. */
function normalizeTarget(raw) {
	let target = raw.trim();
	if (target.startsWith("\"") && target.endsWith("\"") || target.startsWith("'") && target.endsWith("'")) target = target.slice(1, -1);
	target = target.replace(/[*]+$/, "");
	target = target.replace(/[\\/]+$/, "");
	return target;
}
/**
* Whether a raw target string is a drive root (`C:\` or `C:`-with-separator forms).
* @param raw - the raw path token.
*/
function isDriveRootPath(raw) {
	return DRIVE_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is a drive-root glob (`C:\*`, `C:\*.*`).
* @param raw - the raw path token.
*/
function isDriveRootWildcard(raw) {
	return DRIVE_ROOT_WILDCARD.test(raw.trim());
}
/**
* Whether a raw target string is an extended-length root (`\\?\C:\`).
* @param raw - the raw path token.
*/
function isExtendedRoot(raw) {
	return EXTENDED_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is a bare drive form (`C:`) whose meaning depends
* on that drive's current directory.
* @param raw - the raw path token.
*/
function isBareDriveForm(raw) {
	return BARE_DRIVE.test(raw.trim());
}
/**
* Whether a raw target string is a UNC share root (`\\server\share\`).
* @param raw - the raw path token.
*/
function isUncRoot(raw) {
	return UNC_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is the POSIX filesystem root.
* @param raw - the raw path token.
*/
function isPosixRoot(raw) {
	return raw.trim() === POSIX_ROOT;
}
/**
* Build the protected-root set from platform environment facts plus
* user-configured extra roots. Every entry is normalized and folded.
* @param extra - user-configured extra protected roots (absolute paths).
* @param env - the environment facts to read roots from.
* @returns the normalized registry.
*/
function buildProtectedRoots(extra, env) {
	const roots = /* @__PURE__ */ new Set();
	const system = [];
	for (const key of [
		"SystemRoot",
		"ProgramFiles",
		"ProgramFiles(x86)",
		"ProgramW6432"
	]) {
		const value = env[key];
		if (value === void 0) continue;
		const normalized = fold(normalizeTarget(value));
		roots.add(normalized);
		system.push(normalized);
	}
	const home = fold(normalizeTarget(env.USERPROFILE ?? env.HOME ?? process.cwd()));
	roots.add(home);
	for (const extraPath of extra) {
		const normalized = fold(normalizeTarget(extraPath));
		if (normalized.length > 0) roots.add(normalized);
	}
	return {
		roots: [...roots],
		home,
		system
	};
}
/**
* Whether a raw target equals one of the registered protected roots, or is a
* drive/UNC/extended root, or a drive-root glob — the disaster-tier targets.
* @param raw - the raw target token.
* @param protectedRoots - the normalized registry.
*/
function isProtectedTarget(raw, protectedRoots) {
	if (isDriveRootPath(raw) || isDriveRootWildcard(raw) || isExtendedRoot(raw) || isUncRoot(raw) || isPosixRoot(raw)) return true;
	const normalized = fold(normalizeTarget(raw));
	return normalized.length > 0 && protectedRoots.roots.includes(normalized);
}
/**
* Whether two target paths name the same object after normalization and
* case folding.
* @param left - one normalized-or-raw target.
* @param right - the other normalized-or-raw target.
*/
function targetEquals(left, right) {
	return fold(normalizeTarget(left)) === fold(normalizeTarget(right));
}
/**
* Whether `child` is `parent` itself or a strict descendant of it.
* @param parent - the normalized root.
* @param child - the normalized candidate.
*/
function isInside(parent, child) {
	const foldedParent = fold(normalizeTarget(parent));
	const foldedChild = fold(normalizeTarget(child));
	if (foldedChild === foldedParent) return true;
	if (foldedParent.length === 0) return false;
	const separator = foldedChild.includes("\\") && !foldedChild.includes("/") ? "\\" : "/";
	return foldedChild.startsWith(foldedParent + separator);
}
//#endregion
//#region lib/types/preview.js
/**
* The careful-full-access preview pipeline: a read-only dry run that resolves
* the command's REAL deletion scope before anything executes. The dry run sets
* `$WhatIfPreference = $true` — the engine-level switch every ShouldProcess
* cmdlet honors — so wildcards, variables, and `$env:` expansions are resolved
* by PowerShell itself, not by the guard's parsing. `What if:` lines give the
* concrete target list; recursive directory targets get one extra read-only
* subtree enumeration (the dry run alone prints only the top directory), and
* any resolved target that IS a protected root refuses outright.
*
* The command runs once with WhatIf on, so non-delete side effects before a
* delete cmdlet DO execute during the preview — a documented tradeoff of
* asking the shell itself for the truth.
*
* @module @deepseek-ai/dsh-command-guard/preview
*/
/** One dry-run line: `What if: Performing the operation "Remove File" on target "D:\x".` */
const WHATIF_LINE = /^what if:.*?operation\s+"([^"]+)"\s+on\s+target\s+"([^"]+)"/i;
/** The localized (zh-CN) form: `假设: 正在目标“D:\x”上执行操作“Remove File”。` */
const WHATIF_LINE_ZH = /^假设[:：]\s*正在目标[“"]([^”"]+)[”"]上执行操作[“"]([^”"]+)[”"]/;
/** The dry-run wrapper: preference on, then the command as written. */
const PREVIEW_SCRIPT = String.raw`
$WhatIfPreference = $true
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
`;
/** The subtree enumeration script: counts and samples per resolved directory. */
const ENUMERATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$out = @()
foreach ($t in $targets) {
  if (Test-Path -LiteralPath $t -PathType Container) {
    $items = @(Get-ChildItem -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue)
    $fileCount = 0
    $dirCount = 0
    foreach ($item in $items) { if ($item.PSIsContainer) { $dirCount += 1 } else { $fileCount += 1 } }
    $samples = @($items | Select-Object -First 10 | ForEach-Object { $_.FullName })
    $out += [ordered]@{ path = $t; files = $fileCount; dirs = $dirCount; samples = $samples; truncated = ($items.Count -gt 10) }
  } else {
    $out += [ordered]@{ path = $t; files = -1; dirs = -1; samples = @(); truncated = $false; missing = $true }
  }
}
$out | ConvertTo-Json -Depth 5 -Compress
`;
/** Parse every `What if:` line (English or zh-CN form) from the dry-run output. */
function parseWhatIfLines(stdout) {
	const targets = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = WHATIF_LINE.exec(line);
		if (match !== null) {
			targets.push({
				op: match[1],
				target: match[2]
			});
			continue;
		}
		const zhMatch = WHATIF_LINE_ZH.exec(line);
		if (zhMatch !== null) targets.push({
			op: zhMatch[2],
			target: zhMatch[1]
		});
	}
	return targets;
}
/** Parse and validate the enumeration script's JSON output. */
function parseEnumeration(stdout) {
	const line = stdout.trim().split(/\r?\n/).filter((part) => part.length > 0).at(-1);
	if (line === void 0) return void 0;
	try {
		const parsed = JSON.parse(line);
		if (!Array.isArray(parsed)) return void 0;
		return parsed.map((entry) => {
			if (typeof entry !== "object" || entry === null) return void 0;
			const record = entry;
			if (typeof record["path"] !== "string" || typeof record["files"] !== "number" || typeof record["dirs"] !== "number" || !Array.isArray(record["samples"])) return void 0;
			return {
				path: record["path"],
				files: record["files"],
				dirs: record["dirs"],
				samples: record["samples"].filter((item) => typeof item === "string"),
				truncated: record["truncated"] === true,
				...record["missing"] === true ? { missing: true } : {}
			};
		}).filter((item) => item !== void 0);
	} catch {
		return;
	}
}
/** Build the enumeration script with the resolved targets embedded as a literal array. */
function buildEnumerationScript(targets) {
	return `$targets = @(${targets.map((target) => JSON.stringify(target)).join(", ")})\n${ENUMERATE_SCRIPT}`;
}
/** Render the bounded model-facing preview summary. */
function renderPreviewSummary(fileCount, directoryCount, samples, truncated) {
	return `command guard preview: this deletion resolves to ${fileCount + directoryCount} objects (${fileCount} files, ${directoryCount} directories)` + (samples.length > 0 ? `; first targets: ${samples.map((sample) => `"${sample}"`).join(", ")}${truncated ? ", …" : ""}` : "") + " — verify this scope matches your intent, then re-send the identical command to confirm execution";
}
/**
* Run the two-stage preview: WhatIf dry run, then subtree enumeration for the
* resolved directory targets. Protected-root hits refuse before enumeration.
*/
var PreviewRunner = class {
	spawner;
	options;
	protectedRoots;
	constructor(spawner, options, protectedRoots) {
		this.spawner = spawner;
		this.options = options;
		this.protectedRoots = protectedRoots;
	}
	/**
	* Dry-run one command and resolve its real deletion scope.
	* @param command - the model-supplied command text.
	* @param signal - the tool-call abort signal.
	* @returns the preview outcome; every failure shape is fail-closed.
	*/
	async preview(command, signal) {
		if (signal?.aborted) return {
			kind: "unpreviewable",
			detail: "the call was aborted before the preview ran"
		};
		const dryRun = await this.spawner([
			this.options.pwshPath,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encodeCommand(PREVIEW_SCRIPT + command)
		], { timeoutMs: this.options.timeoutMs });
		if (dryRun.spawnError !== void 0 || dryRun.exitCode === null || dryRun.timedOut) return {
			kind: "unpreviewable",
			detail: "the dry run could not complete (spawn failure or timeout)"
		};
		const targets = parseWhatIfLines(dryRun.stdout);
		if (targets.length === 0) return dryRun.exitCode === 0 ? { kind: "zero-targets" } : {
			kind: "unpreviewable",
			detail: "the dry run produced no preview targets and exited non-zero"
		};
		for (const { target } of targets) if (isProtectedTarget(target, this.protectedRoots)) return {
			kind: "protected-hit",
			target
		};
		const fileTargets = targets.filter((entry) => !entry.op.toLowerCase().includes("directory")).length;
		const directoryTargets = targets.filter((entry) => entry.op.toLowerCase().includes("directory")).map((entry) => entry.target);
		if (directoryTargets.length === 0) return {
			kind: "previewed",
			objectCount: fileTargets,
			fileCount: fileTargets,
			directoryCount: 0,
			samples: targets.slice(0, this.options.sampleLimit).map((entry) => entry.target),
			truncated: targets.length > this.options.sampleLimit
		};
		const enumeration = await this.spawner([
			this.options.pwshPath,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			encodeCommand(buildEnumerationScript(directoryTargets))
		], { timeoutMs: this.options.timeoutMs });
		if (enumeration.spawnError !== void 0 || enumeration.exitCode !== 0 || enumeration.timedOut) return {
			kind: "unpreviewable",
			detail: "the subtree enumeration could not complete (spawn failure or timeout)"
		};
		const subtrees = parseEnumeration(enumeration.stdout);
		if (subtrees === void 0) return {
			kind: "unpreviewable",
			detail: "the subtree enumeration produced unreadable output"
		};
		let fileCount = fileTargets;
		let directoryCount = 0;
		const samples = targets.slice(0, this.options.sampleLimit).map((entry) => entry.target);
		let truncated = targets.length > this.options.sampleLimit;
		for (const subtree of subtrees) {
			if (subtree.missing === true) continue;
			fileCount += subtree.files;
			directoryCount += subtree.dirs;
			for (const sample of subtree.samples) if (samples.length < this.options.sampleLimit) samples.push(sample);
			truncated = truncated || subtree.truncated;
		}
		return {
			kind: "previewed",
			objectCount: fileCount + directoryCount,
			fileCount,
			directoryCount,
			samples,
			truncated
		};
	}
};
/** A summary line for tests and the engine's deny reason. */
function previewDenyReason(outcome) {
	return renderPreviewSummary(outcome.fileCount, outcome.directoryCount, outcome.samples, outcome.truncated);
}
//#endregion
//#region lib/types/tiers.js
/**
* The tier classifier: maps an analyzer report (plus the lexical fallback
* facts) onto the four guard tiers. Pure — no processes, no sessions — so the
* same rules run identically for the fast lex-only path and the full AST path.
*
* The tiers are mode-independent by design: which tier becomes deny, ask, or
* the careful-preview pipeline is the engine's per-mode decision, not the
* classifier's.
*
* @module @deepseek-ai/dsh-command-guard/tiers
*/
/** Collect every candidate target path from both analysis layers, deduplicated. */
function collectTargets(report, facts) {
	const seen = /* @__PURE__ */ new Set();
	const targets = [];
	for (const target of [...facts.literalPaths, ...report === void 0 ? [] : report.commands.flatMap((command) => command.strings)]) {
		const folded = target.toLowerCase();
		if (seen.has(folded)) continue;
		seen.add(folded);
		targets.push(target);
	}
	return targets;
}
/** Whether any AST command (or the lex pass) carries the recursive marker. */
function hasRecursive(report, facts) {
	if (facts.recursive) return true;
	if (report === void 0) return false;
	return report.commands.some((command) => command.parameters.some((parameter) => parameter.toLowerCase() === "recurse"));
}
/** Whether any AST command (or the lex pass) carries the force marker. */
function hasForce(report, facts) {
	if (facts.force) return true;
	return report.commands.some((command) => command.parameters.some((parameter) => parameter.toLowerCase() === "force"));
}
/** Whether the command references dynamic, statically unresolvable targets. */
function hasDynamicTarget(report, facts) {
	if (facts.dynamic) return true;
	return report.commands.some((command) => command.variables.length > 0 || command.expandables.length > 0);
}
/** Whether any candidate target hits the protected registry or the workspace root. */
function hitsProtected(targets, context) {
	for (const target of targets) {
		if (isProtectedTarget(target, context.protectedRoots)) return target;
		if (target.includes("*") || target.includes("?")) continue;
		if (context.workspaceRoot !== void 0 && targetEquals(context.workspaceRoot, target)) return target;
	}
}
/** Whether any candidate target sits INSIDE a registered protected root (but is not the root itself). */
function hitsInsideProtected(targets, context) {
	for (const target of targets) for (const root of context.protectedRoots.roots) if (!targetEquals(root, target) && isInside(root, target)) return target;
}
/** Whether any candidate target is a bare drive form (`C:`) or sits outside the workspace. */
function findsUnbounded(targets, context) {
	for (const target of targets) {
		if (isBareDriveForm(target)) return target;
		if (context.workspaceRoot !== void 0 && !isInside(context.workspaceRoot, target)) return target;
	}
}
/** Whether a `.NET` delete call names a recursive erase (`true` second argument). */
function netDeleteRecursive(rawCommand) {
	return /Delete\s*\([^)]*,\s*\$?true\s*\)/i.test(rawCommand);
}
/**
* Classify one PowerShell command.
* @param rawCommand - the full command text (for `.NET` call argument checks).
* @param report - the AST report, or `undefined` when the analysis failed.
* @param facts - the lexical facts (always present).
* @param context - per-call policy facts and protected roots.
* @returns the tier verdict with its model-facing reason.
*/
function classifyPwsh(rawCommand, report, facts, context) {
	const families = new Set(facts.families);
	if (report !== void 0) for (const command of report.commands) {
		const family = pwshVerbFamily(command.verb);
		if (family !== void 0) families.add(family);
	}
	if (!(families.size > 0 || facts.netDeleteCall || facts.diskpartClean || facts.robocopyMir || facts.dynamicVerb)) return {
		tier: "normal",
		reason: ""
	};
	if (facts.dynamicVerb) return {
		tier: "unparseable",
		reason: "command guard: dynamic execution (iex/Invoke-Expression) cannot be statically analyzed"
	};
	if (families.has("format") || facts.diskpartClean) return {
		tier: "disaster",
		reason: "command guard: disk-level operations (format/clear/partition) are refused in every mode"
	};
	const targets = collectTargets(report, facts);
	const protectedHit = hitsProtected(targets, context);
	const recursive = hasRecursive(report, facts);
	if (facts.robocopyMir && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: robocopy /MIR against the protected root "${protectedHit}" is refused in every mode`
	};
	if (facts.netDeleteCall && protectedHit !== void 0 && netDeleteRecursive(rawCommand)) return {
		tier: "disaster",
		reason: `command guard: recursive .NET deletion of the protected root "${protectedHit}" is refused in every mode`
	};
	if (facts.netDeleteCall && protectedHit !== void 0) return {
		tier: "high-risk",
		reason: `command guard: .NET deletion targeting the protected root "${protectedHit}" needs explicit review`
	};
	const insideProtected = facts.netDeleteCall ? hitsInsideProtected(targets, context) : void 0;
	if (insideProtected !== void 0) return {
		tier: "high-risk",
		reason: `command guard: .NET deletion inside the protected root (${insideProtected}) needs explicit review`
	};
	if (families.has("delete") && recursive && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: recursive deletion of the protected root "${protectedHit}" is refused in every mode`
	};
	if (families.has("recycle")) return {
		tier: "high-risk",
		reason: "command guard: emptying the recycle bin needs explicit review"
	};
	if (report === void 0 || !report.ok) return {
		tier: "unparseable",
		reason: "command guard: the deletion command could not be parsed safely"
	};
	const force = hasForce(report, facts);
	const dynamic = hasDynamicTarget(report, facts);
	if (families.has("delete")) {
		if (recursive && dynamic) return {
			tier: "high-risk",
			reason: "command guard: recursive deletion with dynamically resolved targets needs explicit review"
		};
		if (recursive && force && (facts.wildcard || findsUnbounded(targets, context) !== void 0)) return {
			tier: "high-risk",
			reason: "command guard: recursive forced deletion outside the workspace needs explicit review"
		};
		if (recursive && targets.length === 0) return {
			tier: "high-risk",
			reason: "command guard: recursive deletion with no statically visible target needs explicit review"
		};
		if (targets.length > 1) return {
			tier: "high-risk",
			reason: `command guard: batch deletion of ${targets.length} targets needs explicit review`
		};
		return {
			tier: "normal",
			reason: ""
		};
	}
	return {
		tier: "normal",
		reason: ""
	};
}
/**
* Classify one bash command from its lexical facts (POSIX has no AST pass).
* @param facts - the lexical facts.
* @param context - per-call policy facts and protected roots.
* @returns the tier verdict with its model-facing reason.
*/
function classifyBash(facts, context) {
	const families = new Set(facts.families);
	if (families.size === 0) return {
		tier: "normal",
		reason: ""
	};
	if (families.has("format")) return {
		tier: "disaster",
		reason: "command guard: disk-level operations (mkfs/fdisk/wipefs) are refused in every mode"
	};
	const protectedHit = hitsProtected(facts.literalPaths, context);
	if (facts.recursive && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: recursive deletion of the protected root "${protectedHit}" is refused in every mode`
	};
	if (facts.recursive && facts.dynamic) return {
		tier: "high-risk",
		reason: "command guard: recursive deletion with dynamically resolved targets needs explicit review"
	};
	if (facts.recursive && facts.force && (facts.wildcard || findsUnbounded(facts.literalPaths, context) !== void 0)) return {
		tier: "high-risk",
		reason: "command guard: recursive forced deletion outside the workspace needs explicit review"
	};
	if (facts.findDelete) return {
		tier: "high-risk",
		reason: "command guard: find -delete needs explicit review"
	};
	return {
		tier: "normal",
		reason: ""
	};
}
//#endregion
//#region lib/types/engine.js
/**
* The guard engine: one judge pass per shell tool call. It runs the cheap
* lexical scan first (the fast allow/deny gate for the overwhelming majority
* of commands), spawns the AST analyzer only for destructive signals, maps the
* tier verdict onto the per-mode decision, and in `careful-full-access` routes
* every non-disaster deletion through the preview pipeline and the model-check
* two-step confirmation.
*
* @module @deepseek-ai/dsh-command-guard/engine
*/
/**
* The stateless-per-call orchestrator. Instance state is only the pending
* confirmation memory, keyed per session by the caller.
*/
var GuardEngine = class {
	options;
	pending;
	constructor(options) {
		this.options = options;
		this.pending = new PendingConfirmations(options.confirmTtlMs);
	}
	/**
	* Judge one shell call.
	* @param input - the call facts.
	* @returns the mode-aware decision.
	*/
	async judge(input) {
		const context = {
			...input.workspaceRoot === void 0 ? {} : { workspaceRoot: input.workspaceRoot },
			protectedRoots: this.options.protectedRoots
		};
		if (input.dialect === "bash") return this.judgeBash(input, context);
		return this.judgePwsh(input, context);
	}
	async judgePwsh(input, context) {
		const facts = lexPwsh(input.command);
		if (!hasDestructiveSignal(facts)) return { kind: "allow" };
		const fastVerdict = classifyPwsh(input.command, void 0, facts, context);
		if (fastVerdict.tier === "disaster") return {
			kind: "deny",
			reason: fastVerdict.reason
		};
		const report = await this.options.analyzer.analyze(input.command, input.signal);
		const verdict = classifyPwsh(input.command, report, facts, context);
		return await this.route(input, verdict, "pwsh");
	}
	async judgeBash(input, context) {
		const facts = lexBash(input.command);
		if (!hasDestructiveSignal(facts)) return { kind: "allow" };
		const verdict = classifyBash(facts, context);
		return await this.route(input, verdict, "bash");
	}
	async route(input, verdict, dialect) {
		if (verdict.tier === "disaster") return {
			kind: "deny",
			reason: verdict.reason
		};
		if (input.mode === "careful-full-access" && dialect === "pwsh") return await this.carefulRoute(input, verdict);
		if (verdict.tier === "normal") return { kind: "allow" };
		return {
			kind: "ask",
			reason: verdict.reason
		};
	}
	/** The careful-full-access route: preview + model-check two-step confirmation. */
	async carefulRoute(input, verdict) {
		const fingerprint = this.pendingKey(input.sessionKey, fingerprintCommand(input.command));
		if (this.pending.consume(fingerprint)) return { kind: "allow" };
		const outcome = await this.options.preview.preview(input.command, input.signal);
		switch (outcome.kind) {
			case "protected-hit": return {
				kind: "deny",
				reason: `command guard: the preview resolved the protected root "${outcome.target}" — recursive deletion there is refused in every mode`
			};
			case "zero-targets": return { kind: "allow" };
			case "unpreviewable": return {
				kind: "deny",
				reason: `command guard: this deletion cannot be dry-run safely (${outcome.detail}); rewrite it as an explicit Remove-Item with literal paths`
			};
			case "previewed":
				this.pending.add(fingerprint);
				return {
					kind: "deny",
					reason: previewDenyReason(outcome)
				};
			/* v8 ignore next 3 -- PreviewOutcome is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
			default: throw new Error(`unreachable preview outcome: ${String(outcome)}`);
		}
	}
	/** Session-scoped pending key: the same command in another session previews again. */
	pendingKey(sessionKey, fingerprint) {
		return sessionKey + "\n" + fingerprint;
	}
};
//#endregion
//#region lib/types/index.js
/**
* The command-guard plugin: a host-plane `tools/pre-execute` listener that
* judges every `pwsh`/`bash` call before dispatch. Disaster-tier deletions are
* denied in every sandbox mode; high-risk ones ask through the ordinary
* approval pipeline (fail-closed under `never`); and in `careful-full-access`
* every non-disaster deletion runs the WhatIf preview plus the model-check
* two-step confirmation. Every non-allow judgment is audited as a
* `command-guard/decision` session event, and a system-prompt section teaches
* the deletion discipline the model cooperates with.
*
* @module @deepseek-ai/dsh-command-guard
*/
/** The model-facing deletion-discipline section. */
const PROMPT = "Deletion discipline (enforced by the command guard): prefer a -WhatIf dry run or an explicit listing before deleting; never recurse into drive roots, the user profile, or system directories; treat undefined $env: variables as errors, not empty strings; in careful-full-access mode a deletion first returns a preview of its resolved scope — verify it matches your intent, then re-send the identical command to confirm execution.";
/** Cordis plugin name used by loader diagnostics. */
const name = "command-guard";
/** The tool registry whose pre-execute waterfall this plugin listens on. */
const inject = ["tools"];
/** Default kill deadline for the AST analysis spawn. */
const DEFAULT_ANALYZE_TIMEOUT_MS = 15e3;
/** Default kill deadline for each preview/enumeration spawn. */
const DEFAULT_PREVIEW_TIMEOUT_MS = 15e3;
/** Default sample-path cap in preview summaries. */
const DEFAULT_PREVIEW_SAMPLE_LIMIT = 10;
/** Default confirmation window for an unconfirmed preview. */
const DEFAULT_CONFIRM_TTL_MS = 12e4;
const Config = z.object({
	extraProtectedPaths: z.array(z.string()).default([]),
	confirmTtlMs: z.number().default(DEFAULT_CONFIRM_TTL_MS),
	analyzeTimeoutMs: z.number().default(DEFAULT_ANALYZE_TIMEOUT_MS),
	previewTimeoutMs: z.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
	previewSampleLimit: z.number().default(10),
	pwshPath: z.string().default("pwsh"),
	enablePrompt: z.boolean().default(true)
});
/** Extract the command string from parsed shell-tool arguments. */
function extractCommand(arguments_) {
	/* v8 ignore next -- the tool registry validates arguments as an object; this guard only covers hostile typed-boundary input */
	if (typeof arguments_ !== "object" || arguments_ === null) return void 0;
	const command = arguments_["command"];
	return typeof command === "string" && command.trim().length > 0 ? command : void 0;
}
/**
* Register the pre-execute listener, the audit append, and the prompt section.
* @param ctx - the host context the row mounts under.
* @param config - the validated plugin config.
*/
function apply(ctx, config) {
	const protectedRoots = buildProtectedRoots(config.extraProtectedPaths ?? [], process.env);
	const engine = new GuardEngine({
		analyzer: new PwshAnalyzer(nodeSpawner, {
			timeoutMs: config.analyzeTimeoutMs ?? 15e3,
			pwshPath: config.pwshPath ?? "pwsh"
		}),
		preview: new PreviewRunner(nodeSpawner, {
			timeoutMs: config.previewTimeoutMs ?? 15e3,
			sampleLimit: config.previewSampleLimit ?? 10,
			pwshPath: config.pwshPath ?? "pwsh"
		}, protectedRoots),
		protectedRoots,
		confirmTtlMs: config.confirmTtlMs ?? 12e4
	});
	const sandboxPolicy = ctx.get("sandboxPolicy");
	ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name !== "pwsh" && exec.name !== "bash") return next();
		const command = extractCommand(exec.arguments);
		if (command === void 0) return next();
		const session = exec.agent?.session;
		const policy = sandboxPolicy === void 0 || session === void 0 ? void 0 : sandboxPolicy.resolve({ session });
		const decision = await engine.judge({
			dialect: exec.name === "pwsh" ? "pwsh" : "bash",
			command,
			mode: policy?.mode,
			workspaceRoot: policy?.workspaceRoot,
			signal: exec.signal,
			sessionKey: session === void 0 ? "" : String(session.id)
		});
		if (session !== void 0 && decision.kind !== "allow") try {
			session.append("command-guard/decision", {
				toolName: exec.name,
				decision: decision.kind,
				...policy?.mode !== void 0 ? { mode: policy.mode } : {},
				/* v8 ignore next -- audit appends only for non-allow decisions, so the false side is unreachable */
				...decision.kind === "deny" || decision.kind === "ask" ? { reason: decision.reason } : {},
				/* v8 ignore next -- the registry always stamps callId on executions */
				...exec.callId !== void 0 ? { callId: exec.callId } : {}
			});
		} catch (error) {
			ctx.logger.warn(`command-guard: audit append failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		switch (decision.kind) {
			case "allow": return next();
			case "deny": return {
				kind: "deny",
				reason: decision.reason
			};
			case "ask": return {
				kind: "ask",
				reason: decision.reason
			};
		}
	});
	if (config.enablePrompt) ctx.inject(["systemPrompt"], (scope) => {
		scope.systemPrompt.context({
			name: "command-guard:deletion-discipline",
			order: 112,
			text: () => PROMPT
		});
	});
}
//#endregion
export { Config, DEFAULT_ANALYZE_TIMEOUT_MS, DEFAULT_CONFIRM_TTL_MS, DEFAULT_PREVIEW_SAMPLE_LIMIT, DEFAULT_PREVIEW_TIMEOUT_MS, GuardEngine, PendingConfirmations, PreviewRunner, PwshAnalyzer, apply, bashVerbFamily, buildProtectedRoots, classifyBash, classifyPwsh, encodeCommand, fingerprintCommand, hasDestructiveSignal, inject, isBareDriveForm, isDriveRootPath, isDriveRootWildcard, isExtendedRoot, isInside, isPosixRoot, isProtectedTarget, isPwshDynamicVerb, isUncRoot, lexBash, lexPwsh, name, nodeSpawner, normalizeTarget, parseEnumeration, parsePwshReport, parseWhatIfLines, previewDenyReason, pwshVerbFamily, renderPreviewSummary };
