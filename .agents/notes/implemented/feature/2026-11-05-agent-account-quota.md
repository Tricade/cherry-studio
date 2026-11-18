# Agent Note: Account quotas in agent conversations

Status: implemented

English | [中文](2026-11-05-agent-account-quota.zh.md)

## Problem

A user working in an agent conversation must leave it to read the limits and balances for the active account.

## Decision

A quota button appears next to the agent input when its effective model uses a provider with an account quota reader. Opening the popover explicitly reads the current provider through the existing account-scoped IPC. The popover shows remaining percentages, window and model scope, reset timestamps, balances, and reset credits when reported. It reuses the Usage view’s field labels, units, and formatting, and provides refresh and a link to Usage.

The effective model supplies the provider ID. Snapshots are cleared when the popover closes or the provider changes. The control reads reports on open or refresh and leaves redemption and inference to their separate flows.

The main process reads Codex usage and optional reset-credit details using the existing Codex account in Cherry. It uses fixed read-only URLs and checks the account before presenting the report. OpenAI’s legacy client uses the same read endpoints. [Codex backend client at rust-v0.166.0-alpha.5.1](https://github.com/openai/codex/blob/rust-v0.166.0-alpha.5.1/codex-rs/backend-client/src/client/rate_limit_resets.rs)

## Alternatives considered

Polling keeps the numbers fresh but would contact accounts without an explicit action. A shared permanent cache can show a previous account's balance after a login change.

## Consequences

Availability depends on the existing provider readers. API key usage, unsupported signed-in providers, and fields absent from the provider report cannot supply account quotas.

## Verification

- AC1 — In the isolated Electron conversation, zero quota requests occur before the control opens. Opening it issues one request for the current Codex provider; the real IPC returns a sign-in notice. The renderer test verifies explicit open as the trigger and the quota button owns no message send handler.
- AC2 — Renderer and Electron fixtures display reported model and shared limits, remaining percentages, reset times, balances and reset credit count. Live authenticated balances were not queried.
- AC3 — Renderer tests replace the active provider during a pending request and verify the previous balance never appears. The same fixture still shows the consumed percentage in the Usage view. Main-process tests verify fixed HTTP GETs, credential scoping, rejection of a changed account, and preservation of usage when reset-credit details are unavailable.
