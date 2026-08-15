import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './RestartRow.module.css';
/** Per-action copy keys. */
const COPY = {
    restart: { title: 'row.title', description: 'row.description', action: 'row.action' },
    refresh: { title: 'row.refreshTitle', description: 'row.refreshDescription', action: 'row.refreshAction' },
};
/**
 * Render one action row (backend restart / frontend refresh).
 * @param props - composed Settings slot props.
 * @returns the action row.
 */
export function RestartRow({ kind, openConfirm, t }) {
    const copy = COPY[kind];
    return (_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t(copy.title) }), _jsx("div", { className: css.desc, children: t(copy.description) })] }), _jsx("button", { type: "button", className: css.action, onClick: () => { openConfirm(kind); }, children: t(copy.action) })] }));
}
//# sourceMappingURL=RestartRow.js.map