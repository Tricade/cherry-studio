# Agent Note: Projects workspace in the sidebar

Status: implemented

English | [中文](2026-11-05-projects-workspace.zh.md)

## Problem

Project management is hidden behind the conversation display menu. Preparing a team requires switching to Agents and Knowledge, then returning to assign the new resources.

## Decision

Projects has its own app entry and a page for project definitions and conversations. The existing Agents project menu links to the same page. Projects is included in the default sidebar and is pinned once on upgrade to a nonempty sidebar, preserving the order of existing shortcuts.

The editor uses the existing agent and knowledge base creation forms. In the project editor, each successful creation selects the new resource for the project. Saving the project persists the selection. The agent wizard takes shared knowledge from the project settings instead of setting global knowledge for this step. Project sessions open in the existing agent conversation view.

## Alternatives considered

A second copy of the project editor would duplicate validation and deletion behavior. A separate project-only agent or knowledge storage model would prevent existing resources from being reused and require new data contracts.

## Consequences

Creating a reusable resource and saving a project's assignments are separate operations. Cancelling the project edit leaves the new resource available for later use.

## Verification

- AC1 — Electron 44.9.3 shows Projects in the sidebar of an upgraded isolated profile. The SQLite seeder tests preserve custom order, a subsequent unpin, and an intentionally empty sidebar.
- AC2 — In the Electron project editor, the original draft remains while the agent and knowledge base dialogs create new resources. Saving persists both selected IDs and the same shared workspace. The renderer project test also verifies the explicit selections sent on save.
- AC3 — Electron opens the saved project through the existing Agents menu and starts the chosen agent in the same project. The session record and rendered conversation confirm the project, member and workspace. Renderer and database tests cover project start and membership.
