# Agent Note: Dependency security remediation

Status: implemented

English | [中文](2026-11-02-security-dependency-remediation.zh.md)

## Problem

The audit of fork base `4d1af48cdb68039c67bec71a05c0ce3190b1ebde` on 2026-11-02 reports 268 advisory/version records across 55 packages: 8 critical, 102 high, 137 moderate and 21 low. These are dependency findings, not 268 demonstrated application exploits. GitHub's manifest alerts do not cover the complete pnpm 12 multi-document lockfile graph.

The installed baseline is Node 24.18.1, pnpm 12.6.0, Electron 44.9.3, React/React DOM 19.2.3 and Vitest 5.0.1. Before changing dependencies, 350 tests in 23 explicitly selected consumer files pass. Official advisories, exact published package manifests and the relevant tagged sources determine the fixed versions and API compatibility.

## Decision

Keep Node, pnpm and Electron pinned. Update vulnerable direct dependencies in every workspace manifest and resolve the lockfile with pnpm 12.6.0. Preserve the tested React/React DOM pair when resolving optional editor peers.

| Area | Repair |
| --- | --- |
| HTTP and update transport | Undici 6.29.1, 7.30.1 and 8.12.2 in their existing version families; Axios 1.20.0; builder-util-runtime 9.7.0; MCP SDK 1.32.2 and its supported Hono Node adapter 2.1.3 |
| Documents and images | OfficeParser 6.1.0 removes the unmaintained decompress/file-type 16 stack; consume `parseOffice().toText()`; sharp 0.35.5 and matching libvips 1.3.4; adm-zip 0.6.1 |
| PDF and migration JSON | OfficeParser's transitive PDF.js is 6.2.108; legacy FileStorage uses the existing local PDF text helper, avoiding OfficeParser's Windows worker-path failure; stream-json 3.7.0 uses its explicit Node stream adapters |
| Editor and validation | Tiptap family 3.30.5 with all three existing app patches ported; KaTeX 0.18.2; DOMPurify 3.4.17; ProseMirror view 1.42.3; direct Zod 4.6.6; Drizzle ORM 0.45.2 |
| Development tools | Vite 8.2.4, PostCSS 8.5.23, Vitest family 5.0.5 and Storybook family 10.6.2; remaining compatible transitive fixes are bounded by version family |
| Release workflow | Replace vulnerable Claude Code Action 1.0.66 with verified tag 1.0.74's immutable commit `e8a10097822e6f144836f796638943264a37b637` |

The CSV reader uses `parse` with its default options; the native installer uses tar `create`/streaming `extract`; ExcelJS/gaxios use UUID `v4`; ANSI rendering uses the linkify factory, `tlds` and `match`. Parent-scoped overrides retain those concrete APIs while moving to csv-parse 7.0.3, tar 7.5.21, UUID 11.1.1 and linkify-it 5.0.2. Synthetic consumer tests exercise their actual dependency resolution.

Four findings use local patches instead of changing unrelated consumer APIs:

| Package | Backport and runtime entry |
| --- | --- |
| deepmerge 4.3.1 | Define copied keys as own data properties so `__proto__` cannot invoke the destination's prototype setter; patch source, CJS and UMD builds |
| glob 13.0.6 | Apply the four upstream `return cb()` abort fixes in CJS and ESM; point the package root at its existing unbundled entry, because the default minified bundle embeds the old walker |
| minimatch 9.0.7 and 10.2.6 | Backport upstream's optimizer expansion cap and the cutoff for quadratic deduplication; preserve both module formats and existing major-version consumers |
| Mistral SDK 1.11.0 / Zod 3.25.76 | Stop OCR HTTP 200/422 response validation after 100 diagnostic issues, using a per-parse ErrorMap and a normal ZodError; leave valid OCR arrays and other SDK operations unchanged |

Minimatch 3/5 lack the reported optimization-level-2 preprocessing path. The version-only advisory range still lists them. Minimatch 9 keeps its original public types; the backport does not advertise a new brace-expansion API.

## Alternatives considered

- Merging only the four initial Dependabot PRs leaves vulnerable root and transitive copies.
- Forcing every dependency to its newest major bypasses declared APIs and discards app patches.
- Updating Mistral and replacing its Zod package with Zod 4 only hides a version finding: the SDK still imports the unpatched `zod/v3` compatibility implementation.
- Ignoring advisories or rewriting pnpm's lockfile for a scanner would not repair runtime behavior.

## Consequences

The final version-only audit still exits 1 with four records: one high Zod finding, two moderate glob/minimatch findings and one low deepmerge finding. The listed mechanisms have tested local protections; their upstream version numbers remain unchanged. No advisory is suppressed, and the audit is not reported as green.

**Upstream dependency still affected, Cherry OCR path mitigated:** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) remains on Mistral 1.11.0 → Zod 3.25.76 and zod-to-json-schema. A 10,000-element invalid constrained array produces 10,001 issues through both Zod 3.25.76 and Zod 4.6.6's `/v3` path; patched Zod 4's root produces one. The [official fix](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd) changes v4 only, and the [v3 follow-up](https://github.com/colinhacks/zod/issues/6653) does not provide a published fixed v3 release.

Cherry's image/document processors call `ocr.process` against a configured endpoint. A malicious or compromised endpoint could return thousands of malformed pages/images and cause an issue-object allocation for each item. The patch uses the supported [Zod 3 per-parse ErrorMap](https://github.com/colinhacks/zod/blob/v3.25.76/packages/zod/src/v3/helpers/parseUtil.ts) in the exact [SDK 1.11 OCR operation](https://github.com/mistralai/client-ts/blob/3bae8460c63e9b2091cb644c55a14117d9e86bf8/src/funcs/ocrProcess.ts). At issue 101 it throws a ZodError containing the first 100 diagnostics; the existing SDK catch returns ResponseValidationError. The OCR success schemas have no union alternatives or explicit-message constraints that bypass that hook. Valid OCR output gets no page limit. Applying the budget globally would reject valid union responses in other operations, so their matcher remains unchanged.

For HTTP 422, more than 100 discarded union diagnostics may produce ResponseValidationError instead of HTTPValidationError; both reject the OCR request. This is an accepted error-reporting tradeoff. This mitigation bounds diagnostic amplification, not the size of a valid raw HTTP body. The standalone upstream Zod 3 API remains unpatched; new SDK operations or direct serialization-helper consumers need their own validation review.

Source evidence for backports: [Glob advisory](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4), [Minimatch fix](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8), [Deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4). OfficeParser's [6.1.0 documentation](https://github.com/harshankur/officeParser/blob/v6.1.0/README.md) and stream-json's [3.x migration guide](https://github.com/uhop/stream-json/wiki/Migrating-from-2.x-to-3.x) explain the explicit consumer migrations.

The existing docs impact candidates describe unchanged architecture, migration format, provider contracts and release operations; they need no semantic rewrite. No installer or release is produced. Packaged application behavior and macOS/Linux execution require separate verification.

## Verification

- Regression — `pnpm test:scripts scripts/__tests__/dependencySecurity.test.ts scripts/__tests__/dependencyCompatibility.test.ts`: bounded Zod errors, inert prototype keys, bounded glob optimization, stopped directory I/O after abort, CSV/ANSI output, native tar extraction and real loopback HTTP response.
- Regression — `pnpm test:scripts scripts/__tests__/mistralOcrValidation.test.ts`: the real SDK rejects 2,000 malformed pages/images with at most 100 diagnostics and covers HTTP 422; 256 valid pages and unrelated valid union responses still pass. The two malformed-array assertions failed before the patch; all five tests pass after it.
- Regression — `src/main/data/migration/v2/utils/__tests__/JsonStreamReader.test.ts`: counts, asynchronous batches, partial batches, Unicode and inert JSON prototype fields.
- Regression — `src/main/data/db/__tests__/identifierEscaping.test.ts`: an identifier cannot become an attacker-selected SQLite subquery; uses production migrations in the real database harness.
- Regression — `src/renderer/components/RichEditor/__tests__/dependencySecurity.test.ts` and `src/main/ai/messages/__tests__/officeParsing.test.ts`: executable attributes and inherited KaTeX trust stay blocked; synthetic DOCX/PDF text remains readable.
