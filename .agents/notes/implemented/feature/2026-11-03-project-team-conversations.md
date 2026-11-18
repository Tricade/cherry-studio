# Agent Note: Project team conversations

Status: implemented

English | [中文](2026-11-03-project-team-conversations.zh.md)

## Problem

This extends the project session ownership defined in [Private project workspaces](../../proposed/feature/2026-11-02-private-project-workspaces.md).

Agents could delegate a task and receive its result, but the session tools also discovered conversations outside the caller’s project. Reading chat history bypassed the approval mode used for delegation.

## Decision

The active interactive session coordinates the team. The user can designate a current team member as coordinator in project settings. The coordinator’s runtime prompt describes delegation and review for user tasks. Team membership and the existing permission mode govern tool access. The coordinator discovers current teammates and their configured models, assigns work, inspects evidence and requests corrections through the session tools. The tool boundary resolves membership and workspace from the database. Reading, searching and renaming sessions use the same approval policy as sending a task. During a running, database-verified project delivery, an Agent in an automatic mode may inspect team evidence. Manual modes require a user present. The interactive coordinator can wait briefly for its own completion request, review the evidence and send a correction within the same turn. Receiving an asynchronous completion does not authorize another unattended delegation hop.

## Alternatives considered

A second permission selector would duplicate the session’s existing modes. Trusting a project ID supplied by the model would allow project impersonation. Filtering after pagination or after reading messages could disclose snippets or hide permitted results.

## Consequences

A user can intentionally share files through a project workspace or external tools. These rules govern Cherry session tools and delivery. Material previously delivered into an authorized session remains part of its history.

## Verification

- AC1 — `projectTeamConversations.integration.test.ts` uses the production in-process MCP transport and migrated SQLite database to assign work to another Agent, await its frozen completion, read exact evidence and send a correction. Fixture responses exercise delivery without paid provider calls.
- AC2 — The same integration suite covers shared Agents, personal and project sessions, both search paths, copied IDs and membership revocation before dispatch or completion. `cherryAutonomyTools.test.ts` verifies revocation while offloaded tool output is loading.
- AC3 — The Claude guard and Pi approval suites exercise all permission modes. `AgentSessionRuntimeService.test.ts` verifies the exact live delivery turn and observes revoked access. The 15 affected local suites passed 961 tests with two existing Windows-specific skips.
- AC4 — `agentPrompt.test.ts`, `ProjectsDialog.test.tsx`, locale checks and the runtime reference verify the coordination guidance. The combined production build opened its isolated Windows welcome screen and returned 200 from the project endpoint. `AgentProjectService.test.ts` checks that a coordinator belongs to the team and that removing the member clears the assignment.
