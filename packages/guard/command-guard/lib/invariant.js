//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@deepseek-ai/dsh-command-guard`.
* @module @deepseek-ai/dsh-command-guard/invariant
*/
const PACKAGE_NAME = "@deepseek-ai/dsh-command-guard";
/** Cordis companion plugin name. */
const name = "command-guard-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: this plugin owns no package-local mutable relation.
* Its only durable writes are log-only `command-guard/decision` audit events,
* whose vocabulary and pairing are enforced structurally at the typed
* `Session.append` boundary, not by runtime state the invariant host could
* cross-check.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
