# Agent Note: Projects workspace in the sidebar

Status: proposed

English | [中文](2026-11-05-projects-workspace.zh.md)

## Problem

Project management is hidden behind the conversation display menu. Preparing a team requires switching to Agents and Knowledge, then returning to assign the new resources.

## Proposal

Give Projects its own app entry and a page for the existing project definitions and project conversations. Link the existing Agents project menu to that page. Pin Projects alongside existing sidebar shortcuts once on upgrade and include it in the default sidebar.

Use the existing agent and knowledge base creation forms. In the project editor, each successful creation selects the new resource for the project. Saving the project persists the selection. The agent wizard takes shared knowledge from the project settings instead of setting global knowledge for this step. Start or reopen an existing project session using the existing agent conversation view.

## Alternatives considered

A second copy of the project editor would duplicate validation and deletion behavior. A separate project-only agent or knowledge storage model would prevent existing resources from being reused and require new data contracts.

## Acceptance criteria

- AC1 — Projects appears in the left sidebar, and saved shortcuts keep their order and can still be changed after upgrading (verification: Electron and database tests)
- AC2 — Creating an agent or a knowledge base from an open project selects it in the current editor and retains the other edits; saving persists the assignment (verification: renderer and Electron)
- AC3 — Project conversations open with their existing project and workspace, and the Agents project menu opens the same project page (verification: renderer and Electron)

## Risks

Creating a reusable resource and saving a project's assignments are separate operations. Cancelling the project edit leaves the new resource available for later use.
