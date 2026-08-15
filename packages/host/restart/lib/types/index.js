/**
 * The `restart` Remote: one-click graceful shutdown of the dsh web backend.
 * The launcher's `appExit` disposes the whole tree and lets the process exit
 * cleanly; the person restarts the backend manually afterwards. No process
 * relaunch machinery is involved, so there is nothing that can break between
 * the click and the shutdown.
 * @module @deepseek-ai/dsh-host-restart
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** Delay between answering the browser and requesting the graceful exit. */
const EXIT_DELAY_MS = 600;
/** Remote service exposing the one-click backend shutdown. */
let RestartGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _restart_decorators;
    return class RestartGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _restart_decorators = [Remote('restart')];
            __esDecorate(this, null, _restart_decorators, { kind: "method", name: "restart", static: false, private: false, access: { has: obj => "restart" in obj, get: obj => obj.restart }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        /** One shutdown request per process lifetime. */
        armed = (__runInitializers(this, _instanceExtraInitializers), false);
        constructor(ctx) {
            super(ctx, 'restart');
        }
        /**
         * Rebuild a runnable command line hint from this process's own launch facts.
         * @returns the command the person can re-run to bring the backend back.
         */
        launchHint() {
            const args = process.argv.slice(1).map(arg => arg.includes(' ') ? `"${arg}"` : arg);
            return `"${process.execPath}" ${args.join(' ')} (cwd: ${process.cwd()})`;
        }
        /**
         * Request the launcher's graceful exit; on success this process exits
         * shortly after and the person restarts it manually.
         * @returns the shutdown outcome and a restart hint.
         */
        async restart() {
            if (this.armed)
                return { ok: false, message: 'restart already in progress' };
            const appExit = this.ctx.get('appExit');
            if (appExit === undefined) {
                return { ok: false, message: 'the launcher exposes no graceful exit; stop the backend manually' };
            }
            this.armed = true;
            setTimeout(() => {
                try {
                    appExit(0);
                }
                catch {
                    // The launcher owns failure semantics; nothing else to do here.
                }
            }, EXIT_DELAY_MS);
            return {
                ok: true,
                message: `the dsh backend is shutting down; restart it manually with: ${this.launchHint()}`,
            };
        }
    };
})();
export { RestartGateway };
export default RestartGateway;
//# sourceMappingURL=index.js.map