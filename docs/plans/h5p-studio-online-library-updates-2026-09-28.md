# H5P Studio 在线题型更新与自动加载设计

日期：2026-09-28。范围：CREATE 自托管的 H5P Studio **官方编辑器**。本文不承诺新增题型可由 CREATE AI 自动生成，也不接入 H5P.com 专有活动。

## 结论与现状

可以让管理员在网页上检查、准备和启用来自官方开源 H5P Hub 的题型，让新建编辑器会话自动看到已启用的题型。必须把“发现更新”“下载验证”“发布”“在编辑器中启用”分成不同状态；下载成功不是可用证明。

目前 Studio 从 `routes/create/h5p-libs` 读取库，Lumi 的 `FileLibraryStorage` 也指向同一目录。Lumi 的目录读取会重新扫描文件系统，但 CREATE 的 `getStudioCatalog()` 缓存 30 秒，且目录根路径写死在源码目录。官方编辑器的选择器只保留本地目录中 `mode !== 'unavailable'` 的活动。普通作者没有安装 H5P 可执行库的权限。Lumi 10 的 Hub URL 默认仍是旧的 `api.h5p.org`，而 2026 年起新版本发布到 `hub-api.h5p.org`。

本地隔离验证：在同一个 `FileLibraryStorage` 实例使用的临时目录中加入官方 `H5P.Flashcards 1.7.23` 与所需新依赖后，`getInstalledLibraryNames()` 从 118 个目录变为 119 个；Studio 目录从 36 个可用活动变为 37 个，Flashcards 的依赖/资源检查无错误。这证明**文件存储和 Studio 目录可以动态发现新活动**。尚未验证真实浏览器中的编辑、保存、预览、导出，也未发布到 CREATE 工作目录。

## 产品流程

只向 CREATE 管理员显示 **Studio → Library management**：

1. **Check Hub**：读取官方 Hub 元数据，并与当前可用、已安装和禁用的库比较。显示来源、machine name、版本、维护状态、依赖和 Core 要求。不能把网页抓取的展示清单当作可安装包清单。
2. **Prepare candidate**：管理员选一个 machine name。后台任务仅从固定的官方 Hub 主机下载包，沿用现有 `scripts/h5p/maintain.py` 的解包、哈希、ZIP 安全和依赖检查；保存不可变候选、差异和受影响题型。不能接受任意 URL 或作者上传的库。
3. **Validate**：在隔离环境运行编辑器创建/保存、播放、媒体、导出/重导入和现有内容回归。若更换共享依赖、要求更高 Core、缺浏览器资源或测试失败，标为 blocked，并给出具体原因。
4. **Activate**：管理员查看结果后启用。系统发布到持久化库储存，更新 active manifest；新开的编辑器会话在刷新目录后自动看到题型。页面显示“已启用”及发布时间、版本和验证结果。
5. **Disable / rollback**：暂停新建时从选择器隐藏题型，但保留已经创建内容依赖的库和资产。完整回滚需要恢复相配套的库、内容和数据库快照；不能直接删除仍在使用的目录。

```mermaid
flowchart LR
    A[Admin: Check Hub] --> B[Download to staging]
    B --> C[Static and dependency checks]
    C --> D[Isolated browser regression]
    D --> E{Ready?}
    E -- no --> F[Blocked report]
    E -- yes --> G[Admin activates release]
    G --> H[Shared library storage + active manifest]
    H --> I[Catalog refresh]
    I --> J[New Studio editor session sees type]
```

## 第一阶段：仅热启用新题型

第一阶段的上线边界是：候选可以**新增**目录，但不能替换任何现有 `machineName-major.minor` 目录或改变 Core/Editor。候选包里携带的已有共享依赖补丁只有在隔离测试证明可以继续使用当前安装版本时才能保留旧版；否则此候选进入第二阶段流程。这个条件对 Flashcards 尤其重要，其官方包包含 JoubelUI 和 VerticalTabs 的较新补丁。

将库根目录改为部署外的持久化共享卷，例如 `H5P_LIBRARY_ROOT`，首次安装从仓库内已锁定的基础库初始化。Lumi 和 Studio catalog 必须读取**同一个**根目录。候选写入独立 staging 目录，完成检查后先原子发布缺少的非 runnable 依赖，再发布 runnable 目录；最后写入数据库中的启用记录/manifest 版本。目录出现并不自动公开：Studio catalog 和 Lumi 选择器还要检查启用记录。这样中途失败不会把半安装题型展示给作者。

为 `getStudioCatalog()` 增加显式失效和 active manifest 版本检查，避免等 30 秒 TTL；跨实例通过共享卷和数据库版本同步，实例尚未看到完整目录时返回暂不可用，不发布不完整库。已打开的编辑器在下一次进入或刷新后显示新题型。Lumi 的本地库枚举重新读取目录，所以这一阶段可以不重启 Node 服务。浏览器仍须刷新旧编辑器页面。

第一阶段验证目标：在一台隔离 CREATE 环境中通过网页启用 Flashcards；`New blank activity` 出现该类型，能创建、保存、预览、下载 `.h5p` 并重新导入；原有题型的基本编辑/预览测试仍通过。若 Flashcards 在保留现有共享依赖版本时不能工作，则不能把它当作热启用示例，应先选一个无共享替换的候选或进入第二阶段。

## 第二阶段：在线升级已有题型

更新已有目录，尤其替换同一 major/minor 的 patch 或 JoubelUI、Question、Components 等共享依赖，会改变当前内容和已打开页面的运行资产。Lumi 的 `LibraryManager.updateLibrary()` 会清除旧文件，出错时甚至删除该库，因此不能直接对生产活动目录调用它。

使用不可变的完整 library release 快照（当前基础库约 45 MB），记录 SHA-256、来源、依赖和受影响内容；在隔离环境验证之后切换 active release。要实现无中断热切换，需要按 release ID 路由浏览器资产，并给现有内容记录/渲染固定的 library release；否则旧页面的一组请求可能跨越切换边界。若暂不实现 release-aware 资产和内容固定，第二阶段应由网页发起受控滚动重启/短暂维护窗口，在新会话启用版本，且先对历史内容做回归和迁移评估。Core/Editor 浏览器文件仍应走应用部署，不纳入在线库更新按钮。

## 接口与数据边界

- `GET /api/create/admin/h5p-libraries`：已安装、可用、禁用、上游候选、active release、验证结果。
- `POST /api/create/admin/h5p-libraries/check`：启动只读 Hub 对比任务。
- `POST /api/create/admin/h5p-libraries/candidates`：仅接受经校验的 machine name，创建异步 staging/验证任务。
- `GET /api/create/admin/h5p-libraries/candidates/:id`：轮询状态、差异、阻塞原因和测试证据。
- `POST /api/create/admin/h5p-libraries/candidates/:id/activate`：仅在 ready 且基础版本未漂移时提交；重复请求幂等。
- `POST /api/create/admin/h5p-libraries/:machineName/disable`：禁止新建，保留已有内容播放。

这些端点沿用现有管理员身份检查，并限制并发任务和下载大小。存档只保存 machine name、版本、哈希、操作者、时间、状态和测试结果；不记录课程材料、题目文本、用户密钥或 Hub 凭据。`H5PContent` 在第二阶段加入创建/上次迁移时的 library release ID。多实例需要共享持久化库卷或等效对象存储，不能各自在容器本地更新。

Studio 目录的“官方编辑器可创建”和“CREATE AI 可生成”应拆开表示。新库通过验证后可先作为 **manual editor only** 启用；AI、Quiz 蓝图、Canvas、评分和导出能力需要各自的适配及验证，不能从 `runnable: true` 推断。

## 实施顺序与验收

1. 抽出统一的 library root、安装状态模型、目录失效机制和管理员只读清单；保持现有 36 种的行为。
2. 接入现有候选准备器与隔离验证任务；所有外网输入固定指向官方 Hub。先只产生候选，不改活动目录。
3. 完成新目录的持久化发布、启用门禁、跨实例同步和禁用流程，用 Flashcards 或无共享补丁的候选做端到端试点。
4. 建立完整 release 快照、旧内容固定/迁移和滚动切换，才开放更新现有库的在线激活。
5. 扩展目标清单，逐批验证缺少的公开类型。ALPHA、长期不维护、依赖外部服务或更高 Core 的类型可显示为 blocked，不以数量达标代替质量验收。

验收必须覆盖：未授权作者不能安装库；下载/解包失败不影响旧目录；半安装不可见；刷新后新题型出现；真实编辑、保存、预览、导出/导入成功；旧内容仍可播放；并发启用仅提交一次；多实例一致；禁用后旧内容继续可访问。

参考：[开源 Hub 迁移](https://h5p.org/h5p-february-2026-update)、[Lumi 库安装安全](https://docs.lumi.education/advanced-usage/security)、[Lumi 项目状态](https://docs.lumi.education/development/status)、[CREATE 现有维护流水线](../h5p-maintenance-pipeline.md)。
