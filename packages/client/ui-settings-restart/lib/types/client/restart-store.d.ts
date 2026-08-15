/** Shared dialog state between the settings rows and the overlay dialog. */
/** Which backend/frontend action the dialog confirms. */
export type RestartDialogKind = 'restart' | 'refresh';
/** Current dialog phase. */
export type RestartDialogPhase = 'confirm' | 'restarting' | 'error';
/** Snapshot of the action dialog. */
export interface RestartDialogState {
    /** Whether the dialog is visible. */
    open: boolean;
    /** The action being confirmed. */
    kind: RestartDialogKind;
    /** Current dialog phase. */
    phase: RestartDialogPhase;
    /** Failure detail for the error phase. */
    error: string | null;
    /** Host status detail shown under the restarting phase. */
    detail: string | null;
}
/** Tiny observable store owned by one client apply. */
export interface RestartUiStore {
    /** Read the current snapshot. */
    getState: () => RestartDialogState;
    /** Subscribe to snapshot changes; returns the unsubscriber. */
    subscribe: (listener: () => void) => () => void;
    /** Open the confirm phase for one action. */
    openConfirm: (kind: RestartDialogKind) => void;
    /** Switch to the restarting phase. */
    beginRestart: () => void;
    /** Switch to the error phase with a failure detail. */
    fail: (message: string) => void;
    /** Keep the restarting phase and attach a Host status detail. */
    restarting: (detail: string) => void;
    /** Close and reset the dialog. */
    close: () => void;
}
/** Create one store per client apply so teardown owns all its listeners. */
export declare function createRestartUiStore(): RestartUiStore;
//# sourceMappingURL=restart-store.d.ts.map