/** Shared dialog state between the settings rows and the overlay dialog. */
/** Create one store per client apply so teardown owns all its listeners. */
export function createRestartUiStore() {
    let state = { open: false, kind: 'restart', phase: 'confirm', error: null, detail: null };
    const listeners = new Set();
    const set = (next) => {
        state = next;
        for (const listener of listeners)
            listener();
    };
    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        openConfirm: (kind) => { set({ open: true, kind, phase: 'confirm', error: null, detail: null }); },
        beginRestart: () => { set({ open: true, kind: 'restart', phase: 'restarting', error: null, detail: null }); },
        fail: (message) => { set({ open: true, kind: 'restart', phase: 'error', error: message, detail: null }); },
        restarting: (detail) => { set({ open: true, kind: 'restart', phase: 'restarting', error: null, detail }); },
        close: () => { set({ open: false, kind: 'restart', phase: 'confirm', error: null, detail: null }); },
    };
}
//# sourceMappingURL=restart-store.js.map