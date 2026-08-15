# dsh-plugin-suite

DeepSeek Harness **定制插件套件**（局部 fork）。本仓库只携带对官方 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的**改动切片**——新增的插件包 + 一张完整补丁——不携带整个官方仓库，因此轻量、易浏览；后续所有"需要改动宿主内部"的插件都按同样的方式收纳进这里。

- 基于上游 commit：`47f943859b`（dsh 0.1.0-rc.5 时代）
- 话题：[`dsh-plugin`](https://github.com/topics/dsh-plugin)

## 当前包含的功能

| 功能 | 内容 | 所在位置 |
| --- | --- | --- |
| **command-guard 防误删** | 命令守卫 + `careful-full-access` 沙箱模式（四档判定、WhatIf 预演、两步确认、工作区根 ACE 加固） | `packages/guard/command-guard/` + 沙箱/文件系统/终端/权限等改动（在 `install.patch` 内） |
| **一键关闭后台 / 刷新前端** | 设置 → 通用设置 新增「关闭后台服务」「刷新前端」两行（置顶确认框），F5/Ctrl+R 强制刷新且保留创造模式热插件 | `packages/host/restart/` + `packages/client/ui-settings-restart/` + 接线改动（在 `install.patch` 内） |

详细设计说明见 `.agents/notes/implemented/feature/2026-08-15-command-guard-careful-full-access.*`。

## 安装

本仓库是**切片**，不是完整 harness——需叠加到一份与 base commit 一致的上游工作区：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 47f943859b
# 1) 应用本套件的完整补丁
git apply /path/to/dsh-plugin-suite/install.patch
# 2) 把三个新增包目录复制进工作区对应位置：
#    packages/guard/command-guard
#    packages/host/restart
#    packages/client/ui-settings-restart
# 3) 安装依赖并构建
pnpm install
pnpm run build
# 4) 启动（重启后两个功能即生效）
pnpm dsh web
```

若你的上游版本已前进，`install.patch` 可能无法干净应用——此时对照补丁手工合并（改动点均为组合注册、依赖声明与 tsconfig 引用，结构清晰）。

## 如何向套件添加新的定制插件

1. 新插件包放入 `packages/<分组>/<名称>/`（源码 + 构建产物，参考既有包的结构与 `.gitignore`）；
2. 在最新上游 base 上完成接线后，重新生成完整补丁并覆盖本仓库：`git diff <base> HEAD > install.patch`，同时更新上方"基于上游 commit"；
3. 在本 README 功能表登记，并在「相关项目」维护互链。

## 相关项目

- [dsh-restart-plugin](https://github.com/zdjmrq/dsh-restart-plugin) —— 「关闭后台 / 刷新前端」的单功能独立发行（`install.patch` 仅含该功能），适合只想要这一项的场合；
- [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— 官方上游。

## License

MIT
