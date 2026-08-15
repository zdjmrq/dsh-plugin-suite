/**
 * Browser half of the backend-restart plugin: the General-settings rows
 * (backend restart + frontend refresh) and their shared confirm/cancel
 * dialog, backed by the restart Host Remote.
 * @module @deepseek-ai/dsh-client-ui-settings-restart/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type RestartKey } from './locales.ts';
export type { RestartDialogInjected, RestartDialogProps } from './RestartDialog.tsx';
export type { RestartRowInjected, RestartRowProps } from './RestartRow.tsx';
export type { RestartDialogKind, RestartDialogPhase, RestartDialogState, RestartUiStore } from './restart-store.ts';
export type { RestartKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Backend-restart / frontend-refresh settings copy. */
        'settings.restart': RestartKey;
    }
}
/**
 * sessionStorage flag arming the one-shot re-attach of active dynamic
 * (creation-mode) Plugins after a frontend-only refresh. The value is
 * consumed by ui-cordis' inventory subscription on the next page load.
 */
export declare const REATTACH_FLAG = "dsh:reattach-cordis-runs";
/** Services required by the settings registrations and the generated Remote face. */
export declare const inject: string[];
/**
 * Mount the action rows and their dialog.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map