# Agent Note: 依赖安全修复

Status: implemented

[English](2026-11-02-security-dependency-remediation.md) | 中文

## 问题

2026-11-02 对分支基线 `4d1af48cdb68039c67bec71a05c0ce3190b1ebde` 的审计报告包含 55 个包的 268 条安全公告/版本记录：8 条严重、102 条高危、137 条中危、21 条低危。这些是依赖发现，并非 268 个已证实的应用漏洞。GitHub 的清单告警无法覆盖 pnpm 12 多文档锁文件的完整依赖图。

安装基线为 Node 24.18.1、pnpm 12.6.0、Electron 44.9.3、React/React DOM 19.2.3 和 Vitest 5.0.1。修改依赖之前，23 个明确指定的使用方测试文件中的 350 项测试通过。修复版本和 API 兼容性依据官方公告、对应版本发布包清单和相关标签源码确定。

## 决策

保持 Node、pnpm 和 Electron 的固定版本。更新所有工作区清单中的易受攻击直接依赖，并用 pnpm 12.6.0 解析锁文件。解析编辑器的可选 peer 依赖时，保留已验证的 React/React DOM 版本组合。

| 范围 | 修复 |
| --- | --- |
| HTTP 与更新传输 | 各现有版本系列使用 Undici 6.29.1、7.30.1、8.12.2；Axios 1.20.0；builder-util-runtime 9.7.0；MCP SDK 1.32.2 及其支持的 Hono Node 适配器 2.1.3 |
| 文档与图像 | OfficeParser 6.1.0 移除不再维护的 decompress/file-type 16 依赖链；调用 `parseOffice().toText()`；sharp 0.35.5 与匹配的 libvips 1.3.4；adm-zip 0.6.1 |
| PDF 与迁移 JSON | OfficeParser 的间接 PDF.js 为 6.2.108；旧版 FileStorage 使用已有本地 PDF 文本帮助函数，避免 OfficeParser 在 Windows 上的 worker 路径故障；stream-json 3.7.0 使用明确的 Node 流适配器 |
| 编辑器与验证 | Tiptap 全系列 3.30.5，并移植三个现有应用补丁；KaTeX 0.18.2；DOMPurify 3.4.17；ProseMirror view 1.42.3；直接依赖 Zod 4.6.6；Drizzle ORM 0.45.2 |
| 开发工具 | Vite 8.2.4、PostCSS 8.5.23、Vitest 全系列 5.0.5 和 Storybook 全系列 10.6.2；其他兼容的间接依赖修复限制在对应版本系列内 |
| 发布工作流 | 将易受攻击的 Claude Code Action 1.0.66 替换为已核实标签 1.0.74 对应的不可变提交 `e8a10097822e6f144836f796638943264a37b637` |

CSV 读取器以默认选项调用 `parse`；原生安装器使用 tar 的 `create`/流式 `extract`；ExcelJS/gaxios 使用 UUID `v4`；ANSI 渲染使用 linkify 工厂、`tlds` 和 `match`。仅针对父依赖的 override 保留这些具体 API，同时升级到 csv-parse 7.0.3、tar 7.5.21、UUID 11.1.1 和 linkify-it 5.0.2。合成使用方测试覆盖实际的依赖解析路径。

Vitest 5.0.5 要求同一执行组中的项目使用相同的 `maxWorkers`。`aiCore` 项目继承其包配置而非根配置，因此显式接收共享的根限制：本地两个 worker，CI 中为 50%。其独立包配置保持不变。划分不同执行组会使无关项目串行运行，却没有解决配置继承缺失。RichEditor 高亮测试通过 `CodeStyleProvider` 挂载真实的 `EditorContent`：在 React 宿主挂载前，Tiptap 3.30.5 只提供不执行渲染的 React node-view 占位元素。单独创建核心 `Editor` 已无法代表应用的生命周期。依据：[Vitest 5.0.5 执行组顺序](https://github.com/vitest-dev/vitest/blob/v5.0.5/docs/config/sequence.md)、[Tiptap 3.30.5 React node view](https://github.com/ueberdosis/tiptap/blob/v3.30.5/packages/react/src/ReactNodeViewRenderer.tsx)。

Markdown 源码行定位测试使用多行段落填充，使序列化测试不启动无人管理的异步高亮 worker。Vitest 的 worker 模拟可能在 JSDOM 环境销毁后才投递响应。专门的高亮测试套件保留真实 worker 覆盖，并最多等待十秒获取初始语法输出，与其已有冷启动用例一致；重新安装依赖后，一秒默认等待曾超时。

三个剩余发现继续使用本地补丁，等待其使用方迁移。Zod 捆绑的兼容 API 与 Mistral OCR 操作也保留针对性保护：

| 包 | 回移修复与运行时入口 |
| --- | --- |
| deepmerge 4.3.1 | 将复制键定义为自身数据属性，防止 `__proto__` 调用目标对象的原型 setter；覆盖源码、CJS 和 UMD 构建 |
| glob 13.0.6 | 在 CJS 和 ESM 中应用上游四处 `return cb()` 中止修复；包根入口指向现有非捆绑入口，因为默认压缩捆绑文件内含旧 walker |
| minimatch 9.0.7 与 10.2.6 | 回移上游的优化器展开上限及二次复杂度去重截止条件；保留两种模块格式和使用方现有主版本 |
| Zod 4.6.6 的 v3 兼容 API | 在访问元素前拒绝超过大小上限的数组/集合；覆盖源码、CJS 和 ESM，并保留已有大小诊断 |
| Mistral SDK 2.7.0 OCR | 将独立 Zod 3 依赖迁移到 Zod 4.6.6；先以公开的提前中止 API 验证 HTTP 200/422 响应体，再正常解析有效输出；畸形输出仅产生一条诊断 |

Minimatch 3/5 没有公告所述优化级别 2 预处理路径，但纯版本公告范围仍列出它们。Minimatch 9 保留原有公共类型；回移补丁不声明新的花括号展开 API。

## 考虑过的替代方案

- 仅合并最初四个 Dependabot PR 会留下有漏洞的根依赖与间接副本。
- 将所有依赖强制升级到最新主版本会绕过声明的 API，并丢弃应用补丁。
- 仅将 Mistral 1.11.0 的依赖 override 为 Zod 4，仍会使用 `zod/v3` 解析器。Mistral 2.7.0 实际使用 `zod/v4`；这一较小升级保留所用 OCR/文件 API，无需升级到 SDK 3.5.0。其声明的 Zod 范围也允许 v3，因此用仅针对父依赖的 override 选择 4.6.6。Zod 4 捆绑的 v3 兼容解析器仍需保留回移修复。
- 忽略公告或为扫描器改写 pnpm 锁文件不能修复运行时行为。

## 影响

Mistral 迁移后，纯版本审计以退出码 1 报告三条记录：两条 glob/minimatch 中危和一条 deepmerge 低危。解析后的锁文件中已无独立 Zod 3.25.76 包。剩余漏洞机制已有本地保护及测试，上游版本号保持不变。没有屏蔽任何公告，也不将审计报告为通过。

**移除 Zod 3 依赖，保留捆绑兼容解析器保护：** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) 报告的 Mistral 1.11.0 → Zod 3.25.76 路径已替换为 Mistral 2.7.0 → Zod 4.6.6。在原回移修复前，含 10,000 个无效元素的受约束数组在 Zod 3.25.76 和 Zod 4.6.6 的 `/v3` 路径上均产生 10,001 条错误，而已修复的 Zod 4 根入口仅产生一条。[官方修复](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) 只修改 v4，[v3 后续问题](https://github.com/colinhacks/zod/issues/6653) 未提供已发布的修复版 v3。剩余兼容解析器保留已验证的提前拒绝机制，移除已不再使用的独立包补丁。

超过 `.max()` 或 `.length()` 的数组，以及超过 `.max()` 或 `.size()` 的集合，会保留已有大小错误，并在解析元素或执行外层 refinement 前停止，同步和异步路径均如此。数组的重叠上限保留两条大小诊断。处于边界的有效值、仅有下限或无大小限制的集合、转换以及有效 union 分支保持原有行为。Zod 3 的 map 没有大小约束 API。这些补丁不设置全局错误预算或原始响应体大小限制；调用方仍需为不可信集合设置边界。

Cherry 的图像/文档处理器调用配置端点的 `ocr.process`。恶意或遭入侵的端点可能返回数千个畸形页面/图像，使每个元素都分配错误对象。[Zod 4.6.6 的公开 `validate`](https://github.com/colinhacks/zod/blob/v4.6.6/packages/zod/src/v4/core/parse.ts) 在首个无效元素处停止；普通错误回调在原始错误累积后才执行，无法实现旧 ErrorMap 的预算。因此，[SDK 2.7.0 OCR 操作](https://github.com/mistralai/client-ts/blob/v2.7.0/src/funcs/ocrProcess.ts) 先检查有效性，失败时抛出只有一条错误的 ZodError，有效响应则正常解析以保留字段转换。有效输出会遍历两次，不增加页面或字节上限。其他 SDK matcher 保持不变。

畸形 HTTP 200/422 输出现在产生带一条通用诊断的 ResponseValidationError，而非最多 100 条详细诊断。有效的结构化 HTTP 422 响应仍产生保留 API 详情的 HTTPValidationError。这是已接受的错误报告取舍。该缓解措施限制诊断放大，不限制原始 HTTP 响应体大小。新 SDK 操作或直接序列化帮助函数的使用方仍需单独审查验证逻辑。

回移修复源码依据：[Glob 公告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4)、[Minimatch 修复](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)、[Deepmerge 公告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)。OfficeParser 的 [6.1.0 文档](https://github.com/harshankur/officeParser/blob/v6.1.0/README.md) 和 stream-json 的 [3.x 迁移指南](https://github.com/uhop/stream-json/wiki/Migrating-from-2.x-to-3.x) 说明了使用方的明确迁移方式。

现有文档影响候选描述的架构、迁移格式、提供商契约和发布操作均保持不变，无需语义改写。本次不生成安装器或发布版本。打包应用行为以及 macOS/Linux 执行需另行验证。

## 验证

- Regression — `pnpm test:scripts scripts/__tests__/dependencySecurity.test.ts scripts/__tests__/dependencyCompatibility.test.ts`：Zod 错误数量有界、原型键保持惰性、glob 优化有界、中止后停止目录 I/O、CSV/ANSI 输出、原生 tar 提取及真实回环 HTTP 响应。
- Regression — `pnpm test:scripts scripts/__tests__/mistralOcrValidation.test.ts`：十项用例覆盖畸形页面、嵌套图像和 HTTP 422 的提前停止、诊断上限、256 个有效页面、结构化 API 错误、无关操作的有效 union 响应，以及真实 SDK 的上传/签名 URL/删除传输，包括端点、认证和取消信号传播。移植保护前，SDK 2.7.0 访问全部 2,000 个无效元素，当时六项用例中四项失败；补丁后十项全部通过。
- Regression — `scripts/__tests__/legacyZodCollectionBounds.test.ts`：保留的 24 项用例覆盖 Zod 4 捆绑 v3 解析器的 CJS/ESM 入口、同步/异步数组与集合上限、超限输入不执行元素操作、转换、下限、union 后续有效分支以及嵌套/重叠诊断。仅移除针对已删除独立 Zod 3 包的测试。
- Compatibility — 现有 Mistral 工具/文档处理器测试的九项用例以及 `pnpm typecheck:node` 均通过。单独的 CommonJS 测试在 Electron 44.9.3 的 Node 24.22.0 运行时加载 ESM SDK，并转换有效的合成 OCR 响应；这不等于完整应用或安装器测试。SDK 遥测保持未配置状态；其可选 exporter peer 要求 0.220.x，而应用提供 0.200.x，因此显式开启这一未使用的 SDK 遥测路径不在本次验证范围内。
- Regression — `src/main/data/migration/v2/utils/__tests__/JsonStreamReader.test.ts`：计数、异步批处理、最后的不完整批次、Unicode 及保持惰性的 JSON 原型字段。
- Regression — `src/main/data/db/__tests__/identifierEscaping.test.ts`：标识符不能变为攻击者选择的 SQLite 子查询；使用真实数据库测试框架及生产迁移。
- Regression — `src/renderer/components/RichEditor/__tests__/dependencySecurity.test.ts` 与 `src/main/ai/messages/__tests__/officeParsing.test.ts`：持续阻止可执行属性和继承的 KaTeX trust；合成 DOCX/PDF 文本仍可读取。
- Regression — `CI=true pnpm exec vitest run --project aiCore --project ai-sdk-provider packages/aiCore/src/core/providers/__tests__/ExtensionRegistry.test.ts packages/ai-sdk-provider/src/__tests__/cherryin-provider.test.ts`：原配置在发现测试前即失败；共享 worker 限制使两个项目一起运行，99 项测试通过。挂载 React 编辑器后，现有 `codeHighlight.test.ts` 的五项测试通过，保留高亮、源文本、选区及撤销行为，且没有未处理的 React 错误。
