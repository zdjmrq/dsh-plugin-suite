/** General Settings row for one backend/frontend action. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { RestartDialogKind } from './restart-store.ts';
/** Registrant-owned dependencies of an action row. */
export interface RestartRowInjected {
    /** Which action this row confirms. */
    kind: RestartDialogKind;
    /** Open the confirm/cancel dialog for this row's action. */
    openConfirm: (kind: RestartDialogKind) => void;
}
/** Full Settings-row props. */
export type RestartRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings.restart'> & InjectFace<RestartRowInjected>;
/**
 * Render one action row (backend restart / frontend refresh).
 * @param props - composed Settings slot props.
 * @returns the action row.
 */
export declare function RestartRow({ kind, openConfirm, t }: RestartRowProps): import("react").JSX.Element;
//# sourceMappingURL=RestartRow.d.ts.map