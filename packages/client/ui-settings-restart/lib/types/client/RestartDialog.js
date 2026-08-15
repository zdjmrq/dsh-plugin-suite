import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** Frame-wide confirm/cancel dialog for the backend/frontend actions, portaled to body so it stays topmost. */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import css from './RestartDialog.module.css';
/** Per-action confirm copy. */
const COPY = {
    restart: { title: 'dialog.title', body: 'dialog.body', confirm: 'dialog.confirm' },
    refresh: { title: 'dialog.refreshTitle', body: 'dialog.refreshBody', confirm: 'dialog.refreshConfirm' },
};
/** Subscribe one component to the shared store. */
function useDialogState(store) {
    const [state, setState] = useState(store.getState);
    useEffect(() => store.subscribe(() => { setState(store.getState()); }), [store]);
    return state;
}
/**
 * Render the action confirmation dialog, or null while closed.
 * @param props - composed overlay props.
 * @returns the dialog overlay, or null.
 */
export function RestartDialog({ restart, refresh, store, t }) {
    const state = useDialogState(store);
    const [busy, setBusy] = useState(false);
    if (!state.open)
        return null;
    const confirm = () => {
        if (busy)
            return;
        if (state.kind === 'refresh') {
            setBusy(true);
            void refresh();
            return;
        }
        setBusy(true);
        store.beginRestart();
        void restart().then(({ ok, text }) => {
            setBusy(false);
            if (ok)
                store.restarting(text);
            else
                store.fail(text);
        });
    };
    const closeable = state.phase === 'confirm' && !busy;
    return createPortal(_jsx("div", { className: css.backdrop, onClick: () => { if (closeable)
            store.close(); }, children: _jsx("div", { className: css.card, role: "dialog", "aria-modal": "true", "aria-label": t(COPY[state.kind].title), onClick: (event) => { event.stopPropagation(); }, children: state.phase === 'restarting' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: css.title, children: t('dialog.restartingTitle') }), _jsx("div", { className: css.body, children: t('dialog.restartingBody') }), state.detail === null ? null : _jsx("div", { className: css.detail, children: state.detail })] })) : state.phase === 'error' ? (_jsxs(_Fragment, { children: [_jsx("div", { className: css.title, children: t('dialog.errorTitle') }), _jsx("div", { className: css.body, children: state.error ?? '' }), _jsx("div", { className: css.actions, children: _jsx("button", { type: "button", className: css.cancel, onClick: () => { store.close(); }, children: t('dialog.close') }) })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: css.title, children: t(COPY[state.kind].title) }), _jsx("div", { className: css.body, children: t(COPY[state.kind].body) }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", className: css.cancel, onClick: () => { store.close(); }, children: t('dialog.cancel') }), _jsx("button", { type: "button", className: css.confirm, onClick: confirm, children: t(COPY[state.kind].confirm) })] })] })) }) }), document.body);
}
//# sourceMappingURL=RestartDialog.js.map