/**
 * Browser half of the backend-restart plugin: the General-settings rows
 * (backend restart + frontend refresh) and their shared confirm/cancel
 * dialog, backed by the restart Host Remote.
 * @module @deepseek-ai/dsh-client-ui-settings-restart/client
 */
import { RestartDialog } from "./RestartDialog.js";
import { RestartRow } from "./RestartRow.js";
import { createRestartUiStore } from "./restart-store.js";
import { en, zh } from "./locales.js";
/**
 * sessionStorage flag arming the one-shot re-attach of active dynamic
 * (creation-mode) Plugins after a frontend-only refresh. The value is
 * consumed by ui-cordis' inventory subscription on the next page load.
 */
export const REATTACH_FLAG = 'dsh:reattach-cordis-runs';
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.restart';
/** Services required by the settings registrations and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.restart'];
/**
 * Mount the action rows and their dialog.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-restart: dictionaries');
    const store = createRestartUiStore();
    // A reconnect means the backend already restarted: reset the dialog.
    ctx.on('connection/reset', () => { store.close(); });
    const armReattachFlag = () => {
        try {
            sessionStorage.setItem(REATTACH_FLAG, '1');
        }
        catch {
            // Storage refusal must not block the refresh itself.
        }
    };
    // F5 and Ctrl+R keep the "refresh frontend" behavior: arm the one-shot
    // re-attach flag, then force the reload from the page itself. preventDefault
    // + location.reload() makes the refresh work even where the browser's own
    // F5 default action is suppressed (desktop shells, embedded views), while
    // Ctrl+Shift+R (cache-bypassing force reload) is deliberately left native.
    ctx.effect(() => {
        const onKeyDown = (event) => {
            const isPlainF5 = event.key === 'F5'
                && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
            const isPlainCtrlR = event.key.toLowerCase() === 'r'
                && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
            if (!isPlainF5 && !isPlainCtrlR)
                return;
            armReattachFlag();
            event.preventDefault();
            window.location.reload();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); };
    }, 'ui-settings-restart: refresh-shortcut reattach arm');
    const runRestart = async () => {
        const result = await ctx.remote.restart.restart();
        if (!result.ok)
            return { ok: false, text: result.error.message };
        if (!result.value.ok)
            return { ok: false, text: result.value.message };
        // Best effort: browsers only close script-opened windows; a blocked
        // close is fine because the page disconnects on its own right after.
        try {
            window.close();
        }
        catch {
            // Nothing to do.
        }
        return { ok: true, text: result.value.message };
    };
    const runRefresh = async () => {
        armReattachFlag();
        window.location.reload();
        return { ok: true, text: '' };
    };
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'restart-backend',
        order: 30,
        locale: NS,
        inject: () => ({
            kind: 'restart',
            openConfirm: (kind) => { store.openConfirm(kind); },
        }),
    }, RestartRow));
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'refresh-frontend',
        order: 40,
        locale: NS,
        inject: () => ({
            kind: 'refresh',
            openConfirm: (kind) => { store.openConfirm(kind); },
        }),
    }, RestartRow));
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'restart-backend-dialog',
        order: 0,
        locale: NS,
        inject: () => ({
            restart: runRestart,
            refresh: runRefresh,
            store,
        }),
    }, RestartDialog));
}
//# sourceMappingURL=index.js.map