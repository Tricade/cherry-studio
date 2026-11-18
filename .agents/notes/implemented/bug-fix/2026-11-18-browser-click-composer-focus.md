# Agent Note: Restore composer focus after browser tool clicks

Status: implemented

English | [中文](2026-11-18-browser-click-composer-focus.zh.md)

## Problem

A browser tool click can focus the embedded webview even while the user is editing a chat draft. In Electron 44.9.3, a trusted click on a page button or text field moved focus from the host composer to the webview.

## Decision

Before dispatching a click to a borrowed guest, the main process asks its owning renderer to remember the active text input. When dispatch finishes, including after an error, the renderer restores focus if that exact guest took it and the input remains attached and interactive. A different host focus target invalidates the saved input. Each request is bound to the conversation, guest and click.

## Alternatives considered

- Sending the mouse event through the guest's `webContents.sendInputEvent` also moved focus to the webview in Electron 44.9.3.
- Replacing trusted clicks with DOM `click()` would change page focus and mouse event behavior, including secondary and repeated clicks.

## Consequences

Focus restoration happens at the end of mouse dispatch. The renderer keeps the saved DOM element locally for the duration of the click. Manual browsing and standalone browser tabs use their usual focus behavior.

## Verification

- Regression — `useAgentBrowserGuest.test.ts`: a matching click restores the draft and selection, while a stale request or intervening focus change leaves the current focus alone.
- Regression — `actions.test.ts`: a failed mouse press still restores the previously focused input.
- Regression — `Electron 44.9.3 / Chromium 152.0.7977.167`: isolated agent and topic webviews retain textarea and rich-text selections after browser tool clicks, and the guest still accepts Unicode typing, Backspace and scrolling.
