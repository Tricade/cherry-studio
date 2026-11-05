# Agent Note: Browser Runtime activation on demand

Status: implemented

English | [中文](2026-11-05-browser-runtime-on-demand.zh.md)

## Problem

Opening the debugger for an ordinary browser snapshot or action enables V8 Runtime event reporting. Some pages react to the resulting console formatting side effects even though the operation does not use those events.

## Decision

The browser enables Runtime for console inspection, annotation capture, or WebMCP discovery. Concurrent callers share activation for one debugger attachment. Each waiting caller keeps its deadline and cancellation. A failed activation can be retried, and detach resets the subscription.

This backports [the upstream browser fix](https://github.com/CherryHQ/cherry-studio/commit/1a0530f068043158379322f1e7c8f32f692b0aca) while preserving the fork's URL redaction and documenting Chromium's buffered console replay.

## Alternatives considered

Eager activation gives all operations the Runtime events, including operations that never use them. Turning Runtime off after each individual tool would break the retained console stream and context lifecycle used by annotation and WebMCP.

## Consequences

Ordinary browser capture and input do not subscribe to Runtime. Console reads mark whether that call started the subscription. The first read can contain earlier messages still buffered by Chromium, so pre-subscription history depends on the target. Network capture, snapshot URL sanitization and browser permissions retain their existing behavior.

## Verification

- Regression — Seven targeted main suites pass 184 tests, including ordinary debugger attachment, concurrent and cancelled readers, retry after failure, reattachment, annotation context lifetime, WebMCP, and URL sanitization.
- Regression — An isolated Electron 44.9.3 protocol probe with Chromium 152.0.7977.167 verifies accessibility capture and input before Runtime activation. It observes replay of a buffered message on activation, live console events and an isolated-world binding afterwards.
