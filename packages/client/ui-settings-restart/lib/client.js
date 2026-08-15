window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-settings-restart",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let react_dom = require("react-dom");
		//#region \0dsh-css:D:\Deepseek Harness\deepseek-harness\packages\client\ui-settings-restart\src\client\RestartDialog.module.css.mjs
		const css$1 = ".TMPLta_backdrop{z-index:2000;pointer-events:auto;background:#00000073;justify-content:center;align-items:center;padding:24px;display:flex;position:fixed;inset:0}.TMPLta_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);border-radius:12px;flex-direction:column;gap:16px;width:100%;max-width:400px;padding:24px;display:flex;box-shadow:0 12px 32px #00000047}.TMPLta_title{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px}.TMPLta_body{color:var(--dsw-alias-label-secondary);overflow-wrap:break-word;font-size:14px;font-weight:400;line-height:22px}.TMPLta_detail{color:var(--dsw-alias-label-tertiary);overflow-wrap:break-word;font-size:12px;font-weight:400;line-height:18px}.TMPLta_actions{justify-content:flex-end;gap:12px;margin-top:8px;display:flex}.TMPLta_confirm,.TMPLta_cancel{height:36px;font:inherit;cursor:pointer;border-radius:18px;padding:0 16px;font-size:14px;line-height:22px}.TMPLta_confirm{color:#fff;background:#000;border:1px solid #000}.TMPLta_confirm:hover{background:#262626;border-color:#262626}.TMPLta_cancel{border:1px solid var(--dsw-alias-border-l2);color:#000;background:#fff}.TMPLta_cancel:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		const tagId$1 = "@deepseek-ai/dsh-client-ui-settings-restart/RestartDialog.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-settings-restart";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var RestartDialog_module_css_default = {
			"detail": "TMPLta_detail",
			"cancel": "TMPLta_cancel",
			"actions": "TMPLta_actions",
			"card": "TMPLta_card",
			"backdrop": "TMPLta_backdrop",
			"title": "TMPLta_title",
			"body": "TMPLta_body",
			"confirm": "TMPLta_confirm"
		};
		//#endregion
		//#region lib/types/client/RestartDialog.js
		/** Frame-wide confirm/cancel dialog for the backend/frontend actions, portaled to body so it stays topmost. */
		/** Per-action confirm copy. */
		const COPY$1 = {
			restart: {
				title: "dialog.title",
				body: "dialog.body",
				confirm: "dialog.confirm"
			},
			refresh: {
				title: "dialog.refreshTitle",
				body: "dialog.refreshBody",
				confirm: "dialog.refreshConfirm"
			}
		};
		/** Subscribe one component to the shared store. */
		function useDialogState(store) {
			const [state, setState] = (0, react.useState)(store.getState);
			(0, react.useEffect)(() => store.subscribe(() => {
				setState(store.getState());
			}), [store]);
			return state;
		}
		/**
		* Render the action confirmation dialog, or null while closed.
		* @param props - composed overlay props.
		* @returns the dialog overlay, or null.
		*/
		function RestartDialog({ restart, refresh, store, t }) {
			const state = useDialogState(store);
			const [busy, setBusy] = (0, react.useState)(false);
			if (!state.open) return null;
			const confirm = () => {
				if (busy) return;
				if (state.kind === "refresh") {
					setBusy(true);
					refresh();
					return;
				}
				setBusy(true);
				store.beginRestart();
				restart().then(({ ok, text }) => {
					setBusy(false);
					if (ok) store.restarting(text);
					else store.fail(text);
				});
			};
			const closeable = state.phase === "confirm" && !busy;
			return (0, react_dom.createPortal)((0, react_jsx_runtime.jsx)("div", {
				className: RestartDialog_module_css_default.backdrop,
				onClick: () => {
					if (closeable) store.close();
				},
				children: (0, react_jsx_runtime.jsx)("div", {
					className: RestartDialog_module_css_default.card,
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t(COPY$1[state.kind].title),
					onClick: (event) => {
						event.stopPropagation();
					},
					children: state.phase === "restarting" ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.title,
							children: t("dialog.restartingTitle")
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.body,
							children: t("dialog.restartingBody")
						}),
						state.detail === null ? null : (0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.detail,
							children: state.detail
						})
					] }) : state.phase === "error" ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.title,
							children: t("dialog.errorTitle")
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.body,
							children: state.error ?? ""
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.actions,
							children: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: RestartDialog_module_css_default.cancel,
								onClick: () => {
									store.close();
								},
								children: t("dialog.close")
							})
						})
					] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.title,
							children: t(COPY$1[state.kind].title)
						}),
						(0, react_jsx_runtime.jsx)("div", {
							className: RestartDialog_module_css_default.body,
							children: t(COPY$1[state.kind].body)
						}),
						(0, react_jsx_runtime.jsxs)("div", {
							className: RestartDialog_module_css_default.actions,
							children: [(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: RestartDialog_module_css_default.cancel,
								onClick: () => {
									store.close();
								},
								children: t("dialog.cancel")
							}), (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: RestartDialog_module_css_default.confirm,
								onClick: confirm,
								children: t(COPY$1[state.kind].confirm)
							})]
						})
					] })
				})
			}), document.body);
		}
		//#endregion
		//#region \0dsh-css:D:\Deepseek Harness\deepseek-harness\packages\client\ui-settings-restart\src\client\RestartRow.module.css.mjs
		const css = ".U45rSq_row{border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:16px 0;display:flex}.U45rSq_rowText{flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px;display:flex}.U45rSq_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}.U45rSq_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}.U45rSq_action{background:var(--dsw-alias-bg-module-platform);height:36px;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;border:none;border-radius:18px;flex:none;justify-content:center;align-items:center;padding:0 16px;font-size:14px;line-height:22px;display:inline-flex}.U45rSq_action:hover{background:var(--dsw-alias-interactive-bg-hover)}";
		const tagId = "@deepseek-ai/dsh-client-ui-settings-restart/RestartRow.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-settings-restart";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var RestartRow_module_css_default = {
			"row": "U45rSq_row",
			"action": "U45rSq_action",
			"rowText": "U45rSq_rowText",
			"title": "U45rSq_title",
			"desc": "U45rSq_desc"
		};
		//#endregion
		//#region lib/types/client/RestartRow.js
		/** Per-action copy keys. */
		const COPY = {
			restart: {
				title: "row.title",
				description: "row.description",
				action: "row.action"
			},
			refresh: {
				title: "row.refreshTitle",
				description: "row.refreshDescription",
				action: "row.refreshAction"
			}
		};
		/**
		* Render one action row (backend restart / frontend refresh).
		* @param props - composed Settings slot props.
		* @returns the action row.
		*/
		function RestartRow({ kind, openConfirm, t }) {
			const copy = COPY[kind];
			return (0, react_jsx_runtime.jsxs)("div", {
				className: RestartRow_module_css_default.row,
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: RestartRow_module_css_default.rowText,
					children: [(0, react_jsx_runtime.jsx)("div", {
						className: RestartRow_module_css_default.title,
						children: t(copy.title)
					}), (0, react_jsx_runtime.jsx)("div", {
						className: RestartRow_module_css_default.desc,
						children: t(copy.description)
					})]
				}), (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: RestartRow_module_css_default.action,
					onClick: () => {
						openConfirm(kind);
					},
					children: t(copy.action)
				})]
			});
		}
		//#endregion
		//#region lib/types/client/restart-store.js
		/** Shared dialog state between the settings rows and the overlay dialog. */
		/** Create one store per client apply so teardown owns all its listeners. */
		function createRestartUiStore() {
			let state = {
				open: false,
				kind: "restart",
				phase: "confirm",
				error: null,
				detail: null
			};
			const listeners = /* @__PURE__ */ new Set();
			const set = (next) => {
				state = next;
				for (const listener of listeners) listener();
			};
			return {
				getState: () => state,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				openConfirm: (kind) => {
					set({
						open: true,
						kind,
						phase: "confirm",
						error: null,
						detail: null
					});
				},
				beginRestart: () => {
					set({
						open: true,
						kind: "restart",
						phase: "restarting",
						error: null,
						detail: null
					});
				},
				fail: (message) => {
					set({
						open: true,
						kind: "restart",
						phase: "error",
						error: message,
						detail: null
					});
				},
				restarting: (detail) => {
					set({
						open: true,
						kind: "restart",
						phase: "restarting",
						error: null,
						detail
					});
				},
				close: () => {
					set({
						open: false,
						kind: "restart",
						phase: "confirm",
						error: null,
						detail: null
					});
				}
			};
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** Copy dictionaries for the backend-restart / frontend-refresh rows and dialogs. */
		/** Simplified Chinese dictionary and key source of truth. */
		const zh = {
			"row.title": "关闭后台服务",
			"row.description": "关闭 DSH 后台服务，由你手动重新启动",
			"row.action": "关闭",
			"row.refreshTitle": "刷新前端",
			"row.refreshDescription": "重新加载页面并保留创造模式的热插件",
			"row.refreshAction": "刷新",
			"dialog.title": "关闭后台服务",
			"dialog.body": "确定要关闭 DSH 后台服务吗？关闭后页面会断开，需要你手动重新启动后台服务并重新打开页面。注意：关闭后创造模式的热插件会消失。",
			"dialog.confirm": "确认关闭",
			"dialog.cancel": "取消",
			"dialog.refreshTitle": "刷新前端",
			"dialog.refreshBody": "确定要刷新前端页面吗？页面将重新加载，创造模式的热插件会保留，后台服务不会关闭。",
			"dialog.refreshConfirm": "确认刷新",
			"dialog.restartingTitle": "正在关闭…",
			"dialog.restartingBody": "后台服务正在关闭，页面即将断开。请手动重新启动后台服务，然后重新打开页面。",
			"dialog.errorTitle": "关闭失败",
			"dialog.close": "关闭"
		};
		/** English dictionary checked against the Chinese key set. */
		const en = {
			"row.title": "Shut down backend service",
			"row.description": "Shut down the DSH backend; restart it manually afterwards",
			"row.action": "Shut down",
			"row.refreshTitle": "Refresh frontend",
			"row.refreshDescription": "Reload the page and keep creation-mode hot plugins",
			"row.refreshAction": "Refresh",
			"dialog.title": "Shut down backend service",
			"dialog.body": "Shut down the DSH backend service now? The page will disconnect; you will need to restart the backend manually and reopen the page. Note: creation-mode hot plugins will be lost.",
			"dialog.confirm": "Shut down",
			"dialog.cancel": "Cancel",
			"dialog.refreshTitle": "Refresh frontend",
			"dialog.refreshBody": "Refresh the frontend page now? The page will reload, creation-mode hot plugins are kept, and the backend will not shut down.",
			"dialog.refreshConfirm": "Refresh",
			"dialog.restartingTitle": "Shutting down…",
			"dialog.restartingBody": "The backend is shutting down and the page is about to disconnect. Restart the backend manually, then reopen the page.",
			"dialog.errorTitle": "Shutdown failed",
			"dialog.close": "Close"
		};
		//#endregion
		//#region lib/types/client/index.js
		/**
		* Browser half of the backend-restart plugin: the General-settings rows
		* (backend restart + frontend refresh) and their shared confirm/cancel
		* dialog, backed by the restart Host Remote.
		* @module @deepseek-ai/dsh-client-ui-settings-restart/client
		*/
		/**
		* sessionStorage flag arming the one-shot re-attach of active dynamic
		* (creation-mode) Plugins after a frontend-only refresh. The value is
		* consumed by ui-cordis' inventory subscription on the next page load.
		*/
		const REATTACH_FLAG = "dsh:reattach-cordis-runs";
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.restart";
		/** Services required by the settings registrations and the generated Remote face. */
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.restart"
		];
		/**
		* Mount the action rows and their dialog.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "ui-settings-restart: dictionaries");
			const store = createRestartUiStore();
			ctx.on("connection/reset", () => {
				store.close();
			});
			const armReattachFlag = () => {
				try {
					sessionStorage.setItem(REATTACH_FLAG, "1");
				} catch {}
			};
			ctx.effect(() => {
				const onKeyDown = (event) => {
					const isPlainF5 = event.key === "F5" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
					const isPlainCtrlR = event.key.toLowerCase() === "r" && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
					if (!isPlainF5 && !isPlainCtrlR) return;
					armReattachFlag();
					event.preventDefault();
					window.location.reload();
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, "ui-settings-restart: refresh-shortcut reattach arm");
			const runRestart = async () => {
				const result = await ctx.remote.restart.restart();
				if (!result.ok) return {
					ok: false,
					text: result.error.message
				};
				if (!result.value.ok) return {
					ok: false,
					text: result.value.message
				};
				try {
					window.close();
				} catch {}
				return {
					ok: true,
					text: result.value.message
				};
			};
			const runRefresh = async () => {
				armReattachFlag();
				window.location.reload();
				return {
					ok: true,
					text: ""
				};
			};
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "restart-backend",
				order: 30,
				locale: NS,
				inject: () => ({
					kind: "restart",
					openConfirm: (kind) => {
						store.openConfirm(kind);
					}
				})
			}, RestartRow));
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "refresh-frontend",
				order: 40,
				locale: NS,
				inject: () => ({
					kind: "refresh",
					openConfirm: (kind) => {
						store.openConfirm(kind);
					}
				})
			}, RestartRow));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "restart-backend-dialog",
				order: 0,
				locale: NS,
				inject: () => ({
					restart: runRestart,
					refresh: runRefresh,
					store
				})
			}, RestartDialog));
		}
		//#endregion
		exports.REATTACH_FLAG = REATTACH_FLAG;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map