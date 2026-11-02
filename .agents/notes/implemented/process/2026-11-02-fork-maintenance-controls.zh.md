# Agent Note: 分叉仓库维护控制

Status: implemented

[English](2026-11-02-fork-maintenance-controls.md) | 中文

## 问题

Tricade 分叉仓库尚未保护 `main`。继承的 Dependabot 配置只检查 GitHub Actions，漏洞警报和安全更新均未启用。pnpm 工作区包含与特定版本绑定的补丁，需要单独审查兼容性。

## 决策

要求通过拉取请求修改 `main`，提交必须签名且讨论必须解决，管理员也受这些规则约束。禁止强制推送和删除。由于分叉仓库只有一位维护者，不要求其他人批准；只使用该仓库实际生成的 CI 检查名称。仓库所有者已在任务对话中明确授权这些分叉仓库专用控制。

每周检查 npm 工作区依赖和 GitHub Actions，并限制未合并拉取请求数量。将普通次版本和补丁版本更新分组，带补丁的包和 Electron 则单独创建拉取请求。不忽略它们的更新，也不启用自动合并。`pnpm-workspace.yaml` 中的补丁和覆盖配置仍是兼容性的依据。

启用漏洞警报和 Dependabot 安全更新。GitHub 当前的 [pnpm 支持文档](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories#pnpm)说明，版本更新支持 pnpm 12，但依赖关系图无法识别其双文档锁文件。本仓库固定使用 pnpm 12.6.0，并采用该格式。安全修复合并后，从默认分支导出的 SBOM 仅包含 233 条包记录，并遗漏已知传递依赖，尽管 GitHub 将原有 54 条警报标记为已修复。该状态不能证明覆盖完整。

保留现有可用锁文件，使用固定版本包管理器的原生 `pnpm sbom --lockfile-only --sbom-format cyclonedx --split` 导出。将其 [CycloneDX 1.7](https://cyclonedx.org/docs/1.7/json/) 依赖图转换为 [GitHub 依赖提交 API](https://docs.github.com/en/rest/dependency-graph/dependency-submission?apiVersion=2026-03-10) 格式。保留所有导出的依赖组件及其依赖边，包括平台专用可选依赖，并保留原始包 URL 和版本。拒绝空清单、重复工作区、缺失包 URL、缺失图记录和在所属文档中无法解析的引用。在共享锁文件清单中，将每个 importer 的根节点依赖标记为直接依赖。如果其他图将工作区根节点列为依赖，则保留该根节点的出边；不为未被引用的项目根节点虚构依赖。仅在 GitHub 的 PURL 标识合并包时合并 peer 上下文的依赖边。不猜测运行时或开发用途，也不将补丁编码为新版本。

对每个工作区分别执行原生导出，因为 pnpm 12.6.0 的合并导出可能因 importer 遍历顺序而将工作区依赖边归到应用根节点。Windows 和 Linux 的合并导出在包版本相同的情况下产生了不同的依赖边。[固定版本的 split 实现](https://github.com/pnpm/pnpm/blob/v12.6.0/pnpm/crates/cli/src/cli_args/sbom.rs)每次收集一个 importer；先登记所有依赖组件，再合并各图，避免文件顺序导致工作区根节点的依赖边丢失。这使用包管理器内置选择功能，无需添加自定义锁文件解析器。

在 PR、main 推送和手动运行中，通过只读任务生成快照，不安装应用依赖或运行其脚本。仅为 main 推送或 main 手动运行设置独立任务并授予 `contents: write`；该任务下载同一次运行的产物，不执行检出的应用代码，验证 SHA、ref 和当前 main 提交后向 GitHub 提交。使用稳定的 detector/correlator，并要求 API 明确接受或成功。原生导出覆盖应用及工作区依赖图，不覆盖独立的 pnpm 引导可执行文件图或系统工具链。只有 GitHub 回读才能证明提交的图已建立索引。

按 ref 串行运行，不取消正在进行的提交。若 main 在 SHA 检查后发生变化，较旧的图可能短暂可见，直到排队的新运行提交；生成或提交失败绝不算验证通过。保留原生 SBOM 产物作为来源证据：pnpm 使用包版本 PURL 表示两个 MLX codeload 依赖，其分发 URL 和哈希保留在 SBOM 中，而不在提交的 PURL 图中。

通过 `branches: ["**"]` 在所有分支推送时运行现有 CI 工作流，同时保留 PR 触发器、任务、权限和受影响检查规划器。仓库的 Actions 设置虽然已启用，但单独的 CI 工作流处于 `disabled_fork` 状态；启用该工作流后，PR 和推送自动运行恢复。根据 GitHub 当前的[事件资格规则](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated)，成功的手动基线运行不能满足 PR 必需检查，而 `push` 可以。这样可为功能、安全、Dependabot 和上游同步分支提供常规事件路径。[仅分支过滤器](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore)排除标签。

仅在两个 webhook 凭据均已配置时，才执行飞书失败通知的准备和发送。首个步骤检查其 secret 环境，仅输出 `enabled` 布尔值；后续准备步骤不会收到任一凭据。发送步骤保留独立的 secret 环境。缺少凭据时跳过通知工作，不掩盖验证任务失败。这遵循 GitHub 的[步骤条件与 secret 上下文规则](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsif)。

macOS 平台任务使用标准 `macos-26-intel` runner。连续两次完整 CI 运行均未能获得 `macos-latest` runner；GitHub 明确标注 macOS arm64 容量不足，两个任务都在执行任何步骤前结束。2026-11-02 的[官方 runner 表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)将 `macos-latest` 映射为 macOS 26 arm64，并将 `macos-26-intel` 列为标准 macOS 26 x64 runner。这样保留相同的操作系统主版本，并保持 `pnpm check --group platform` 的选择规则不变。所选原生冒烟测试接受两种 Darwin 架构。Intel 执行不能证明 Apple Silicon 二进制文件或 ABI 的兼容性；这仍需单独的发布验证。不得将 runner 不可用视为检查成功，也不得屏蔽平台门禁。

## 考虑过的替代方案

要求另一位维护者批准会阻止单人维护者合并自己的工作。要求未经确认的 CI 检查名称会阻塞所有拉取请求。忽略带补丁的包会隐藏可用更新；将其并入普通更新组则会掩盖补丁调整工作。仅为了适配 GitHub 而更改锁文件格式，会改变本任务范围之外、已经正常工作的包管理器约定。审查的 Component Detection 解析器只读取一个 YAML 文档；原生 pnpm 导出避免了另写锁文件解析器。审查的 SPDX 提交 action 将应用根节点计入依赖，并仅记录部分 API 失败；小型 CycloneDX 适配器保留原生导出并明确失败。关闭必需检查或用手动触发代替合格事件，会破坏预期的合并门禁。

## 影响

Dependabot 可能需要人工协助调整版本专属补丁。CI 任务更名后，需要更新必需检查。与上游同步现在也需要拉取请求。提交上游版本后，带本地补丁的包可能重新出现漏洞警报；应保留警报及其修复证据，而不是关闭警报或伪装版本。原生 SBOM 不描述本地补丁内容、pnpm 引导二进制文件或已安装机器的工具链。当分支推送和 PR 事件都被投递时，可能各自产生一次 CI 运行；本分叉仓库接受额外执行开销，以获得另一条合格事件路径。现有仅在 PR 中执行的策略步骤仍保持原样；推送检查不能证明这些步骤已运行。

## 验证

- Regression — GitHub REST API 2026-03-10 回读确认了拉取请求要求、管理员约束、提交签名、讨论解决、禁止强制推送和删除、漏洞警报（HTTP 204）及已启用的安全更新。不要求其他人批准。
- Regression — 配置检查确认全部 43 个带补丁的包名及 Electron 均排除在普通次版本和补丁更新组之外，而非被忽略。安全修复新增 `@mistralai/mistralai`、`deepmerge`、`glob`、`minimatch` 和 `zod`；minimatch 和 Zod 各有两个版本，使 43 个包名对应 45 个补丁版本键。每周计划将 npm 版本更新拉取请求限制为五个，GitHub Actions 限制为三个。
- Regression — 固定版本 pnpm 12.6.0 的冻结锁文件安装、YAML 解析、限定文件格式检查、文档检查和差异空白检查均通过。已检查受影响验证计划；未针对本配置变更在本地执行其全套测试回退。
- Regression — 未修改的 CI 任务已在提交 `a5c20d34f2234e9989311ceb62b9d98dc46ac6ef` 的手动基线运行 [41439838545](https://github.com/Tricade/cherry-studio/actions/runs/41439838545) 中成功完成。这证明了基线的实际执行，但不属于合格的 PR 检查。最终仍需在发布的提交上验证推送事件执行和合并资格。
- Regression — 提交适配器的十三个针对性用例保留传递依赖版本、可选平台包、直接依赖关系、不受文档顺序影响的工作区根节点依赖边，以及 peer 上下文依赖边的并集；不完整清单会失败。15 份原生 split 导出与锁文件的全部 importer 及其直接依赖数量一致，包括 ai-core 的 19 条和 system-speech 的五条。合并后得到 2,920 个依赖节点和 6,355 条包间依赖边，包括 Electron、旧版 Zod、deepmerge、glob 和 minimatch。工作流语法通过 actionlint 1.7.12。仅本地生成不能证明 GitHub 已接受快照或建立索引。

GitHub 调度和索引仍属于服务行为。上传成功不代表没有漏洞；提交后应分别验证依赖图覆盖和警报状态。
