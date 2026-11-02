# Agent Note: Private project workspaces and provider quotas

Status: proposed

English | [中文](2026-11-02-private-project-workspaces.zh.md)

## Problem

Rendering diagrams and link icons can contact remote services without a separate user action. Browser observations can expose query and fragment secrets. Diagnostic uploads lack a content preview and category selection; update and backup controls do not explain all transmitted data. Agent sessions lack a project container, and token analytics do not represent subscription quotas.

## Proposal

Keep diagram rendering and decorative link icons local. Remove credentials, queries and fragments from model-facing browser URL metadata, including relative link destinations; retain actual navigation and element references. This does not promise to redact arbitrary page content or secrets embedded in URL paths.

Use the MIT `@plantuml/core` npm engine pinned to `1.2026.9` with bundled themes, emoji, icons and Viz. Run it in a local sandboxed HTML asset with a restrictive CSP, disabled external resource loaders and sanitized offline SVG output. External includes and downloaded standard libraries are unsupported; no remote rendering fallback is allowed.

Prepare diagnostics locally from explicitly selected categories, show the exact prepared archive contents and destination, and require confirmation before uploading that same archive. Make scheduled update checks switchable with an accurate disclosure of request metadata and region lookup. Show backup contents, credentials, destination, archive protection and remote transmission alongside manual and scheduled controls.

Add read-only provider quota reports to Usage, keeping token analytics separate. Show provider-reported used percentages, windows, resets, model or shared-bucket scope, and available credit or voucher information. Included subscription consumption has zero additional usage cost; paid extra usage remains separate. Missing data is unavailable, never estimated from tokens. Read only the selected account or verified matching account; never redeem credits or expand login permissions.

Quota refresh is manual and transient. Codex uses an installed CLI's `account/rateLimits/read` with strict Cherry account matching, checked against the official `rust-v0.166.0-alpha.5.1` protocol. Claude uses the pinned `0.3.284` SDK's experimental usage control with `skipBehaviors: true`, no input prompt, and the existing CLI login profile. CherryIN returns raw balance units without a profile request and rejects a changed credential. Other sign-ins report unsupported. Unknown currency scales remain raw provider units; existing token price estimates remain API-equivalent analytics rather than subscription invoices. Managed Claude policy hooks remain subject to the SDK's policy precedence.

Add projects containing reusable agent memberships, instructions, a workspace and shared knowledge bases. Sessions belong to at most one project. Project sessions use only the project's explicitly selected knowledge scope; an agent's global knowledge bindings are not copied into a project. Existing non-project sessions retain their behavior. Project membership does not imply autonomous orchestration.

Each project owns one registered user workspace, which cannot be reassigned after creation. Forks and agent-created child sessions keep the project and require current team membership. Removing a member retains history but disables new turns until re-added. Identity and memory live separately per project and Agent under `Data/Projects/<projectId>/<agentId>`; only instructions, workspace files and selected KBs are shared. Connections reconcile edited project facts at the next turn, and project follow-ups queue rather than steer. Project and workspace deletion refuse live or trashed session references; external workspace files are retained. Orphan sweep reclaims unreferenced internal project memory with the existing freshness and restore safeguards. Full backups include that memory; slim backups omit it, while both retain project definitions and history. These rules scope automatically supplied context, not explicit external tools or filesystem permissions.

The owner additionally requested provider model limits and safe Pi transport recovery. Preserve valid provider-reported input/output limits through listing and storage without replacing explicit user overrides or adding input and output limits into an invented context window. Pi transport retries remain native before visible output; after nonempty text/reasoning or a started tool, stop on failure while preserving the partial result. Restore the previous in-memory retry policy only after the whole prompt settles. Separate length/compaction recovery remains native.

The fork owner authorized this implementation directly in the task conversation. This fork-specific authorization does not claim upstream Spec approval. The initial baseline was `61120d19e1af69c9bd9c93b5620143b448a1df0a`; the fork and implementation were subsequently synchronized with upstream `4d1af48cdb68039c67bec71a05c0ce3190b1ebde`. Node `24.18.1`, pnpm `12.6.0`, Electron `44.9.3` and Claude Agent SDK `0.3.284` are pinned by the repository.

## Alternatives considered

Keeping remote renderers behind silent fallbacks preserves the data leak. A list of known secret parameter names misses unknown names. Previewing source counts before rebuilding a diagnostic archive cannot guarantee that the user reviewed the submitted content. Estimating quota percentages from token counts misrepresents provider limits. Copying agents into each project loses reusability, while globally changing their knowledge bindings leaks context between projects.

## Acceptance criteria

- AC1 — Diagram previews render locally and cannot fetch diagram includes, images or other resources from the network. (verification: unit | renderer | packaged artifact)
- AC2 — Browser URL metadata omits credentials, query strings and fragments for absolute and relative links while element actions remain available. (verification: unit | Electron)
- AC3 — Rendering link icons contacts neither third-party icon providers nor linked websites, including when an old remote cache exists. (verification: renderer)
- AC4 — Diagnostic upload requires category selection, an exact content preview and explicit confirmation; changing the selection invalidates the prepared upload. (verification: unit | renderer)
- AC5 — Update controls explain recipients and transmitted metadata, and disabling scheduled checks stops those checks while explicit checks remain available. (verification: unit | renderer)
- AC6 — Local and remote backup controls disclose contents, credentials, lack of archive encryption, destination and remote transfer before use. (verification: renderer)
- AC7 — Usage displays authentic supported provider quotas with resets and scope, separately from tokens and paid extra usage; unknown or mismatched accounts never receive invented values. (verification: unit | renderer)
- AC8 — Projects reuse existing agents, group sessions and share project instructions, workspace files and explicitly selected knowledge without exposing another project's context. (verification: unit | renderer | Electron)
- AC9 — Existing sessions, data and backup restoration survive appended database migrations and the new optional project association. (verification: unit)
- AC10 — Valid provider model limits survive listing and persistence without overwriting explicit settings or inventing a combined context window. (verification: unit | renderer)
- AC11 — Pi retries eligible pre-output failures but preserves visible partial responses without automatic replay; future explicit turns and existing retry settings remain usable. (verification: unit | native SDK)

## Risks

Removing URL parameters reduces information available to models; element references preserve navigation without reconstructing secret-bearing URLs. Local PlantUML needs a bundled engine and strict resource isolation. Diagnostic previews can themselves contain private text and must stay local until confirmation. Provider quota APIs vary by login method and version; unavailable capabilities must remain explicit. Projects share a physical workspace deliberately, so deletion must not remove referenced files. No test gate alone proves that an installed application never transmits unintended data.
