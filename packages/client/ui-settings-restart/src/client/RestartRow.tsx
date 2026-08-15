/** General Settings row for one backend/frontend action. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RestartDialogKind } from './restart-store.ts'
import type { RestartKey } from './locales.ts'
import css from './RestartRow.module.css'

/** Registrant-owned dependencies of an action row. */
export interface RestartRowInjected {
  /** Which action this row confirms. */
  kind: RestartDialogKind
  /** Open the confirm/cancel dialog for this row's action. */
  openConfirm: (kind: RestartDialogKind) => void
}

/** Full Settings-row props. */
export type RestartRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.restart'>
  & InjectFace<RestartRowInjected>

/** Per-action copy keys. */
const COPY: Record<RestartDialogKind, { title: RestartKey; description: RestartKey; action: RestartKey }> = {
  restart: { title: 'row.title', description: 'row.description', action: 'row.action' },
  refresh: { title: 'row.refreshTitle', description: 'row.refreshDescription', action: 'row.refreshAction' },
}

/**
 * Render one action row (backend restart / frontend refresh).
 * @param props - composed Settings slot props.
 * @returns the action row.
 */
export function RestartRow({ kind, openConfirm, t }: RestartRowProps) {
  const copy = COPY[kind]
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(copy.title)}</div>
        <div className={css.desc}>{t(copy.description)}</div>
      </div>
      <button
        type="button"
        className={css.action}
        onClick={() => { openConfirm(kind) }}
      >
        {t(copy.action)}
      </button>
    </div>
  )
}
