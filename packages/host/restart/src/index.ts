/**
 * The `restart` Remote: one-click graceful shutdown of the dsh web backend.
 * The launcher's `appExit` disposes the whole tree and lets the process exit
 * cleanly; the person restarts the backend manually afterwards. No process
 * relaunch machinery is involved, so there is nothing that can break between
 * the click and the shutdown.
 * @module @deepseek-ai/dsh-host-restart
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RestartAck } from './types.ts'

export type * from './types.ts'

/** Delay between answering the browser and requesting the graceful exit. */
const EXIT_DELAY_MS = 600

/** Remote service exposing the one-click backend shutdown. */
export class RestartGateway extends TypertRemoteService {
  /** One shutdown request per process lifetime. */
  private armed = false

  constructor(ctx: Context) {
    super(ctx, 'restart')
  }

  /**
   * Rebuild a runnable command line hint from this process's own launch facts.
   * @returns the command the person can re-run to bring the backend back.
   */
  private launchHint(): string {
    const args = process.argv.slice(1).map(arg => arg.includes(' ') ? `"${arg}"` : arg)
    return `"${process.execPath}" ${args.join(' ')} (cwd: ${process.cwd()})`
  }

  /**
   * Request the launcher's graceful exit; on success this process exits
   * shortly after and the person restarts it manually.
   * @returns the shutdown outcome and a restart hint.
   */
  @Remote('restart')
  async restart(): Promise<RestartAck> {
    if (this.armed) return { ok: false, message: 'restart already in progress' }
    const appExit = this.ctx.get('appExit') as ((code: number) => void) | undefined
    if (appExit === undefined) {
      return { ok: false, message: 'the launcher exposes no graceful exit; stop the backend manually' }
    }
    this.armed = true
    setTimeout(() => {
      try {
        appExit(0)
      } catch {
        // The launcher owns failure semantics; nothing else to do here.
      }
    }, EXIT_DELAY_MS)
    return {
      ok: true,
      message: `the dsh backend is shutting down; restart it manually with: ${this.launchHint()}`,
    }
  }
}

export default RestartGateway
