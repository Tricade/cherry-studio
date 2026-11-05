# Agent Note: Windows tray visibility and capture exclusion

Status: implemented

English | [中文](2026-11-05-windows-tray-and-selection.zh.md)

## Problem

The Windows close-to-tray path minimized the main window and hid its taskbar entry but could leave a transparent native window visible to other window management surfaces. The selection hook's clipboard fallback could also run while the Windows screenshot overlay was the foreground application.

## Decision

Keep the minimize step for focus handoff, then hide the window. When showing it again, repair opacity and taskbar visibility. Add the two Windows screenshot hosts to the same predefined selection exclusion list as other screenshot tools.

## Alternatives considered

- Replacing minimize with only hide discards the existing Windows focus handoff.
- Disabling the clipboard fallback globally also changes text selection outside screenshot tools.

## Consequences

The change uses the existing Electron 44.9.3 and selection-hook 2.1.2 interfaces. Foreground-based exclusion only applies when the hook identifies one of the screenshot hosts; it does not prevent all competing clipboard writes.

## Verification

- Regression — `MainWindowService.test.ts` exercises hide and reopen, including taskbar appearance and repeated tray behavior.
- Regression — `selectionConfig.test.ts`, `SelectionService.test.ts` and `SelectionService.voice.test.ts` cover the blacklist and existing filter consumers. The native Windows clipboard and task switcher were not exercised.
- Sources — [close to tray](https://github.com/CherryHQ/cherry-studio/pull/23539) and [screenshot hosts](https://github.com/CherryHQ/cherry-studio/pull/23335).
