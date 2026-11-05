# Agent Note: Built-in agent removal and CherryAI guest inference

Status: implemented

English | [中文](2026-11-05-builtin-agent-removal-and-cherryai-guest.zh.md)

## Problem

The normal agent menu could only archive sessions for Cherry Assistant and Cherry Support. Startup seeds or special entry points could recreate an agent once its row disappeared. Separately, automatic conversation naming used the seeded CherryAI guest model or fell back to it after the visible chat used another provider. The guest transport authenticates the app without a personal Cherry account.

## Decision

Use the ordinary archive, restore and permanent deletion actions for both agents. Write the removal record in the same database transaction and honor it in seeders and built-in session creation. An explicit restore clears the record. The hidden Doctor role and existing tool safeguards keep their own contracts.

Automatic summaries use an eligible configured Quick Model or default model; absent one, keep the local first-message title. Never use the guest model for automatic conversation naming. Its request transport requires explicit opt-in before signing and fetching. The model settings explain the destination and data.

## Alternatives considered

- Hide the agent only in the renderer: seeding and special session launches can still recreate it.
- Keep only the archived row: purging the archive removes the evidence of deletion.
- Block guest requests only in model selection: existing saved selections and non-chat callers can bypass it.
- Change all Cherry connections: account-based Cherry Cloud and confirmed diagnostics are separate flows.

## Consequences

No new SQLite schema or legacy migration is required. Users who relied on the guest model must enable it explicitly or choose another model. Turning it off gates subsequent requests; it does not cancel an already sent request.

## Verification

- Regression — `builtinAgentDeletion.test.ts` covers both roles, associated sessions, reseeding, explicit restore, and permanent deletion in a real SQLite test database.
- Regression — `TopicNamingService.test.ts` and provider `config.test.ts` reproduce the unintended fallback and exercise local titles and the guest transport with a stubbed network. Cherry Cloud tests exercise the separate transport.
- Regression — the agent and settings renderer suites cover the archive command, preserved sessions, onboarding and opt-in. An isolated Electron profile confirmed that both agents leave the active library through their menus, special entry points respect removal, and the guest switch starts off and shows the destination. No live inference request was sent for this verification.
