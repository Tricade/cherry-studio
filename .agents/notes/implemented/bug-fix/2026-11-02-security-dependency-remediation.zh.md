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

四个发现通过本地补丁修复，不改变无关使用方的 API：

| 包 | 回移修复与运行时入口 |
| --- | --- |
| deepmerge 4.3.1 | 将复制键定义为自身数据属性，防止 `__proto__` 调用目标对象的原型 setter；覆盖源码、CJS 和 UMD 构建 |
| glob 13.0.6 | 在 CJS 和 ESM 中应用上游四处 `return cb()` 中止修复；包根入口指向现有非捆绑入口，因为默认压缩捆绑文件内含旧 walker |
| minimatch 9.0.7 与 10.2.6 | 回移上游的优化器展开上限及二次复杂度去重截止条件；保留两种模块格式和使用方现有主版本 |
| Mistral SDK 1.11.0 / Zod 3.25.76 | 利用单次解析的 ErrorMap 和普通 ZodError，在 OCR HTTP 200/422 响应验证产生 100 条诊断后停止；保持有效 OCR 数组及其他 SDK 操作不变 |

Minimatch 3/5 没有公告所述优化级别 2 预处理路径，但纯版本公告范围仍列出它们。Minimatch 9 保留原有公共类型；回移补丁不声明新的花括号展开 API。

## 考虑过的替代方案

- 仅合并最初四个 Dependabot PR 会留下有漏洞的根依赖与间接副本。
- 将所有依赖强制升级到最新主版本会绕过声明的 API，并丢弃应用补丁。
- 更新 Mistral 并将其 Zod 包替换为 Zod 4 只会隐藏版本告警：SDK 仍导入未修复的 `zod/v3` 兼容实现。
- 忽略公告或为扫描器改写 pnpm 锁文件不能修复运行时行为。

## 影响

最终纯版本审计仍以退出码 1 报告四条记录：一条 Zod 高危、两条 glob/minimatch 中危和一条 deepmerge 低危。列出的漏洞机制已有本地保护及测试；其上游版本号保持不变。没有屏蔽任何公告，也不将审计报告为通过。

**上游依赖仍受影响，Cherry OCR 路径已缓解：** Mistral 1.11.0 → Zod 3.25.76 与 zod-to-json-schema 路径仍受到 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) 影响。含 10,000 个无效元素的受约束数组在 Zod 3.25.76 和 Zod 4.6.6 的 `/v3` 路径上均产生 10,001 条错误，而已修复的 Zod 4 根入口仅产生一条。[官方修复](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) 只修改 v4，[v3 后续问题](https://github.com/colinhacks/zod/issues/6653) 未提供已发布的修复版 v3。

Cherry 的图像/文档处理器调用配置端点的 `ocr.process`。恶意或遭入侵的端点可能返回数千个畸形页面/图像，使每个元素都分配错误对象。补丁使用受支持的 [Zod 3 单次解析 ErrorMap](https://github.com/colinhacks/zod/blob/v3.25.76/packages/zod/src/v3/helpers/parseUtil.ts)，并将其限定在对应的 [SDK 1.11 OCR 操作](https://github.com/mistralai/client-ts/blob/3bae8460c63e9b2091cb644c55a14117d9e86bf8/src/funcs/ocrProcess.ts) 中。第 101 条错误触发包含前 100 条诊断的 ZodError；已有 SDK catch 将其转换为 ResponseValidationError。OCR 成功响应的 schema 没有 union 分支或绕过该回调的显式 message 约束。有效 OCR 输出没有页面数量限制。若全局使用此预算，会拒绝其他操作中有效的 union 响应，因此保留其原有 matcher。

对于 HTTP 422，超过 100 条被丢弃的 union 诊断可能使错误类型从 HTTPValidationError 变为 ResponseValidationError；两者都会拒绝 OCR 请求。这是已接受的错误报告取舍。该缓解措施限制诊断放大，不限制有效原始 HTTP 响应体的大小。独立的上游 Zod 3 API 仍未修复；新 SDK 操作或直接序列化帮助函数的使用方需要单独审查验证逻辑。

回移修复源码依据：[Glob 公告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4)、[Minimatch 修复](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)、[Deepmerge 公告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)。OfficeParser 的 [6.1.0 文档](https://github.com/harshankur/officeParser/blob/v6.1.0/README.md) 和 stream-json 的 [3.x 迁移指南](https://github.com/uhop/stream-json/wiki/Migrating-from-2.x-to-3.x) 说明了使用方的明确迁移方式。

现有文档影响候选描述的架构、迁移格式、提供商契约和发布操作均保持不变，无需语义改写。本次不生成安装器或发布版本。打包应用行为以及 macOS/Linux 执行需另行验证。

## 验证

- Regression — `pnpm test:scripts scripts/__tests__/dependencySecurity.test.ts scripts/__tests__/dependencyCompatibility.test.ts`：Zod 错误数量有界、原型键保持惰性、glob 优化有界、中止后停止目录 I/O、CSV/ANSI 输出、原生 tar 提取及真实回环 HTTP 响应。
- Regression — `pnpm test:scripts scripts/__tests__/mistralOcrValidation.test.ts`：真实 SDK 对 2,000 个畸形页面/图像最多产生 100 条诊断，并覆盖 HTTP 422；256 个有效页面及无关操作中有效的 union 响应仍通过。补丁前两个畸形数组断言失败；补丁后五项测试全部通过。
- Regression — `src/main/data/migration/v2/utils/__tests__/JsonStreamReader.test.ts`：计数、异步批处理、最后的不完整批次、Unicode 及保持惰性的 JSON 原型字段。
- Regression — `src/main/data/db/__tests__/identifierEscaping.test.ts`：标识符不能变为攻击者选择的 SQLite 子查询；使用真实数据库测试框架及生产迁移。
- Regression — `src/renderer/components/RichEditor/__tests__/dependencySecurity.test.ts` 与 `src/main/ai/messages/__tests__/officeParsing.test.ts`：持续阻止可执行属性和继承的 KaTeX trust；合成 DOCX/PDF 文本仍可读取。
