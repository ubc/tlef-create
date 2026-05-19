# Bugs & Lessons Learned

## H5P Export

### 新 content type 必须加进 `standaloneTypes`
**文件**: `h5pExportService.js`
**错误**: 新类型导出时被包在 `H5P.Column` 里，`mainLibrary` 变成 `H5P.Column`，Lumi 无法识别。
**规则**: 每新增一个 standalone H5P 类型，必须同时加入 `standaloneTypes` 白名单。

### `library.json` 的 `editorDependencies` 不应打包进导出文件
**文件**: `h5p-libs/*/library.json`
**错误**: 编辑器库（`H5PEditor.*`）被打包进 `.h5p` 文件，Lumi 找不到它们报 `install-missing-libraries`。
**规则**: 本地 library.json 的 `editorDependencies` 置为 `[]`，播放器不需要编辑器库。

### `coreApi` 版本必须与本地 H5P core 匹配
**文件**: `h5p-libs/*/library.json`
**错误**: 库声明 `coreApi: 1.28`，但服务器 core 是 `1.27`，导出时报 `api-version-unsupported`。
**规则**: 本地库的 `coreApi.minorVersion` 不能高于服务器实际运行的 core 版本。

---

## H5P BranchingScenario

### `nextContentId` 必须与 `h5pContent[]` 数组下标对应
**文件**: `h5pExportService.js`
**错误**: nodes 未按 `index` 排序就 map，导致 `nextContentId` 指向错误位置，分支循环跑不完。
**规则**: export 前必须 `.sort((a, b) => a.index - b.index)`，保证数组下标 === node.index。

### 判断 intro 节点用 `node.index === 0`，不要用 `node.question === null`
**文件**: `h5pExportService.js`, `BranchingScenarioTreeView.tsx`
**错误**: LLM 有时对叶层节点也返回 `question: null`，导致叶层被误识别为 AdvancedText，`nextContentId` 被硬编码为 1，分支死循环。
**规则**: 只有 `index === 0` 才是 intro text 节点。

### `nextContentId: -1` = 结局，`nextContentId: 0` = 回到 intro（错误）
**文件**: `llmService.js`
**错误**: LLM 有时用 `0` 代替 `-1` 表示结束，导致 H5P 跳回 intro 死循环，tree view 出现 "Introduction" 末节点。
**规则**: 后处理时把 `nextContentId === 0` 和指向空节点（`question: null`）的 alternative 全部重定向为 `-1`。

---

## Mongoose

### Mongoose strict mode 会静默丢弃未声明的字段
**文件**: `models/Question.js`
**错误**: `content.introText` 和 `content.nodes` 未在 schema 里声明，保存时被 Mongoose 静默丢弃，导致生成的数据消失。
**规则**: 新 question type 的所有 content 字段必须显式加进 `content` subdocument schema。

---

## H5P Core

### `getVerifiedStatementValue` 不自动创建中间对象
**文件**: `h5p-core/h5p-core.js`
**错误**: `setObject` 只设置 `statement.object`，不初始化 `definition`，后续访问 `statement.object.definition.*` 报 TypeError。
**规则**: `getVerifiedStatementValue` 遍历 key 链时，遇到 `undefined` 需自动创建 `{}`，不能直接返回。
