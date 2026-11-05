# Agent Note: Account quotas in agent conversations

Status: proposed

English | [中文](2026-11-05-agent-account-quota.zh.md)

## Problem

A user working in an agent conversation must leave it to read the limits and balances for the active account.

## Proposal

Show a quota button next to the agent input when its effective model uses a provider with an account quota reader. Opening the popover explicitly reads the current provider through the existing account-scoped IPC. Show remaining percentages, window and model scope, reset timestamps, balances, and reset credits when reported. Reuse the Usage view's field labels, units, and formatting. Allow refresh and a link to Usage.

The provider is the model's provider, not an account inferred from its model name. Clear snapshots when the popover closes or the provider changes. Never redeem credits, estimate limits from tokens, or make quota calls on message sends.

## Alternatives considered

Polling keeps the numbers fresh but would contact accounts without an explicit action. A shared permanent cache can show a previous account's balance after a login change.

## Acceptance criteria

- AC1 — Opening the control for a supported model reads only that provider; opening a conversation and sending messages do not read quotas (verification: renderer and Electron)
- AC2 — The popover shows remaining percentages, model scope, resets, and reported credits; missing account data shows an explicit unavailable state (verification: renderer)
- AC3 — Switching providers discards the previous report and the existing Usage view retains its consumed percentages (verification: renderer)

## Risks

Availability depends on the existing provider readers. API key usage, unsupported signed-in providers, and fields absent from the provider report cannot supply account quotas.
