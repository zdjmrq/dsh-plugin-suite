/**
 * Browser half of the backend-restart plugin: the General-settings rows
 * (backend restart + frontend refresh) and their shared confirm/cancel
 * dialog, backed by the restart Host Remote.
 * @module @deepseek-ai/dsh-client-ui-settings-restart/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated restart Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the connection event map (connection/reset).
import type {} from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the settings slot declarations (settings.general.item).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RestartDialog, type RestartDialogInjected } from './RestartDialog.tsx'
import { RestartRow, type RestartRowInjected } from './RestartRow.tsx'
import { createRestartUiStore } from './restart-store.ts'
import { en, zh, type RestartKey } from './locales.ts'

export type { RestartDialogInjected, RestartDialogProps } from './RestartDialog.tsx'
export type { RestartRowInjected, RestartRowProps } from './RestartRow.tsx'
export type { RestartDialogKind, RestartDialogPhase, RestartDialogState, RestartUiStore } from './restart-store.ts'
export type { RestartKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Backend-restart / frontend-refresh settings copy. */
    'settings.restart': RestartKey
  }
}

/**
 * sessionStorage flag arming the one-shot re-attach of active dynamic
 * (creation-mode) Plugins after a frontend-only refresh. The value is
 * consumed by ui-cordis' inventory subscription on the next page load.
 */
export const REATTACH_FLAG = 'dsh:reattach-cordis-runs'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.restart'

/** Services required by the settings registrations and the generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.restart']

/**
 * Mount the action rows and their dialog.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-restart: dictionaries')

  const store = createRestartUiStore()

  // A reconnect means the backend already restarted: reset the dialog.
  ctx.on('connection/reset', () => { store.close() })

  const armReattachFlag = (): void => {
    try {
      sessionStorage.setItem(REATTACH_FLAG, '1')
    } catch {
      // Storage refusal must not block the refresh itself.
    }
  }

  // F5 and Ctrl+R keep the "refresh frontend" behavior: arm the one-shot
  // re-attach flag, then force the reload from the page itself. preventDefault
  // + location.reload() makes the refresh work even where the browser's own
  // F5 default action is suppressed (desktop shells, embedded views), while
  // Ctrl+Shift+R (cache-bypassing force reload) is deliberately left native.
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isPlainF5 = event.key === 'F5'
        && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      const isPlainCtrlR = event.key.toLowerCase() === 'r'
        && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
      if (!isPlainF5 && !isPlainCtrlR) return
      armReattachFlag()
      event.preventDefault()
      window.location.reload()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, 'ui-settings-restart: refresh-shortcut reattach arm')

  const runRestart = async (): Promise<{ ok: boolean; text: string }> => {
    const result = await ctx.remote.restart.restart()
    if (!result.ok) return { ok: false, text: result.error.message }
    if (!result.value.ok) return { ok: false, text: result.value.message }
    // Best effort: browsers only close script-opened windows; a blocked
    // close is fine because the page disconnects on its own right after.
    try {
      window.close()
    } catch {
      // Nothing to do.
    }
    return { ok: true, text: result.value.message }
  }

  const runRefresh = async (): Promise<{ ok: boolean; text: string }> => {
    armReattachFlag()
    window.location.reload()
    return { ok: true, text: '' }
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'restart-backend',
    order: 30,
    locale: NS,
    inject: (): RestartRowInjected => ({
      kind: 'restart',
      openConfirm: (kind) => { store.openConfirm(kind) },
    }),
  }, RestartRow))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'refresh-frontend',
    order: 40,
    locale: NS,
    inject: (): RestartRowInjected => ({
      kind: 'refresh',
      openConfirm: (kind) => { store.openConfirm(kind) },
    }),
  }, RestartRow))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'restart-backend-dialog',
    order: 0,
    locale: NS,
    inject: (): RestartDialogInjected => ({
      restart: runRestart,
      refresh: runRefresh,
      store,
    }),
  }, RestartDialog))
}
