/**
 * The `restart` Remote: one-click graceful shutdown of the dsh web backend.
 * The launcher's `appExit` disposes the whole tree and lets the process exit
 * cleanly; the person restarts the backend manually afterwards. No process
 * relaunch machinery is involved, so there is nothing that can break between
 * the click and the shutdown.
 * @module @deepseek-ai/dsh-host-restart
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { RestartAck } from './types.ts';
export type * from './types.ts';
/** Remote service exposing the one-click backend shutdown. */
export declare class RestartGateway extends TypertRemoteService {
    /** One shutdown request per process lifetime. */
    private armed;
    constructor(ctx: Context);
    /**
     * Rebuild a runnable command line hint from this process's own launch facts.
     * @returns the command the person can re-run to bring the backend back.
     */
    private launchHint;
    /**
     * Request the launcher's graceful exit; on success this process exits
     * shortly after and the person restarts it manually.
     * @returns the shutdown outcome and a restart hint.
     */
    restart(): Promise<RestartAck>;
}
export default RestartGateway;
//# sourceMappingURL=index.d.ts.map