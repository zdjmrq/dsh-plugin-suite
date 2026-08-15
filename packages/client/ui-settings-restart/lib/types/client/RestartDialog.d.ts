import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RestartUiStore } from './restart-store.ts';
/** Registrant-owned dependencies of the action dialog. */
export interface RestartDialogInjected {
    /** Request the Host restart; resolves failure text or Host status detail. */
    restart: () => Promise<{
        ok: boolean;
        text: string;
    }>;
    /** Refresh the frontend page, keeping hot plugins; resolves success. */
    refresh: () => Promise<{
        ok: boolean;
        text: string;
    }>;
    /** Shared dialog state. */
    store: RestartUiStore;
}
/** Full overlay props. */
export type RestartDialogProps = PropsRuntime<'shell.overlay'> & PropsLocale<'settings.restart'> & InjectFace<RestartDialogInjected>;
/**
 * Render the action confirmation dialog, or null while closed.
 * @param props - composed overlay props.
 * @returns the dialog overlay, or null.
 */
export declare function RestartDialog({ restart, refresh, store, t }: RestartDialogProps): import("react").ReactPortal | null;
//# sourceMappingURL=RestartDialog.d.ts.map