/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-restart/invariant */
const PACKAGE_NAME = '@deepseek-ai/dsh-host-restart';
/** Cordis companion plugin name. */
export const name = 'host-restart-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: the restart Remote emits no cordis events. */
const install = () => { };
/** Register this package's invariant companion. */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map