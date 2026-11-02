# Agent Note: 分叉仓库维护控制

Status: implemented

[English](2026-11-02-fork-maintenance-controls.md) | 中文

## 问题

Tricade 分叉仓库尚未保护 `main`。继承的 Dependabot 配置只检查 GitHub Actions，漏洞警报和安全更新均未启用。pnpm 工作区包含与特定版本绑定的补丁，需要单独审查兼容性。

## 决策

要求通过拉取请求修改 `main`，提交必须签名且讨论必须解决，管理员也受这些规则约束。禁止强制推送和删除。由于分叉仓库只有一位维护者，不要求其他人批准；只使用该仓库实际生成的 CI 检查名称。仓库所有者已在任务对话中明确授权这些分叉仓库专用控制。

每周检查 npm 工作区依赖和 GitHub Actions，并限制未合并拉取请求数量。将普通次版本和补丁版本更新分组，带补丁的包和 Electron 则单独创建拉取请求。不忽略它们的更新，也不启用自动合并。`pnpm-workspace.yaml` 中的补丁和覆盖配置仍是兼容性的依据。

启用漏洞警报和 Dependabot 安全更新。GitHub 当前的 [pnpm 支持文档](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#pnpm)说明，版本更新支持 pnpm 12，但依赖关系图无法识别其双文档锁文件。本仓库固定使用 pnpm 12.6.0，并采用该格式。因此，启用设置并不能证明锁文件依赖已获得警报或安全修复覆盖；保留现有可用锁文件，并明确说明这一限制。

通过 `branches: ["**"]` 在所有分支推送时运行现有 CI 工作流，同时保留 PR 触发器、任务、权限和受影响检查规划器。虽然 Actions 已启用且触发器匹配，两个分别创建、已就绪的 PR 均未产生 PR 工作流运行。根据 GitHub 当前的[事件资格规则](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated)，成功的手动基线运行不能满足 PR 必需检查，而 `push` 可以。这样可为功能、安全、Dependabot 和上游同步分支提供常规事件路径。[仅分支过滤器](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore)排除标签。PR 事件缺失的原因尚未确定。

## 考虑过的替代方案

要求另一位维护者批准会阻止单人维护者合并自己的工作。要求未经确认的 CI 检查名称会阻塞所有拉取请求。忽略带补丁的包会隐藏可用更新；将其并入普通更新组则会掩盖补丁调整工作。仅为了适配 GitHub 而更改锁文件格式，会改变本任务范围之外、已经正常工作的包管理器约定。关闭必需检查或用手动触发代替合格事件，会破坏预期的合并门禁。

## 影响

Dependabot 可能需要人工协助调整版本专属补丁。CI 任务更名后，需要更新必需检查。与上游同步现在也需要拉取请求。在 GitHub 支持双文档 pnpm 锁文件或引入另行验证的依赖提交方式之前，其安全警报覆盖仍有限。当分支推送和 PR 事件都被投递时，可能各自产生一次 CI 运行；本分叉仓库接受额外执行开销，以获得另一条合格事件路径。现有仅在 PR 中执行的策略步骤仍保持原样；推送检查不能证明这些步骤已运行。

## 验证

- Regression — GitHub REST API 2026-03-10 回读确认了拉取请求要求、管理员约束、提交签名、讨论解决、禁止强制推送和删除、漏洞警报（HTTP 204）及已启用的安全更新。不要求其他人批准。
- Regression — 对照基线与已协调的 `fix/security-dependencies` 工作区检查配置，确认全部 42 个带补丁的包名及 Electron 均排除在普通次版本和补丁更新组之外，而非被忽略。安全修复新增 `@mistralai/mistralai`、`deepmerge`、`glob` 和 `minimatch`；minimatch 的两个版本使 42 个包名对应 43 个补丁版本键。每周计划将 npm 版本更新拉取请求限制为五个，GitHub Actions 限制为三个。
- Regression — 固定版本 pnpm 12.6.0 的冻结锁文件安装、YAML 解析、限定文件格式检查、文档检查和差异空白检查均通过。已检查受影响验证计划；未针对本配置变更在本地执行其全套测试回退。
- Regression — 未修改的 CI 任务已在提交 `a5c20d34f2234e9989311ceb62b9d98dc46ac6ef` 的手动基线运行 [41439838545](https://github.com/Tricade/cherry-studio/actions/runs/41439838545) 中成功完成。这证明了基线的实际执行，但不属于合格的 PR 检查。最终仍需在发布的提交上验证推送事件执行和合并资格。

GitHub 调度和依赖关系图仍属于服务行为。YAML 检查或启用的安全设置都不能证明完整的漏洞覆盖；文档所述 pnpm 12 限制仍然适用。
