# Agent Note: Projects workspace in the sidebar

Status: implemented

English | [中文](2026-11-05-projects-workspace.zh.md)

## Problem

Project management is hidden behind the conversation display menu. Preparing a team requires switching to Agents and Knowledge, then returning to assign the new resources.

## Decision

Projects has its own app entry and route. Its left pane shows the selected project’s team members and their conversations, and its center uses the same conversation shell as Agents. Creating, opening, and forking a project chat keeps the project in the route. The existing Agents project menu opens the same workspace. Projects is included in the default sidebar and is pinned once on upgrade to a nonempty sidebar, preserving the order of existing shortcuts.

The project settings dialog uses the existing agent and knowledge base creation forms. Each successful creation selects the resource, and saving persists the assignment. The dialog also lets the user select a team member as the project coordinator. The current project and membership determine which conversations can open in the workspace.

## Alternatives considered

A second copy of the project editor would duplicate validation and deletion behavior. A separate project-only agent or knowledge storage model would prevent existing resources from being reused and require new data contracts.

## Consequences

Creating a reusable resource and saving a project's assignments are separate operations. Cancelling the project edit leaves the new resource available for later use.

## Verification

- AC1 — Electron 44.9.3 shows Projects in the sidebar of an upgraded isolated profile. The SQLite seeder tests preserve custom order, a subsequent unpin, and an intentionally empty sidebar.
- AC2 — In the Electron project editor, the original draft remains while the agent and knowledge base dialogs create new resources. Saving persists both selected IDs and the same shared workspace. The renderer project test also verifies the explicit selections sent on save.
- AC3 — Renderer tests verify that project chat selection excludes conversations from another project or a removed member, and that starting a chat stays in Projects with the chosen member and workspace. Database tests verify membership checks and coordinator assignment. An isolated Electron 44.9.3 run migrated a populated profile, assigned its coordinator, and opened a new conversation in Projects without changing the Agents display preference.
