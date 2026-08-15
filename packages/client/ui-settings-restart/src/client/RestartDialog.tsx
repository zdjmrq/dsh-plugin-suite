/** Frame-wide confirm/cancel dialog for the backend/frontend actions, portaled to body so it stays topmost. */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RestartDialogKind, RestartUiStore } from './restart-store.ts'
import type { RestartKey } from './locales.ts'
import css from './RestartDialog.module.css'

/** Registrant-owned dependencies of the action dialog. */
export interface RestartDialogInjected {
  /** Request the Host restart; resolves failure text or Host status detail. */
  restart: () => Promise<{ ok: boolean; text: string }>
  /** Refresh the frontend page, keeping hot plugins; resolves success. */
  refresh: () => Promise<{ ok: boolean; text: string }>
  /** Shared dialog state. */
  store: RestartUiStore
}

/** Full overlay props. */
export type RestartDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.restart'>
  & InjectFace<RestartDialogInjected>

/** Per-action confirm copy. */
const COPY: Record<RestartDialogKind, { title: RestartKey; body: RestartKey; confirm: RestartKey }> = {
  restart: { title: 'dialog.title', body: 'dialog.body', confirm: 'dialog.confirm' },
  refresh: { title: 'dialog.refreshTitle', body: 'dialog.refreshBody', confirm: 'dialog.refreshConfirm' },
}

/** Subscribe one component to the shared store. */
function useDialogState(store: RestartUiStore) {
  const [state, setState] = useState(store.getState)
  useEffect(() => store.subscribe(() => { setState(store.getState()) }), [store])
  return state
}

/**
 * Render the action confirmation dialog, or null while closed.
 * @param props - composed overlay props.
 * @returns the dialog overlay, or null.
 */
export function RestartDialog({ restart, refresh, store, t }: RestartDialogProps) {
  const state = useDialogState(store)
  const [busy, setBusy] = useState(false)

  if (!state.open) return null

  const confirm = (): void => {
    if (busy) return
    if (state.kind === 'refresh') {
      setBusy(true)
      void refresh()
      return
    }
    setBusy(true)
    store.beginRestart()
    void restart().then(({ ok, text }) => {
      setBusy(false)
      if (ok) store.restarting(text)
      else store.fail(text)
    })
  }

  const closeable = state.phase === 'confirm' && !busy

  return createPortal(
    <div
      className={css.backdrop}
      onClick={() => { if (closeable) store.close() }}
    >
      <div
        className={css.card}
        role="dialog"
        aria-modal="true"
        aria-label={t(COPY[state.kind].title)}
        onClick={(event) => { event.stopPropagation() }}
      >
        {state.phase === 'restarting' ? (
          <>
            <div className={css.title}>{t('dialog.restartingTitle')}</div>
            <div className={css.body}>{t('dialog.restartingBody')}</div>
            {state.detail === null ? null : <div className={css.detail}>{state.detail}</div>}
          </>
        ) : state.phase === 'error' ? (
          <>
            <div className={css.title}>{t('dialog.errorTitle')}</div>
            <div className={css.body}>{state.error ?? ''}</div>
            <div className={css.actions}>
              <button type="button" className={css.cancel} onClick={() => { store.close() }}>
                {t('dialog.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={css.title}>{t(COPY[state.kind].title)}</div>
            <div className={css.body}>{t(COPY[state.kind].body)}</div>
            <div className={css.actions}>
              <button type="button" className={css.cancel} onClick={() => { store.close() }}>
                {t('dialog.cancel')}
              </button>
              <button type="button" className={css.confirm} onClick={confirm}>
                {t(COPY[state.kind].confirm)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
