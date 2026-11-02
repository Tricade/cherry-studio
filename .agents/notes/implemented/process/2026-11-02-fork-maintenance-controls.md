# Agent Note: Fork maintenance controls

Status: implemented

English | [中文](2026-11-02-fork-maintenance-controls.zh.md)

## Problem

The Tricade fork has no protection for `main`. Its inherited Dependabot configuration checks only GitHub Actions, while vulnerability alerts and security updates are disabled. The pnpm workspace contains version-specific patches that need individual compatibility review.

## Decision

Require pull requests, signed commits and resolved conversations on `main`, including for administrators. Reject force pushes and deletion. Require no outside approval because the fork has a single maintainer; use only CI contexts actually emitted by this fork. The owner explicitly authorized these fork-local controls in the task conversation.

Check npm workspace dependencies and GitHub Actions weekly, with bounded open pull requests. Group ordinary minor and patch updates, leaving patched packages and Electron in individual pull requests. Do not ignore their updates or enable automatic merging. Keep `pnpm-workspace.yaml` patches and overrides authoritative.

Enable vulnerability alerts and Dependabot security updates. GitHub's current [pnpm support documentation](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#pnpm) states that version updates support pnpm 12, but its two-document lockfile is not recognized by the dependency graph. This repository pins pnpm 12.6.0 and uses that format. Enabled settings therefore do not establish alert or security-fix coverage for its lockfile dependencies; preserve the working lockfile and disclose the gap.

Run the existing CI workflow on pushes to every branch using `branches: ["**"]`, while retaining its PR triggers, jobs, permissions and affected-check planner. The fork emitted no PR workflow runs for two independently opened, ready PRs despite active Actions settings and matching triggers. A successful manual baseline run does not satisfy required PR checks under GitHub's current [event eligibility rules](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated); `push` is eligible. This supplies a regular event path for feature, security, Dependabot and upstream-sync branches. The [branch-only filter](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore) excludes tags. The cause of the missing PR events remains undetermined.

The macOS platform job uses the standard `macos-26-intel` runner. Two successive full CI runs could not acquire `macos-latest` runners; both ended with GitHub's explicit macOS arm64 capacity annotation before executing any steps. On 2026-11-02, the [official runner table](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) maps `macos-latest` to macOS 26 arm64 and lists `macos-26-intel` as a standard macOS 26 x64 runner. This preserves the OS major and the unchanged `pnpm check --group platform` selection. The selected native smoke tests accept both Darwin architectures. Intel execution does not prove Apple-Silicon binary or ABI compatibility; that remains separate release verification. Do not treat unavailable runners as successful checks or suppress the platform gate.

## Alternatives considered

Requiring another maintainer's approval would prevent a solo owner from merging their own work. Requiring guessed CI names would leave every PR blocked. Ignoring patched packages would conceal available updates; grouping them into routine updates would hide their patch-rebase work. Changing the lockfile format solely to accommodate GitHub would change a working package-manager contract outside this task. Disabling required checks or substituting a manual dispatch for an eligible event would defeat the intended merge gate.

## Consequences

Dependabot may need manual help rebasing version-specific patches. Required checks must be updated if CI job names change. Upstream synchronization now needs a pull request. Security warnings for the two-document pnpm lockfile remain limited until GitHub supports it or a separately verified dependency submission path is introduced. Branch pushes and PR events can produce separate CI runs when both triggers are delivered; the fork accepts that extra runner work for the additional eligible event path. Existing PR-only policy steps remain PR-only; push checks do not prove those steps ran.

## Verification

- Regression — GitHub REST API 2026-03-10 readback confirms PR requirements, admin enforcement, required signatures, resolved conversations, disabled force pushes/deletion, vulnerability alerts (HTTP 204) and enabled security updates. No outside approval is required.
- Regression — Configuration inspection against the baseline and the coordinated `fix/security-dependencies` workspace confirms all 42 patched package names and Electron are excluded from the ordinary minor/patch group, not ignored. The security work adds `@mistralai/mistralai`, `deepmerge`, `glob` and `minimatch`; two minimatch versions yield 43 patch-version keys for 42 names. Weekly schedules cap version PRs at five for npm and three for GitHub Actions.
- Regression — Pinned pnpm 12.6.0 frozen-lockfile installation, YAML parsing, scoped formatting, documentation checks and diff whitespace checks passed. The affected-check planner was inspected; its full-suite fallback was not run locally for this configuration change.
- Regression — The unchanged CI jobs completed successfully in manual baseline run [41439838545](https://github.com/Tricade/cherry-studio/actions/runs/41439838545) at commit `a5c20d34f2234e9989311ceb62b9d98dc46ac6ef`. This is execution evidence for the baseline, not an eligible PR check. Final push-event execution and merge eligibility must be verified on the published commit.

GitHub scheduling and the dependency graph remain service behavior. Neither YAML checks nor enabled security settings prove complete vulnerability coverage; the documented pnpm 12 limitation still applies.
