# CREATE、UBC Open Hub 与 H5P 更新维护研究

调研日期：2026-09-26。依据：当前工作区代码、实际扫描本地 library.json 与资源文件、H5P/Lumi/UBC 官方公开资料。没有登录 UBC 管理后台，没有升级运行库或迁移内容。以下版本是本地工作区快照，不代表 CREATE 生产部署；公开示例页不等于 UBC 实时安装清单。

## 结论

建议保留 CREATE 的 Lumi Node.js 集成，优先建设可重复的 H5P 版本发布与验收流程，并与 UBC Open Hub 团队共享版本清单和兼容性测试包。更换为 WordPress 本身不会消除库更新、嵌套依赖、内容迁移与回归测试成本。H5P.com 可以承接托管运维，但需要单独评估 CREATE 的生成内容导入、编辑流程和商业服务集成。

“Lumi 的题型少、UBC 更多、H5P.com 最新”混合了不同层面：

1. **集成层**：CREATE 使用 Lumi 的 Node.js 服务端包；UBC 使用 WordPress H5P 集成；H5P.com 是官方托管服务。
2. **Core / Editor**：浏览器运行与编辑引擎，决定库所要求的 API 是否可用。
3. **Content libraries**：每种活动及共享依赖分别发布，有各自的 major/minor/patch。
4. **内容实例**：教师已经保存的 JSON 与媒体，可能需要 upgrades.js 迁移。
5. **CREATE 产品适配**：AI 生成、证据关联、Review & Edit、容器兼容与导出支持，不会因安装一个题型库自动完成。

Lumi 官方说明其 Node.js 集成使用上游 H5P Core/Editor 的浏览器文件，并提供更新这些文件、配置、资源清单和测试的步骤。因此 Lumi npm 版本与 H5P 内容库版本不是同一个版本号。[Lumi Core updates](https://docs.lumi.education/development/core-updates)

## 1. CREATE 的实际状态

本次直接调用 readStudioLibraries()/buildStudioCatalog()，并读取 package-lock.json：

| 项目 | 本地结果 | 意义 |
| --- | --- | --- |
| Lumi 包 | h5p-server 10.0.4、h5p-react 10.0.4、h5p-express 10.0.5 | 服务端/前端集成版本 |
| Core / Editor | Core API 1.28；manifest 固定上游 moodle-1.28.2 | 已有独立升级，不是仍完全受默认 1.27 限制 |
| 已发现库目录 | 118 | 包含共享依赖、编辑器依赖与多个 minor，不是 118 种题型 |
| Studio 去重活动类型 | 37 | 24 个 generate、12 个 template、1 个 unavailable |
| 常规 Generate Questions | 16 个类型 | 更深的 CREATE 原生产品适配，与 Studio 的统计口径不同 |
| manifest 中的 library 条目 | 10 | 现有来源/哈希记录是良好起点，但尚未覆盖全部 118 个目录 |

Studio 的 generate/template 是当前目录和校验逻辑给出的能力分类，**不代表已逐一验证所有活动的教学正确性、可访问性及跨平台播放**。

当前 GitHub latest release 是 Lumi v10.0.5，发布时间为 2026-03-12；发布说明是 h5p-express 的流关闭修复。这也不足以支持“CREATE 整个 Lumi 集成落后很多版本”的判断。[官方 release](https://github.com/Lumieducation/H5P-Nodejs-library/releases/tag/v10.0.5)

### 具体维护缺口

- `H5P.InteractiveBook 1.13` 存在目录和描述文件，但缺少 dist/h5p-interactive-book.js 与 CSS；Studio 因此选用健康的 1.11.8。
- `H5P.Dictation 1.4` 同样缺少编译后的 JS/CSS；Studio 选用 1.3.9。
- Studio 选择 Column 1.20、Question Set 1.21；常规 Quiz 导出映射仍固定 Column 1.18、Question Set 1.20。两条路径具有不同版本策略，新增库不会自动统一它们。
- 普通作者无安装/升级库权限，这是当前明确的产品策略。目录返回值还把可用本地库标为 `isUpToDate: true`、`canInstall: false`，因此该字段不能被管理员当成“已与官方最新版本比较”的结果。
- 安装的 Lumi H5PConfig 仍默认使用 `https://api.h5p.org/v1/content-types/` 和 `/v1/sites`；CREATE 初始化未覆盖这些地址。官方已宣布更新到 `hub-api.h5p.org`。应验证新地址、注册响应格式、错误处理和缓存刷新。**本次没有执行 Hub 注册或联网安装，不能认定旧地址已导致线上故障。**

对应代码：

- [运行时版本](../routes/create/config/h5pRuntime.js)
- [来源及资源哈希](../routes/create/config/h5p-runtime-manifest.json)
- [Lumi 初始化、权限与目录过滤](../routes/create/services/lumiService.js)
- [Studio 目录发现与依赖检查](../routes/create/services/h5pStudioCatalog.js)
- [常规导出库映射](../routes/create/config/h5pLibraryRegistry.js)
- [前端题型矩阵](../src/constants/questionTypeCapabilities.ts)
- [既有升级验收记录](plans/branching-runtime-upgrade.md)

GitHub 原始仓库不一定携带编译产物。H5P 官方 Interactive Video 仓库明确说明：下载源码后仍需构建、打包才是可安装库。这与本地“描述文件存在、dist 缺失”的风险直接相关。[官方构建说明](https://github.com/h5p/h5p-interactive-video)

## 2. UBC Open Hub 是怎样工作的

UBC 自己的维护页面明确提到 H5P WordPress integration；入门说明使用 `H5P Content > Add new`，再通过 embed 嵌入 Canvas 或其他网站。[UBC 恢复机制](https://h5p.open.ubc.ca/recovering-deleted-h5p-content/)、[UBC 入门](https://h5p.open.ubc.ca/getting-started-with-h5p/)

可确认其基于 WordPress H5P 集成。按官方插件的标准机制，其分工是：

```text
H5P 官方 Content Type Hub
        ↓ 获取目录、下载题型与依赖
WordPress H5P 插件 + 本地安装的 Core / Editor / Libraries
        ↓ 保存、编辑、渲染活动
UBC H5P 活动页面 → iframe/embed → Canvas 或其他网页
```

这里的“调用 H5P API”主要可以指获取题型目录和安装包；不能由此推断 UBC 把编辑和播放交给 H5P.com 云端。H5P Content Type Hub、OER 内容分享 Hub、UBC Open Hub 是不同概念。具体 UBC 自定义实现仍需运维团队确认。[官方 Content Type Hub](https://h5p.org/node/56694)

UBC 首页写 45 种活动；Examples 页面列出 CREATE 当前目录没有的活动标签，例如 Image Pairing、Image Sequencing、Speak the Words、Advent Calendar、Personality Quiz、KewAr Code。它还列出 Tweeter Feed，而 CREATE 明确禁用了 Twitter User Feed。因此这份页面适合做需求对照，不能作为逐项可用性或版本新旧的证明。[UBC 首页](https://h5p.open.ubc.ca/)、[UBC 题型示例](https://h5p.open.ubc.ca/h5p-examples/)

公开证据能支持“UBC 也承担额外维护工作”：2022 年记录过复杂活动保存缓慢导致重复发布，并开发了内容恢复功能。这些是历史问题与修复记录，**不是当前题型更新滞后的证据**。没有找到足以确认其当前版本维护流程、积压量或最新库清单的公开资料。[复杂内容发布问题](https://h5p.open.ubc.ca/publishing-or-updating-complex-h5p-content-can-lead-to-duplicate-content/)

## 3. 为什么维护会反复出问题

### 四种“更新”必须分别处理

| 更新动作 | 实际改变 | 不应误以为 |
| --- | --- | --- |
| 更新 WordPress 插件或 Lumi 包 | 平台集成与其包含/引用的引擎能力 | 所有题型都已升级 |
| 刷新 Content Type Cache | 可下载题型及版本目录 | 新库已安装 |
| 安装/更新 libraries | 本地可执行 JS/CSS、semantics 与依赖 | 已保存内容全部迁到新版本 |
| 升级内容实例 | 按迁移脚本转换已有内容结构与引用 | 可以靠修改 JSON 版本字符串完成 |

官方将目录缓存刷新与库安装分开；跨 major/minor 的内容结构变更通过 upgrades.js 处理。[缓存机制](https://h5p.org/node/56690)、[内容升级规范](https://h5p.org/node/883)

具体风险来自共享依赖和嵌套容器：更新 H5P.Question 或 JoubelUI 可能影响多个题型；升级父容器可能迁移内部子活动。major/minor 可以并存，但同一 major/minor 的 patch 常在共享目录被替换，所以“保留旧 minor”并不能隔离所有更新。需要保留整个可恢复发布版本，包括库、内容和数据库状态。

2026 年的官方变动说明这不仅是 CREATE 的问题：

- 2 月开源版更新带来 Core/共享组件/UI 变化，并迁移 Content Type Hub 域名。[官方公告](https://h5p.org/h5p-february-2026-update)
- WordPress 插件 changelog 记录了 1.17 系列对缺失文件、库目录命名、新 Hub 注册响应、重复库目录、依赖参数过滤等问题的连续修复。[官方插件 changelog](https://wordpress.org/plugins/h5p/)

CREATE 现有排错记录也记载过：为让较新库导入 Lumi 而降低 coreApi 声明，导致不兼容库进入 Lumi 全局库目录并影响其他包。后续必须避免篡改版本声明来绕过兼容性校验。[项目历史记录](h5p-lumi-library-troubleshooting.md)

## 4. H5P.com 能解决什么

官方托管服务承担平台更新、备份和内容升级。其官方产品页面还列出实时 polling 与 The Chase 等专属能力。这些不能默认通过同步开源 libraries 获得。[H5P.com 官方产品说明](https://echo.h5p.com/)

“最新”也不意味着全部功能同时发布、全部已有内容立即切换。2026 年官方发布说明明确采用分批推出新界面、管理员预览及控制启用的方式。[2026 年 2 月发布说明](https://help.h5p.com/hc/en-us/articles/33829345654173-Release-note-February-2026)

对于 CREATE，应分别验证：生成的 .h5p 能否导入、是否能保留编辑能力、媒体处理、LTI/成绩回传以及是否存在适合程序化创建/更新内容的受支持接口。**有 LTI 并不自动意味着有通用内容 CRUD API。** 本次未核实 CREATE 可直接使用的 H5P.com 自动发布接口与商业授权条件，不能据此提出无缝迁移承诺。

## 5. 推荐的维护方案

### A. 用一个完整清单管理可复现发布

扩展现有 manifest，覆盖全部发布库。每个库记录 machineName、major/minor/patch、coreApi、上游版本/commit、来源包与 SHA-256、依赖闭包、构建步骤、局部补丁、验收状态。明确记录“官方已发布”“CREATE 已安装”“CREATE 已验收”三个不同状态。

把预览、Studio 编辑和导出使用的库组合纳入同一发布计划；允许有经过说明和测试的不同配置，但不能让差异只藏在各自代码中。

### B. 自动发现候选更新，经过验证再发布

建议由仓库 CI 按固定周期执行只读比较，生成版本差异和受影响内容类型报告；候选包进入隔离目录。新 Hub API 适配应先通过测试，随后才启用这种检测。此处是建议，没有创建定时任务。

流程：

```text
检查官方更新 → 下载候选完整包/按固定版本构建 → 解析全部依赖
→ 校验描述、JS/CSS及媒体资源 → staging 内容/浏览器回归
→ 审阅变更与内容影响 → 发布固定版本 → 保留整体回滚快照
```

保留普通教师不能安装可执行库的边界；把维护能力放在管理员工作流或 CI。将 `isUpToDate: true` 与真正的上游比较状态分离。

### C. 增加内容迁移与影响分析

记录活动使用哪些库、哪些嵌套版本；升级前列出受影响内容。major/minor 迁移使用 upstream upgrades.js，在副本上 dry-run；新内容可以先用新版本，旧内容分批升级。不要假定降级脚本存在，回滚依赖内容与数据库备份。未确认所有引用消失之前保留旧库。

### D. 验收覆盖整个使用链

复用现有 `h5pLibraryAssets.test.js`、`h5pRuntimeUpgrade.test.js`、Studio/media round-trip 测试和 `e2e/h5p-type-matrix.spec.ts`，补齐：

1. 库文件及 runtime/editor/dynamic 依赖完整性。
2. 新活动编辑、保存、重新打开。
3. 实际播放、答案反馈、计分、重新开始、媒体保留。
4. Column、Book、Question Set 的受支持子题型组合。
5. 历史内容升级前后对照。
6. 导出 → 干净独立测试平台导入 → 编辑 → 播放 → 再导出。
7. 重点题型的键盘操作与可访问性检查。

目录校验通过或在 CREATE 内播放通过，不等于已经通过 UBC/WordPress 或 Lumi Desktop 的互操作验收。

### E. 新题型分层提供

先支持原生导入/编辑/播放，再开放 Studio 模板或 AI 草稿；只有当语义转换、学习目标/证据关联、Review & Edit 与导出完整时，才接入常规 Generate Questions。用明确的能力标记替代一个含糊的“支持题型数”。

优先修复已经存在但不完整的库，再根据教学需求评估 UBC 中 CREATE 缺少的题型；每个新类型仍需检查上游可获取性、依赖与目标容器，不应一次性全开放。

## 6. 与 UBC 团队如何合作

最有价值的合作成果是共享“经过验证的一组版本 + 一套测试活动”，而不是从 UBC 随机下载几个示例后复制其库。

建议向 UBC 运维索取或共同建立：

1. WordPress/H5P 插件/Core/Editor 版本，以及完整 library major/minor/patch 清单。
2. Hub 地址、缓存刷新计划、安装权限、更新来源与 staging/发布节奏。
3. 当前失败案例：下载失败、安装失败、保存升级失败还是播放失败；对应最小复现包。
4. 库与内容快照、回滚流程、历史内容数量及迁移策略。
5. WordPress 集成的本地补丁和可共享测试环境。
6. CREATE 与 UBC 共同认可的导入、编辑、播放、导出测试包和兼容版本矩阵。

CREATE 与 UBC 可以共享上游库来源、包哈希、变更说明和互操作 fixtures，同时保留各自的 Node.js/WordPress 集成。

| 路线 | 适合的情况 | 主要代价 |
| --- | --- | --- |
| 保留 Lumi，建设发布流程（优先） | 继续深度整合 CREATE AI、证据和自有编辑流程 | 自己负责库验收与内容迁移 |
| 与 UBC 共建维护和兼容基线（并行推进） | 两团队都自托管 H5P | 需要明确维护责任、发布节奏与共享接口 |
| 单独 WordPress H5P 服务 | 愿意承担第二套应用，且能复用已有成熟运维 | 账号、内容同步、嵌入、媒体与部署集成 |
| H5P.com 托管 | 愿意采购服务，将平台更新交给供应商 | 费用、工作流适配、接口可用性与组织要求需确认 |

## 建议先做的交付

第一项工程任务是只读的 **H5P inventory + compatibility report**：输出当前完整版本、未编译库、依赖问题、manifest 未覆盖项、上游版本差异和受影响产品路径。随后用一组包含嵌套活动与媒体的 fixtures 建立跨 CREATE/WordPress 的发布门槛，再推进库升级及更多题型。这样每一次更新都能解释“改了什么、影响谁、如何验证、如何恢复”。
