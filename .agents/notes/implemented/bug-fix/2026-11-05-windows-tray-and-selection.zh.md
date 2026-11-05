# Agent Note: Windows 托盘窗口与截图进程排除

Status: implemented

[English](2026-11-05-windows-tray-and-selection.md) | 中文

## Problem

Windows 的关闭到托盘流程最小化主窗口并隐藏任务栏入口，但透明的原生窗口仍可能出现在其他窗口管理界面中。系统截图覆盖层位于前台时，划词钩子的剪贴板回退也可能运行。

## Decision

保留用于交接焦点的最小化步骤，再隐藏窗口。重新显示时修复不透明度与任务栏状态。把两个 Windows 截图进程加入现有的截图工具划词排除列表。

## Alternatives considered

- 只隐藏而不最小化会丢失现有的 Windows 焦点交接。
- 全局禁用剪贴板回退会改变截图工具之外的划词行为。

## Consequences

沿用 Electron 44.9.3 和 selection-hook 2.1.2 的现有接口。仅当钩子识别到前台截图进程时排除才生效；这不能阻止所有剪贴板写入竞争。

## Verification

- 回归验证 — `MainWindowService.test.ts` 覆盖隐藏和重新打开，包括任务栏状态和重复的托盘操作。
- 回归验证 — `selectionConfig.test.ts`、`SelectionService.test.ts` 和 `SelectionService.voice.test.ts` 覆盖排除列表和已有的过滤调用方。未测试 Windows 原生剪贴板和任务切换器。
- 来源 — [关闭到托盘](https://github.com/CherryHQ/cherry-studio/pull/23539)与[截图进程排除](https://github.com/CherryHQ/cherry-studio/pull/23335)。
