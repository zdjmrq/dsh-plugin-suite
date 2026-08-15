import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region lib/types/audit.js
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
function renderLine(line) {
	return JSON.stringify(line);
}
/**
* Size-capped, rotated JSONL audit file. Appends are serialized through one
* promise chain so concurrent decisions never interleave; every failure is
* contained into the supplied `onError` so an audit problem can never flip a
* guard decision.
*/
var AuditLogger = class {
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
		this.chain = this.chain.then(() => this.append(renderLine(line))).catch((error) => {
			this.options.onError(error);
		});
	}
	/** Settle once every queued write has finished (test and shutdown hook). */
	flush() {
		return this.chain;
	}
	async append(rendered) {
		try {
			await mkdir(dirname(this.options.path), { recursive: true });
		} catch (error) {
			/* v8 ignore next -- mkdir fails only on hostile paths; contained by the caller's onError chain */
			if (error.code !== "EEXIST") throw error;
		}
		if (await stat(this.options.path).then((info) => info.size).catch(() => 0) >= this.options.maxBytes) await this.rotate();
		await appendFile(this.options.path, rendered + "\n", "utf8");
	}
	/** Shift `.i-1` → `.i` down to `.1`, then move the live file to `.1`. */
	async rotate() {
		for (let index = this.options.rotations; index >= 2; index -= 1) try {
			await rename(`${this.options.path}.${index - 1}`, `${this.options.path}.${index}`);
		} catch (error) {
			/* v8 ignore next -- ENOENT means no such older copy yet; any other error must surface */
			if (error.code !== "ENOENT") throw error;
		}
		try {
			await rename(this.options.path, `${this.options.path}.1`);
		} catch (error) {
			/* v8 ignore next -- the live file exists once it crossed maxBytes; only hostile paths fail here */
			if (error.code !== "ENOENT") throw error;
		}
	}
};
/**
* The session-log side of the audit: caps decision events per session and
* merges identical commands inside the dedupe TTL. The file log keeps the
* complete trail; the session log keeps only what the model context and
* projections need.
*/
var SessionAuditGate = class {
	options;
	counts = /* @__PURE__ */ new Map();
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
		const note = this.options.dedupe.note(sessionKey + "\n" + fingerprint);
		if (note.repeat) return {
			append: false,
			note
		};
		const count = (this.counts.get(sessionKey) ?? 0) + 1;
		this.counts.set(sessionKey, count);
		return {
			append: count <= this.options.maxEvents,
			note
		};
	}
};
//#endregion
//#region lib/types/git.js
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
/** Top-level verbs that select git dispatch (with or without an `.exe` suffix). */
const GIT_VERBS = new Set(["git", "git.exe"]);
/** git global options that consume a following value (skipped before the subcommand). */
const GIT_VALUE_OPTIONS = new Set([
	"-c",
	"-C",
	"--git-dir",
	"--work-tree",
	"--exec-path"
]);
/**
* Whether the first verb of the token list is a git invocation.
* @param verbs - the leading verb tokens in order (case-insensitive).
* @returns whether the list heads with `git`/`git.exe`.
*/
function isGitInvocation(verbs) {
	const head = verbs[0];
	return head !== void 0 && GIT_VERBS.has(head.toLowerCase());
}
/**
* Analyze one git invocation's subcommand semantics.
* @param tokens - the raw command tokens AFTER the leading `git` verb.
* @returns the git facts; never throws.
*/
function analyzeGit(tokens) {
	let first;
	let skipNext = false;
	for (const token of tokens) {
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (GIT_VALUE_OPTIONS.has(token)) {
			skipNext = true;
			continue;
		}
		if (token.length > 0 && !token.startsWith("-")) {
			first = token;
			break;
		}
	}
	if (first === void 0) return { destructive: false };
	const subcommand = first.toLowerCase().replace(/^['"]|['"]$/g, "");
	if (subcommand === "rm") {
		const flags = new Set(tokens.filter((token) => token.startsWith("-")).map((token) => token.toLowerCase()));
		if (flags.has("--cached") || flags.has("--staged") || flags.has("-n") || flags.has("--dry-run")) return {
			subcommand: "rm",
			destructive: false
		};
		return {
			subcommand: "rm",
			destructive: true,
			reason: "command guard: git rm without --cached removes working-tree files"
		};
	}
	if (subcommand === "clean") return {
		subcommand: "clean",
		destructive: true,
		reason: "command guard: git clean deletes untracked working-tree files"
	};
	if (subcommand === "reset") {
		if (new Set(tokens.filter((token) => token.startsWith("-")).map((token) => token.toLowerCase())).has("--hard")) return {
			subcommand: "reset",
			destructive: true,
			reason: "command guard: git reset --hard overwrites working-tree files with the repository version"
		};
		return {
			subcommand: "reset",
			destructive: false
		};
	}
	return {
		subcommand,
		destructive: false
	};
}
//#endregion
//#region lib/types/verbs.js
/**
* The destructive-command vocabulary the guard classifies: PowerShell and
* cmd-style verbs with their alias maps, the format/disk family, the recycle
* verb, and the POSIX (bash-dialect) set. Pure data plus canonicalization
* helpers — the analyzer and tier classifier both consume it.
*
* @module @deepseek-ai/dsh-careful-full-access/verbs
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
/** The recycle verb — elevated tier. */
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
* @returns whether the verb is `iex`/`Invoke-Expression`.
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
* @module @deepseek-ai/dsh-careful-full-access/lexer
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
	const firstVerbIndex = tokens.findIndex((token) => !token.startsWith("-") && !token.startsWith("/"));
	const firstVerb = firstVerbIndex >= 0 ? tokens[firstVerbIndex] : void 0;
	if (firstVerb !== void 0 && isGitInvocation([unquote(firstVerb).toLowerCase()])) {
		facts.git = analyzeGit(tokens.slice(firstVerbIndex + 1));
		return facts;
	}
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
	const firstVerbIndex = tokens.findIndex((token) => !token.startsWith("-") && !token.startsWith("/"));
	const firstVerb = firstVerbIndex >= 0 ? tokens[firstVerbIndex] : void 0;
	if (firstVerb !== void 0 && isGitInvocation([unquote(firstVerb).toLowerCase()])) {
		facts.git = analyzeGit(tokens.slice(firstVerbIndex + 1));
		return facts;
	}
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
* @returns whether the command deserves further analysis.
*/
function hasDestructiveSignal(facts) {
	return facts.families.length > 0 || facts.netDeleteCall || facts.diskpartClean || facts.robocopyMir || facts.dynamicVerb || facts.git?.destructive === true;
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
* @module @deepseek-ai/dsh-careful-full-access/analyzer
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
/**
* Encode a script for `pwsh -EncodedCommand`.
* @param script - the script text to encode.
* @returns the UTF-16LE base64 payload.
*/
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
		const executable = argv[0];
		if (executable === void 0) {
			settle({
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: false,
				spawnError: "argv is empty"
			});
			return;
		}
		try {
			child = spawn(executable, argv.slice(1), {
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
	/**
	* The `.NET` deletion member calls the caller-visible regex already found, for cross-checks.
	* @param command - the raw command text.
	* @returns whether the `.NET` delete-call pattern matches.
	*/
	static hasNetDelete(command) {
		return NET_DELETE_CALL.test(command);
	}
};
//#endregion
//#region lib/types/protected.js
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
/**
* Strip trailing separators and a trailing glob star from a target path.
* @param raw - the raw path token.
* @returns the normalized path.
*/
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
* @returns whether the form is a drive root.
*/
function isDriveRootPath(raw) {
	return DRIVE_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is a drive-root glob (`C:\*`, `C:\*.*`).
* @param raw - the raw path token.
* @returns whether the form is a drive-root glob.
*/
function isDriveRootWildcard(raw) {
	return DRIVE_ROOT_WILDCARD.test(raw.trim());
}
/**
* Whether a raw target string is an extended-length root (`\\?\C:\`).
* @param raw - the raw path token.
* @returns whether the form is an extended-length root.
*/
function isExtendedRoot(raw) {
	return EXTENDED_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is a bare drive form (`C:`) whose meaning depends
* on that drive's current directory.
* @param raw - the raw path token.
* @returns whether the form is a bare drive.
*/
function isBareDriveForm(raw) {
	return BARE_DRIVE.test(raw.trim());
}
/**
* Whether a raw target string is a UNC share root (`\\server\share\`).
* @param raw - the raw path token.
* @returns whether the form is a UNC share root.
*/
function isUncRoot(raw) {
	return UNC_ROOT.test(raw.trim());
}
/**
* Whether a raw target string is the POSIX filesystem root.
* @param raw - the raw path token.
* @returns whether the form is the POSIX root.
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
* @returns whether the target is disaster-tier.
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
* @returns whether both normalize to the same path.
*/
function targetEquals(left, right) {
	return fold(normalizeTarget(left)) === fold(normalizeTarget(right));
}
/**
* Whether `child` is `parent` itself or a strict descendant of it.
* @param parent - the normalized root.
* @param child - the normalized candidate.
* @returns whether `child` sits inside `parent`.
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
* any resolved target that IS a protected root reports `protected-hit` (the
* engine upgrades it to the disaster tier for the review).
*
* The command runs once with WhatIf on, so non-delete side effects before a
* delete cmdlet DO execute during the preview — a documented tradeoff of
* asking the shell itself for the truth.
*
* @module @deepseek-ai/dsh-careful-full-access/preview
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
/**
* Parse every `What if:` line (English or zh-CN form) from the dry-run output.
* @param stdout - the dry-run helper's stdout.
* @returns the parsed `(operation, target)` pairs in output order.
*/
function parseWhatIfLines(stdout) {
	const targets = [];
	for (const line of stdout.split(/\r?\n/)) {
		const match = WHATIF_LINE.exec(line);
		if (match !== null) {
			const op = match[1];
			const target = match[2];
			/* v8 ignore next -- both capture groups always exist for a matching line; the check only guards hostile regex drift */
			if (op === void 0 || target === void 0) continue;
			targets.push({
				op,
				target
			});
			continue;
		}
		const zhMatch = WHATIF_LINE_ZH.exec(line);
		if (zhMatch !== null) {
			const op = zhMatch[2];
			const target = zhMatch[1];
			/* v8 ignore next -- both capture groups always exist for a matching line; the check only guards hostile regex drift */
			if (op === void 0 || target === void 0) continue;
			targets.push({
				op,
				target
			});
		}
	}
	return targets;
}
/**
* Parse and validate the enumeration script's JSON output.
* @param stdout - the enumeration helper's stdout.
* @returns the enumerated subtrees, or `undefined` on unreadable output.
*/
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
/**
* Render the bounded model-facing preview summary.
* @param fileCount - resolved file count.
* @param directoryCount - resolved directory count.
* @param samples - bounded sample targets.
* @param truncated - whether the sample list was cut.
* @returns the model-facing summary text.
*/
function renderPreviewSummary(fileCount, directoryCount, samples, truncated) {
	return `command guard preview: this deletion resolves to ${fileCount + directoryCount} objects (${fileCount} files, ${directoryCount} directories)` + (samples.length > 0 ? `; first targets: ${samples.map((sample) => `"${sample}"`).join(", ")}${truncated ? ", …" : ""}` : "") + " — verify this scope matches your intent";
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
/**
* A summary line for tests and callers reusing the preview text.
* @param outcome - a settled `previewed` outcome.
* @returns the rendered summary for that outcome.
*/
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
* The tiers are mode-independent by design: which tier becomes allow,
* model-check, or model-check plus human confirmation is the engine's
* decision, not the classifier's.
*
* @module @deepseek-ai/dsh-careful-full-access/tiers
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
	if (facts.git !== void 0) {
		if (!facts.git.destructive) return {
			tier: "normal",
			reason: ""
		};
		return {
			tier: "elevated",
			reason: facts.git.reason ?? "command guard: a destructive git subcommand needs review"
		};
	}
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
		reason: "command guard: disk-level operations (format/clear/partition)"
	};
	const targets = collectTargets(report, facts);
	const protectedHit = hitsProtected(targets, context);
	const recursive = hasRecursive(report, facts);
	if (facts.robocopyMir && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: robocopy /MIR against the protected root "${protectedHit}"`
	};
	if (facts.netDeleteCall && protectedHit !== void 0 && netDeleteRecursive(rawCommand)) return {
		tier: "disaster",
		reason: `command guard: recursive .NET deletion of the protected root "${protectedHit}"`
	};
	if (facts.netDeleteCall && protectedHit !== void 0) return {
		tier: "elevated",
		reason: `command guard: .NET deletion targeting the protected root "${protectedHit}"`
	};
	const insideProtected = facts.netDeleteCall ? hitsInsideProtected(targets, context) : void 0;
	if (insideProtected !== void 0) return {
		tier: "elevated",
		reason: `command guard: .NET deletion inside the protected root (${insideProtected})`
	};
	if (families.has("delete") && recursive && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: recursive deletion of the protected root "${protectedHit}"`
	};
	if (families.has("recycle")) return {
		tier: "elevated",
		reason: "command guard: emptying the recycle bin"
	};
	if (report === void 0 || !report.ok) return {
		tier: "unparseable",
		reason: "command guard: the deletion command could not be parsed safely"
	};
	const force = hasForce(report, facts);
	const dynamic = hasDynamicTarget(report, facts);
	if (families.has("delete")) {
		if (recursive && dynamic) return {
			tier: "elevated",
			reason: "command guard: recursive deletion with dynamically resolved targets"
		};
		if (recursive && force && (facts.wildcard || findsUnbounded(targets, context) !== void 0)) return {
			tier: "elevated",
			reason: "command guard: recursive forced deletion outside the workspace"
		};
		if (recursive && targets.length === 0) return {
			tier: "elevated",
			reason: "command guard: recursive deletion with no statically visible target"
		};
		if (targets.length > 1) return {
			tier: "elevated",
			reason: `command guard: batch deletion of ${targets.length} targets`
		};
		return {
			tier: "elevated",
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
	if (facts.git !== void 0) {
		if (!facts.git.destructive) return {
			tier: "normal",
			reason: ""
		};
		return {
			tier: "elevated",
			reason: facts.git.reason ?? "command guard: a destructive git subcommand needs review"
		};
	}
	const families = new Set(facts.families);
	if (families.size === 0) return {
		tier: "normal",
		reason: ""
	};
	if (families.has("format")) return {
		tier: "disaster",
		reason: "command guard: disk-level operations (mkfs/fdisk/wipefs)"
	};
	const protectedHit = hitsProtected(facts.literalPaths, context);
	if (facts.recursive && protectedHit !== void 0) return {
		tier: "disaster",
		reason: `command guard: recursive deletion of the protected root "${protectedHit}"`
	};
	if (facts.recursive && facts.dynamic) return {
		tier: "elevated",
		reason: "command guard: recursive deletion with dynamically resolved targets"
	};
	if (facts.recursive && facts.force && (facts.wildcard || findsUnbounded(facts.literalPaths, context) !== void 0)) return {
		tier: "elevated",
		reason: "command guard: recursive forced deletion outside the workspace"
	};
	if (facts.findDelete) return {
		tier: "elevated",
		reason: "command guard: find -delete"
	};
	if (families.has("delete")) return {
		tier: "elevated",
		reason: ""
	};
	return {
		tier: "normal",
		reason: ""
	};
}
//#endregion
//#region lib/types/engine.js
/**
* The guard engine: one judge pass per shell tool call. The guard is active
* ONLY in `careful-full-access` — every other sandbox mode passes through
* untouched (workspace-write is already confined by the sandbox itself, and
* danger-full-access is the user's explicit opt-out). Inside careful mode the
* engine runs the cheap lexical scan first (the fast allow gate for the
* overwhelming majority of commands), spawns the AST analyzer only for
* destructive signals, maps the tier verdict onto the review route, and
* resolves every flagged command through the WhatIf preview (deletions) and
* the model-check three-question review — with human confirmation as the last
* layer for disaster-tier or model-declared-dangerous commands.
*
* @module @deepseek-ai/dsh-careful-full-access/engine
*/
/**
* The stateless-per-call orchestrator. All instance state lives in the
* injected runners (model-check, preview, analyzer), so one engine instance
* serves every session.
*/
var GuardEngine = class {
	options;
	constructor(options) {
		this.options = options;
	}
	/**
	* Judge one shell call.
	* @param input - the call facts.
	* @returns the careful-mode decision; every other mode allows outright.
	*/
	async judge(input) {
		if (input.mode !== "careful-full-access") return { kind: "allow" };
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
		const fast = classifyPwsh(input.command, void 0, facts, context);
		const verdict = fast.tier === "disaster" || facts.git !== void 0 ? fast : classifyPwsh(input.command, await this.options.analyzer.analyze(input.command, input.signal), facts, context);
		return this.route(input, verdict, "pwsh", facts);
	}
	async judgeBash(input, context) {
		const facts = lexBash(input.command);
		if (!hasDestructiveSignal(facts)) return { kind: "allow" };
		const verdict = classifyBash(facts, context);
		return this.route(input, verdict, "bash", facts);
	}
	/** Every flagged command runs the review route; only `normal` allows straight through. */
	async route(input, verdict, dialect, facts) {
		if (verdict.tier === "normal") return { kind: "allow" };
		return this.review(input, verdict, dialect, facts);
	}
	/** The review route: optional WhatIf scope, then the model-check three questions. */
	async review(input, verdict, dialect, facts) {
		const reviewTier = verdict.tier;
		let effectiveTier = reviewTier;
		let scopeSummary;
		let previewDetail;
		if (dialect === "pwsh" && facts.families.includes("delete")) {
			const outcome = await this.options.preview.preview(input.command, input.signal);
			switch (outcome.kind) {
				case "zero-targets": return {
					kind: "allow",
					tier: effectiveTier
				};
				case "previewed":
					scopeSummary = renderPreviewSummary(outcome.fileCount, outcome.directoryCount, outcome.samples, outcome.truncated);
					break;
				case "protected-hit":
					effectiveTier = "disaster";
					scopeSummary = `resolved to the protected root "${outcome.target}"`;
					break;
				case "unpreviewable":
					previewDetail = outcome.detail;
					break;
				/* v8 ignore next 3 -- PreviewOutcome is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
				default: throw new Error(`unreachable preview outcome: ${String(outcome)}`);
			}
		}
		const outcome = await this.options.modelCheck.check({
			command: input.command,
			tier: reviewTier,
			reason: verdict.reason,
			...scopeSummary === void 0 ? {} : { scopeSummary },
			route: input.route,
			...input.signal === void 0 ? {} : { signal: input.signal }
		});
		switch (outcome.kind) {
			case "not-intended": return {
				kind: "deny",
				tier: verdict.tier,
				modelCheck: "not-intended",
				reason: `command guard: model-check concluded this command was not the intended one: ${outcome.explanation}`
			};
			case "safe":
				if (effectiveTier === "elevated") return {
					kind: "allow",
					tier: "elevated",
					modelCheck: "safe"
				};
				return {
					kind: "ask",
					tier: effectiveTier,
					severity: "danger",
					modelCheck: "safe",
					reason: this.confirmReason(effectiveTier, verdict, "the model confirms this is the intended, expected operation", previewDetail)
				};
			case "dangerous": return {
				kind: "ask",
				tier: effectiveTier,
				...effectiveTier === "disaster" || effectiveTier === "unparseable" ? { severity: "danger" } : {},
				modelCheck: "dangerous",
				reason: this.confirmReason(effectiveTier, verdict, `the model itself declared it dangerous: ${outcome.explanation}`, previewDetail)
			};
			case "unavailable": return {
				kind: "ask",
				tier: effectiveTier,
				severity: "danger",
				modelCheck: "unavailable",
				reason: this.confirmReason(effectiveTier === "elevated" ? "unparseable" : effectiveTier, verdict, `model-check unavailable: ${outcome.detail}`, previewDetail)
			};
			/* v8 ignore next 3 -- ModelCheckOutcome is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
			default: throw new Error(`unreachable model-check outcome: ${String(outcome)}`);
		}
	}
	/** Assemble the human-confirmation request body: tier heading, finding, conclusion, preview note. */
	confirmReason(tier, verdict, conclusion, previewDetail) {
		let heading;
		switch (tier) {
			case "disaster":
				heading = "DISASTER tier";
				break;
			case "unparseable":
				heading = "unparseable (treated as disaster)";
				break;
			case "elevated":
				heading = "elevated tier";
				break;
			/* v8 ignore next 3 -- the review tiers are a closed union; this branch is only the static exhaustiveness guard. */
			default: throw new Error(`unreachable review tier: ${String(tier)}`);
		}
		const base = `command guard: ${heading} — ${verdict.reason} — ${conclusion}`;
		return previewDetail === void 0 ? base : `${base}; the command could not be dry-run previewed (${previewDetail})`;
	}
};
//#endregion
//#region lib/types/fingerprint.js
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
function fingerprintCommand(command) {
	return command.trim().replace(/\s+/g, " ");
}
/**
* Sliding-window dedupe memory: fingerprint → last-seen timestamp. Entries are
* pruned lazily on every read and write; a note inside the TTL window extends
* the count, and a note after expiry starts a fresh window.
*/
var DedupeWindow = class {
	ttlMs;
	entries = /* @__PURE__ */ new Map();
	/** @param ttlMs - how long an identical command merges into one entry. */
	constructor(ttlMs) {
		this.ttlMs = ttlMs;
	}
	/**
	* Note one fingerprint.
	* @param fingerprint - the normalized command fingerprint.
	* @returns whether this note repeats an earlier one, and the merged count.
	*/
	note(fingerprint) {
		this.prune();
		const now = Date.now();
		const existing = this.entries.get(fingerprint);
		if (existing !== void 0) {
			existing.expiresAt = now + this.ttlMs;
			existing.count += 1;
			return {
				count: existing.count,
				repeat: true
			};
		}
		this.entries.set(fingerprint, {
			expiresAt: now + this.ttlMs,
			count: 1
		});
		return {
			count: 1,
			repeat: false
		};
	}
	/** Drop every expired entry. */
	prune() {
		const now = Date.now();
		for (const [fingerprint, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(fingerprint);
	}
};
//#endregion
//#region lib/types/model-check.js
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
const SYSTEM_PROMPT = "You are the command-review step of a deletion guard inside a coding-agent harness. A flagged shell command is shown with its risk tier and the reason it was flagged. Answer whether the command is what its author intended and whether it is safe, STRICTLY as one JSON object with exactly these fields: {\"intent\":\"yes\"|\"no\",\"assessment\":\"safe\"|\"dangerous\",\"explanation\":\"one short sentence\"}. \"intent\":\"no\" means the command is NOT what was meant (likely misparsed or miswritten). \"assessment\":\"dangerous\" means the command is genuinely risky or exceeds its expected scope. Output the JSON object only — no prose, no code fences.";
/** Human label for each tier as presented to the reviewing model. */
function tierLabel(tier) {
	switch (tier) {
		case "elevated": return "elevated (dangerous verb)";
		case "disaster": return "DISASTER (protected root or disk-level operation)";
		case "unparseable": return "unparseable (cannot be statically analyzed; treated as disaster)";
	}
}
/** Build the one-shot user message the reviewing model answers. */
function buildUserText(input) {
	const lines = [
		"Review this shell command before it executes.",
		"",
		"Command:",
		"```",
		input.command,
		"```",
		"",
		`Static tier: ${tierLabel(input.tier)}`,
		`Flagged because: ${input.reason}`
	];
	if (input.scopeSummary !== void 0 && input.scopeSummary.length > 0) lines.push("", "Resolved scope (WhatIf dry run):", input.scopeSummary);
	lines.push("", "Answer these three questions:", "1. Intent: is this command what you originally meant to run?", "2. If yes: is it safe and within the expected scope?", "3. If yes but genuinely dangerous or out of scope: say so explicitly.");
	return lines.join("\n");
}
/**
* Extract and validate the strict JSON answer from the model's reply.
* @param text - the raw reply text from the review call.
* @returns the validated answer, or `undefined` when nothing parses.
*/
function parseModelAnswer(text) {
	const trimmed = text.trim();
	const candidates = [trimmed];
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced?.[1] !== void 0) candidates.push(fenced[1]);
	const brace = trimmed.match(/\{[\s\S]*\}/);
	if (brace !== null) candidates.push(brace[0]);
	for (const candidate of candidates) try {
		const parsed = JSON.parse(candidate);
		if ((parsed.intent === "yes" || parsed.intent === "no") && (parsed.assessment === "safe" || parsed.assessment === "dangerous") && typeof parsed.explanation === "string" && parsed.explanation.length > 0) return {
			intent: parsed.intent,
			assessment: parsed.assessment,
			explanation: parsed.explanation
		};
	} catch {}
}
/**
* Run one review.
* @param input - the flagged command and its route.
* @returns the settled outcome; failures settle `unavailable`.
*/
var ModelCheckRunner = class {
	options;
	constructor(options) {
		this.options = options;
	}
	/**
	* Run one review.
	* @param input - the flagged command and its route.
	* @returns the settled outcome; failures settle `unavailable`.
	*/
	async check(input) {
		if (this.options.completer === void 0 || input.route === void 0) return {
			kind: "unavailable",
			detail: "no model route available for the model-check call"
		};
		const controller = new AbortController();
		const timedOut = () => controller.signal.aborted && input.signal?.aborted !== true;
		const onOuterAbort = () => {
			controller.abort();
		};
		input.signal?.addEventListener("abort", onOuterAbort, { once: true });
		const timer = setTimeout(() => {
			controller.abort();
		}, this.options.timeoutMs);
		try {
			const messages = [createUserMessage({
				content: [{
					type: "text",
					text: buildUserText(input)
				}],
				source: {
					kind: "plugin",
					plugin: "command-guard"
				}
			})];
			const stream = this.options.completer.stream({
				provider: input.route.provider,
				model: input.route.model,
				messages,
				system: SYSTEM_PROMPT,
				temperature: 0,
				maxTokens: this.options.maxTokens,
				signal: controller.signal
			});
			let text = "";
			for await (const chunk of stream) if (chunk.type === "text-delta") text += chunk.text;
			else if (chunk.type === "finish") {
				if (chunk.reason.kind === "stop") continue;
				if (chunk.reason.kind === "aborted") return timedOut() ? {
					kind: "unavailable",
					detail: "the model-check call timed out"
				} : {
					kind: "unavailable",
					detail: "the model-check call was aborted"
				};
				if (chunk.reason.kind === "error") return {
					kind: "unavailable",
					detail: `the model-check call failed: ${chunk.reason.failure.message}`
				};
				return {
					kind: "unavailable",
					detail: `the model-check call ended abnormally (${chunk.reason.kind})`
				};
			}
			if (controller.signal.aborted) return timedOut() ? {
				kind: "unavailable",
				detail: "the model-check call timed out"
			} : {
				kind: "unavailable",
				detail: "the model-check call was aborted"
			};
			const answer = parseModelAnswer(text);
			if (answer === void 0) return {
				kind: "unavailable",
				detail: "the model-check answer could not be parsed"
			};
			if (answer.intent === "no") return {
				kind: "not-intended",
				explanation: answer.explanation
			};
			if (answer.assessment === "dangerous") return {
				kind: "dangerous",
				explanation: answer.explanation
			};
			return { kind: "safe" };
		} catch (error) {
			if (controller.signal.aborted) return timedOut() ? {
				kind: "unavailable",
				detail: "the model-check call timed out"
			} : {
				kind: "unavailable",
				detail: "the model-check call was aborted"
			};
			return {
				kind: "unavailable",
				detail: `the model-check call threw: ${error instanceof Error ? error.message : String(error)}`
			};
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", onOuterAbort);
		}
	}
};
//#endregion
//#region lib/types/index.js
/**
* The command-guard plugin: a host-plane `tools/pre-execute` listener that is
* ACTIVE ONLY in `careful-full-access`. Every other sandbox mode passes
* through untouched — workspace-write is already confined by the sandbox
* itself and danger-full-access is the user's explicit opt-out. Inside
* careful mode every flagged command runs the model-check three-question
* review (intent, safety, scope), disaster-tier or model-declared-dangerous
* commands additionally require human confirmation (red-marked in the
* approval panel, fail-closed under the `never` policy), and every non-allow
* decision is audited twice: the complete trail goes to the rotated file log
* `$DSH_HOME/logs/command-guard.log`, while the session log keeps only a
* bounded, deduplicated window of decision events.
*
* @module @deepseek-ai/dsh-careful-full-access
*/
/** The model-facing deletion-discipline section. */
const PROMPT = "Deletion discipline (enforced by the command guard, active only in careful-full-access mode): prefer a -WhatIf dry run or an explicit listing before deleting; never recurse into drive roots, the user profile, or system directories; treat undefined $env: variables as errors, not empty strings. In careful-full-access mode every flagged deletion is reviewed by a model-check (intent, safety, and scope questions) before it runs; disaster-tier targets additionally require human confirmation.";
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
/** Default dedupe window for identical commands. */
const DEFAULT_DEDUPE_TTL_MS = 6e5;
/** Default kill deadline for the model-check call. */
const DEFAULT_MODEL_CHECK_TIMEOUT_MS = 2e4;
/** Default output budget for the model-check call. */
const DEFAULT_MODEL_CHECK_MAX_TOKENS = 300;
/** Default audit rotation size (5 MB). */
const DEFAULT_AUDIT_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** Default rotated audit copies. */
const DEFAULT_AUDIT_LOG_ROTATIONS = 3;
/** Default per-session decision-event cap. */
const DEFAULT_SESSION_DECISION_CAP = 20;
const Config = z.object({
	extraProtectedPaths: z.array(z.string()).default([]),
	dedupeTtlMs: z.number().default(DEFAULT_DEDUPE_TTL_MS),
	analyzeTimeoutMs: z.number().default(DEFAULT_ANALYZE_TIMEOUT_MS),
	previewTimeoutMs: z.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
	previewSampleLimit: z.number().default(10),
	modelCheckTimeoutMs: z.number().default(DEFAULT_MODEL_CHECK_TIMEOUT_MS),
	modelCheckMaxTokens: z.number().default(300),
	auditLogPath: z.string().default(""),
	auditLogMaxBytes: z.number().default(DEFAULT_AUDIT_LOG_MAX_BYTES),
	auditLogRotations: z.number().default(3),
	sessionDecisionCap: z.number().default(20),
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
/** Resolve the session's current provider/model route for the model-check call. */
function resolveRoute(agent) {
	/* v8 ignore next -- agentless executions return at the policy gate before any route resolution */
	if (agent === void 0) return void 0;
	const header = agent.session.requestHeader?.();
	const provider = header?.config.provider ?? agent.options?.provider;
	const model = header?.config.model ?? agent.options?.model;
	if (provider === void 0 || model === void 0) return void 0;
	return {
		provider,
		model
	};
}
/**
* Register the pre-execute listener, the audit sinks, and the prompt section.
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
		modelCheck: new ModelCheckRunner({
			completer: ctx.get("llm"),
			timeoutMs: config.modelCheckTimeoutMs ?? 2e4,
			maxTokens: config.modelCheckMaxTokens ?? 300
		})
	});
	const sandboxPolicy = ctx.get("sandboxPolicy");
	/* v8 ignore next -- the audit onError fires only on filesystem failures no test can force; the chain still routes real errors to it */
	const auditWarn = (error) => {
		ctx.logger.warn(`command-guard: audit file write failed: ${error instanceof Error ? error.message : String(error)}`);
	};
	const auditLogger = new AuditLogger({
		path: config.auditLogPath === "" || config.auditLogPath === void 0 ? join(resolveDshHome(), "logs", "command-guard.log") : config.auditLogPath,
		maxBytes: config.auditLogMaxBytes ?? 5242880,
		rotations: config.auditLogRotations ?? 3,
		onError: auditWarn
	});
	const gate = new SessionAuditGate({
		maxEvents: config.sessionDecisionCap ?? 20,
		dedupe: new DedupeWindow(config.dedupeTtlMs ?? 6e5)
	});
	ctx.on("tools/pre-execute", async (exec, next) => {
		if (exec.name !== "pwsh" && exec.name !== "bash") return next();
		const command = extractCommand(exec.arguments);
		if (command === void 0) return next();
		const session = exec.agent?.session;
		const policy = sandboxPolicy === void 0 || session === void 0 ? void 0 : sandboxPolicy.resolve({ session });
		if (policy?.mode !== "careful-full-access") return next();
		const decision = await engine.judge({
			dialect: exec.name === "pwsh" ? "pwsh" : "bash",
			command,
			mode: policy.mode,
			workspaceRoot: policy.workspaceRoot,
			signal: exec.signal,
			/* v8 ignore next -- the careful-mode gate above guarantees a session is present here */
			sessionKey: session === void 0 ? "" : String(session.id),
			route: resolveRoute(exec.agent)
		});
		/* v8 ignore next -- the careful-mode gate above guarantees a session is present here */
		const sessionKey = session === void 0 ? "" : String(session.id);
		const fingerprint = fingerprintCommand(command);
		const gated = gate.shouldAppend(sessionKey, fingerprint);
		if (gated.note.repeat) auditLogger.write({
			event: "repeat",
			fingerprint,
			count: gated.note.count
		});
		else auditLogger.write({
			ts: (/* @__PURE__ */ new Date()).toISOString(),
			/* v8 ignore next -- the careful-mode gate above guarantees a session is present here */
			...session === void 0 ? {} : { sessionId: sessionKey },
			toolName: exec.name,
			decision: decision.kind,
			...decision.tier === void 0 ? {} : { tier: decision.tier },
			/* v8 ignore next -- the careful-mode gate above guarantees the resolved policy carries a mode */
			...policy.mode !== void 0 ? { mode: policy.mode } : {},
			...decision.modelCheck === void 0 ? {} : { modelCheck: decision.modelCheck },
			fingerprint,
			count: gated.note.count
		});
		if (session !== void 0 && gated.append) try {
			session.append("command-guard/decision", {
				toolName: exec.name,
				decision: decision.kind,
				...decision.tier === void 0 ? {} : { tier: decision.tier },
				/* v8 ignore next -- the careful-mode gate above guarantees the resolved policy carries a mode */
				...policy.mode !== void 0 ? { mode: policy.mode } : {},
				...decision.kind === "deny" || decision.kind === "ask" ? { reason: decision.reason } : {},
				...decision.modelCheck === void 0 ? {} : { modelCheck: decision.modelCheck },
				/* v8 ignore next -- the registry always stamps callId on executions */
				...exec.callId !== void 0 ? { callId: exec.callId } : {}
			});
		} catch (error) {
			ctx.logger.warn(`command-guard: session audit append failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		switch (decision.kind) {
			case "allow": return next();
			case "deny": return {
				kind: "deny",
				reason: decision.reason
			};
			case "ask": return {
				kind: "ask",
				reason: decision.reason,
				...decision.severity === void 0 ? {} : { severity: decision.severity }
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
export { AuditLogger, Config, DEFAULT_ANALYZE_TIMEOUT_MS, DEFAULT_AUDIT_LOG_MAX_BYTES, DEFAULT_AUDIT_LOG_ROTATIONS, DEFAULT_DEDUPE_TTL_MS, DEFAULT_MODEL_CHECK_MAX_TOKENS, DEFAULT_MODEL_CHECK_TIMEOUT_MS, DEFAULT_PREVIEW_SAMPLE_LIMIT, DEFAULT_PREVIEW_TIMEOUT_MS, DEFAULT_SESSION_DECISION_CAP, DedupeWindow, GuardEngine, ModelCheckRunner, PreviewRunner, PwshAnalyzer, SessionAuditGate, analyzeGit, apply, bashVerbFamily, buildProtectedRoots, classifyBash, classifyPwsh, encodeCommand, fingerprintCommand, hasDestructiveSignal, inject, isBareDriveForm, isDriveRootPath, isDriveRootWildcard, isExtendedRoot, isGitInvocation, isInside, isPosixRoot, isProtectedTarget, isPwshDynamicVerb, isUncRoot, lexBash, lexPwsh, name, nodeSpawner, normalizeTarget, parseEnumeration, parseModelAnswer, parsePwshReport, parseWhatIfLines, previewDenyReason, pwshVerbFamily, renderPreviewSummary };
