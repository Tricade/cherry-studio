# Agent Note: Project team conversations

Status: proposed

English | [中文](2026-11-03-project-team-conversations.zh.md)

## Problem

This extends the project session ownership defined in [Private project workspaces](2026-11-02-private-project-workspaces.md).

Agents can delegate a task and receive its result, but the session tools discover and read conversations outside the caller’s project. Reading chat history also bypasses the approval mode used for delegation.

## Proposal

Use the active interactive session as the coordinator. Users select its Agent and model when starting the project session. List the current teammates and their configured models; let the coordinator assign work, inspect evidence and request corrections through the existing session tools. Resolve membership and workspace from the database at the tool boundary. Apply the same approval policy as sending a task to tools that read, search or rename sessions. During a running, database-verified project delivery, an Agent in an automatic mode may inspect team evidence. Manual modes require a user present. The interactive coordinator can wait briefly for its own completion request, review the evidence and send a correction within the same turn. Receiving an asynchronous completion does not authorize another unattended delegation hop.

## Alternatives considered

A second permission selector would duplicate the session’s existing modes. Trusting a project ID supplied by the model would allow project impersonation. Filtering after pagination or after reading messages could disclose snippets or hide permitted results.

## Acceptance criteria

- AC1 — A coordinator can find a project teammate, send a task, receive its completion and read that teammate’s project conversation. (verification: database integration and MCP)
- AC2 — Direct IDs, search results, metadata, workspace reuse and pending deliveries cannot grant project conversation access across projects or to a removed member. Personal sessions retain access to ordinary non-project conversations. (verification: database integration and MCP)
- AC3 — Claude and Pi apply their existing delegation approval modes to conversation inspection. Full Access cannot override the project boundary, and headless turns cannot start another delegation. (verification: runtime guard tests)
- AC4 — The project instructions and tool descriptions explain how to coordinate and review work; results and chat text are evidence rather than instructions. (verification: prompt and docs)

## Risks

A user can intentionally share files through a project workspace or external tools. These rules govern Cherry session tools and delivery. Material previously delivered into an authorized session remains part of its history.
