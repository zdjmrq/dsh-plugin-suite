/** Copy dictionaries for the backend-restart / frontend-refresh rows and dialogs. */
/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
    'row.title': '关闭后台服务',
    'row.description': '关闭 DSH 后台服务，由你手动重新启动',
    'row.action': '关闭',
    'row.refreshTitle': '刷新前端',
    'row.refreshDescription': '重新加载页面并保留创造模式的热插件',
    'row.refreshAction': '刷新',
    'dialog.title': '关闭后台服务',
    'dialog.body': '确定要关闭 DSH 后台服务吗？关闭后页面会断开，需要你手动重新启动后台服务并重新打开页面。注意：关闭后创造模式的热插件会消失。',
    'dialog.confirm': '确认关闭',
    'dialog.cancel': '取消',
    'dialog.refreshTitle': '刷新前端',
    'dialog.refreshBody': '确定要刷新前端页面吗？页面将重新加载，创造模式的热插件会保留，后台服务不会关闭。',
    'dialog.refreshConfirm': '确认刷新',
    'dialog.restartingTitle': '正在关闭…',
    'dialog.restartingBody': '后台服务正在关闭，页面即将断开。请手动重新启动后台服务，然后重新打开页面。',
    'dialog.errorTitle': '关闭失败',
    'dialog.close': '关闭',
};
/** English dictionary checked against the Chinese key set. */
export const en = {
    'row.title': 'Shut down backend service',
    'row.description': 'Shut down the DSH backend; restart it manually afterwards',
    'row.action': 'Shut down',
    'row.refreshTitle': 'Refresh frontend',
    'row.refreshDescription': 'Reload the page and keep creation-mode hot plugins',
    'row.refreshAction': 'Refresh',
    'dialog.title': 'Shut down backend service',
    'dialog.body': 'Shut down the DSH backend service now? The page will disconnect; you will need to restart the backend manually and reopen the page. Note: creation-mode hot plugins will be lost.',
    'dialog.confirm': 'Shut down',
    'dialog.cancel': 'Cancel',
    'dialog.refreshTitle': 'Refresh frontend',
    'dialog.refreshBody': 'Refresh the frontend page now? The page will reload, creation-mode hot plugins are kept, and the backend will not shut down.',
    'dialog.refreshConfirm': 'Refresh',
    'dialog.restartingTitle': 'Shutting down…',
    'dialog.restartingBody': 'The backend is shutting down and the page is about to disconnect. Restart the backend manually, then reopen the page.',
    'dialog.errorTitle': 'Shutdown failed',
    'dialog.close': 'Close',
};
//# sourceMappingURL=locales.js.map