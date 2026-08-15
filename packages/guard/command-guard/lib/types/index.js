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
import z from '@deepseek-ai/schemastery';
import { GuardEngine } from "./engine.js";
import { PwshAnalyzer, nodeSpawner } from "./analyzer.js";
import { PreviewRunner } from "./preview.js";
import { buildProtectedRoots } from "./protected.js";
/** The model-facing deletion-discipline section. */
const PROMPT = 'Deletion discipline (enforced by the command guard): prefer a -WhatIf dry run or an explicit listing before deleting; never recurse into drive roots, the user profile, or system directories; treat undefined $env: variables as errors, not empty strings; in careful-full-access mode a deletion first returns a preview of its resolved scope — verify it matches your intent, then re-send the identical command to confirm execution.';
/** Cordis plugin name used by loader diagnostics. */
export const name = 'command-guard';
/** The tool registry whose pre-execute waterfall this plugin listens on. */
export const inject = ['tools'];
/** Default kill deadline for the AST analysis spawn. */
export const DEFAULT_ANALYZE_TIMEOUT_MS = 15_000;
/** Default kill deadline for each preview/enumeration spawn. */
export const DEFAULT_PREVIEW_TIMEOUT_MS = 15_000;
/** Default sample-path cap in preview summaries. */
export const DEFAULT_PREVIEW_SAMPLE_LIMIT = 10;
/** Default confirmation window for an unconfirmed preview. */
export const DEFAULT_CONFIRM_TTL_MS = 120_000;
export const Config = z.object({
    extraProtectedPaths: z.array(z.string()).default([]),
    confirmTtlMs: z.number().default(DEFAULT_CONFIRM_TTL_MS),
    analyzeTimeoutMs: z.number().default(DEFAULT_ANALYZE_TIMEOUT_MS),
    previewTimeoutMs: z.number().default(DEFAULT_PREVIEW_TIMEOUT_MS),
    previewSampleLimit: z.number().default(DEFAULT_PREVIEW_SAMPLE_LIMIT),
    pwshPath: z.string().default('pwsh'),
    enablePrompt: z.boolean().default(true),
});
/** Extract the command string from parsed shell-tool arguments. */
function extractCommand(arguments_) {
    /* v8 ignore next -- the tool registry validates arguments as an object; this guard only covers hostile typed-boundary input */
    if (typeof arguments_ !== 'object' || arguments_ === null)
        return undefined;
    const command = arguments_['command'];
    return typeof command === 'string' && command.trim().length > 0 ? command : undefined;
}
/**
 * Register the pre-execute listener, the audit append, and the prompt section.
 * @param ctx - the host context the row mounts under.
 * @param config - the validated plugin config.
 */
export function apply(ctx, config) {
    const protectedRoots = buildProtectedRoots(config.extraProtectedPaths ?? [], process.env);
    const analyzer = new PwshAnalyzer(nodeSpawner, {
        timeoutMs: config.analyzeTimeoutMs ?? DEFAULT_ANALYZE_TIMEOUT_MS,
        pwshPath: config.pwshPath ?? 'pwsh',
    });
    const preview = new PreviewRunner(nodeSpawner, {
        timeoutMs: config.previewTimeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS,
        sampleLimit: config.previewSampleLimit ?? DEFAULT_PREVIEW_SAMPLE_LIMIT,
        pwshPath: config.pwshPath ?? 'pwsh',
    }, protectedRoots);
    const engine = new GuardEngine({ analyzer, preview, protectedRoots, confirmTtlMs: config.confirmTtlMs ?? DEFAULT_CONFIRM_TTL_MS });
    const sandboxPolicy = ctx.get('sandboxPolicy');
    ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec.name !== 'pwsh' && exec.name !== 'bash')
            return next();
        const command = extractCommand(exec.arguments);
        if (command === undefined)
            return next();
        const session = exec.agent?.session;
        const policy = sandboxPolicy === undefined || session === undefined
            ? undefined
            : sandboxPolicy.resolve({ session });
        const decision = await engine.judge({
            dialect: exec.name === 'pwsh' ? 'pwsh' : 'bash',
            command,
            mode: policy?.mode,
            workspaceRoot: policy?.workspaceRoot,
            signal: exec.signal,
            sessionKey: session === undefined ? '' : String(session.id),
        });
        if (session !== undefined && decision.kind !== 'allow') {
            try {
                session.append('command-guard/decision', {
                    toolName: exec.name,
                    decision: decision.kind,
                    ...policy?.mode !== undefined ? { mode: policy.mode } : {},
                    /* v8 ignore next -- audit appends only for non-allow decisions, so the false side is unreachable */
                    ...decision.kind === 'deny' || decision.kind === 'ask' ? { reason: decision.reason } : {},
                    /* v8 ignore next -- the registry always stamps callId on executions */
                    ...exec.callId !== undefined ? { callId: exec.callId } : {},
                });
            }
            catch (error) {
                // The decision already stands and the pipeline enforces it; a failed
                // audit append only loses the trail, so it must not flip the outcome.
                ctx.logger.warn(`command-guard: audit append failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        switch (decision.kind) {
            case 'allow': return next();
            case 'deny': return { kind: 'deny', reason: decision.reason };
            case 'ask': return { kind: 'ask', reason: decision.reason };
        }
    });
    if (config.enablePrompt) {
        ctx.inject(['systemPrompt'], (scope) => {
            scope.systemPrompt.context({
                name: 'command-guard:deletion-discipline',
                order: 112,
                text: () => PROMPT,
            });
        });
    }
}
export { GuardEngine } from "./engine.js";
export { PendingConfirmations, fingerprintCommand } from "./fingerprint.js";
export { PwshAnalyzer, encodeCommand, nodeSpawner, parsePwshReport } from "./analyzer.js";
export { PreviewRunner, parseEnumeration, parseWhatIfLines, previewDenyReason, renderPreviewSummary } from "./preview.js";
export { classifyBash, classifyPwsh } from "./tiers.js";
export { hasDestructiveSignal, lexBash, lexPwsh } from "./lexer.js";
export { buildProtectedRoots, isBareDriveForm, isDriveRootPath, isDriveRootWildcard, isExtendedRoot, isInside, isPosixRoot, isProtectedTarget, isUncRoot, normalizeTarget, } from "./protected.js";
export { bashVerbFamily, isPwshDynamicVerb, pwshVerbFamily } from "./verbs.js";
//# sourceMappingURL=index.js.map