# Canvas 材料导入：实现与验收

日期：2026-10-05。前置调查见 [可行性记录](canvas-material-import-feasibility-2026-10-05.md)。本次把经过验证的读取能力接入 CREATE 产品。

## 使用方式

课程 → **Course Materials → Import from Canvas** → 连接 Canvas → 选择教学课程 → 搜索/勾选材料 → **Import selected**。

支持 PDF、DOCX 和 Canvas 页面的正文。每批最多 10 份；文件大小使用现有 `FILE_CONFIG.MAX_FILE_SIZE`，默认 50 MB。页面文本上限 2 MB。首版仅列出 Canvas Teacher enrollment 的课程。

结果逐项显示 Imported / Already present / Import failed。索引在后台运行，材料卡显示处理状态。不会自动生成学习目标或题目。新增内容的 embedding 使用可能产生费用，界面在导入前说明；重复内容跳过保存和索引。

## 代码路径

```text
CourseView → MaterialUpload → CanvasMaterialImportModal
  → src/services/api.ts 的 canvasApi
  → canvasController 挂载 /material-import
  → canvasMaterialImportController
  → canvasMaterialImportService
      → 现有 Canvas connection / UBC toolkit：课程权限、文件下载、页面读取
      → Material / Folder：记录来源、保存新内容
      → processingJobService：并发受限的后台处理
      → ragService：既有解析、页码、分块、embedding 与 Qdrant 索引
```

新增三个 API，均经过 CREATE 身份认证：

```text
GET  /api/create/canvas/material-import/courses?folderId=...
GET  /api/create/canvas/material-import/courses/:courseId/materials?folderId=...
POST /api/create/canvas/material-import/courses/:courseId/materials
     { folderId, resources: [{ id, resourceType: "file" | "page" }] }
```

controller 负责 HTTP 响应，service 负责授权、导入和部分失败。service 使用工厂函数注入 client、模型、存储和处理队列，便于测试失败边界。Canvas 检索作为来源适配层，后续处理复用现有 Material/RAG；没有复制 OAuth 协议或引入新的向量存储。

## 关键设计决策

1. **两层课程授权**：先验证 CREATE Folder 属于当前用户，再验证当前 Canvas 账号的 Teacher enrollment。每次实际导入重新检查，不能只依赖前端课程选择器。文件下载还经过 toolkit 的课程范围详情查询。
2. **按内容跳过重复**：复用 Material checksum。相同内容已在课程中时返回 Already present，不再花 embedding 用量。同一来源同一内容增加数据库唯一索引，处理并发重复提交。
3. **更新保存新快照**：保存 Canvas instance、course ID、resource type/ID、更新时间和导入时间。来源更新后新建 `(Canvas update)` 材料；不覆盖旧材料、引用或教师编辑，也不会自动替换学习对象的材料分配。
4. **限制下载与格式**：逐份下载，限制大小，PDF 检查文件头，DOCX 检查 Word ZIP 结构和解压大小。Canvas 页面去除脚本、样式和 HTML 标签，保存为 text Material。文件使用随机本地名称，保留原文件名用于引用。
5. **失败保留成功项**：返回每份材料的结果；无权限、失效材料、超限等都有可操作说明。文件保存后注册失败会清理该新文件。处理队列无法启动时保留材料并标记失败，可从材料卡 Retry。
6. **不泄露授权信息**：返回列表不包含原始 Canvas response、页面正文或签名链接；保存来源不包含 token、cookie、下载签名。Canvas token 过期返回 409，不触发 CREATE 的 401 登录失效流程。

## 为什么还修改了处理队列

现有 `processingJobService` 的 `isProcessing` 被用于表示“还有任务运行”。当队列超过三项并发上限时，后续 drain 会因为该标志一直为 true 而直接退出，导致余下材料停滞。

现在该标志只保护一次 drain；运行任务通过 `currentJobs` 计数，完成后继续拉取剩余任务。保持三项并发上限，并遵守已有重试时间，避免立即重试失败操作。入队也检查已有排队项，减少重复处理。

## 自动化验收

- 后端 **8 个 suite、228 项测试通过**：Canvas 连接、API/路由、真实 toolkit 契约、导入 service、队列、处理结果和 CREATE Guide 检索。
- 前端 **3 个文件、12 项测试通过**：多选、格式禁用、批次限制、部分失败、保留失败选择、请求期间保护、权限提示、阻止的登录弹窗，以及现有课程/上传功能。
- `npm run build` 通过。保留已有 bundle 大小和混合导入提示。

后端测试命令（在 `routes/create`）：

```sh
RAG_SKIP_AUTO_INIT=true NODE_OPTIONS=--experimental-vm-modules npx jest \
  --config jest.unit.config.js --runInBand --silent \
  __tests__/unit/canvasMaterialImportService.test.js \
  __tests__/unit/canvasMaterialImportContract.test.js \
  __tests__/unit/canvasController.test.js \
  __tests__/unit/canvasApiService.test.js \
  __tests__/unit/canvasToolkitConnection.test.js \
  __tests__/unit/materialProcessingQueue.test.js \
  __tests__/unit/materialProcessingStatus.test.js \
  __tests__/unit/helpKnowledgeService.test.js
```

前端（仓库根目录）：

```sh
npm test -- --run src/components/CanvasMaterialImportModal.test.tsx \
  src/components/MaterialUpload.test.tsx src/components/CourseView.test.tsx
npm run build
```

## 本地真实浏览器验收

使用已有 Faculty 本地测试账号及已有 Canvas 连接，没有更改 Canvas Developer Key 或执行新的权限授权。

Canvas 来源课程：`CREATE Toolkit QA 2026-09-26`，ID `2`。CREATE 目标课程：`QA Canvas material import 2026-10-05`，ID `6ac3ec16464405bbc07bf12e`。只使用合成 PDF、合成 DOCX 以及此前建立的 toolkit 测试页面；未修改真实课程材料。

三种材料通过产品界面导入后均为 completed：

| 来源 | 解析文本字符数 | 已保存 Qdrant 向量 |
| --- | ---: | ---: |
| DOCX | 114 | 1 |
| PDF | 157 | 1 |
| Canvas page | 95 | 1 |

通过只读 Qdrant count API，按各 Material ID 验证向量存在。课程页面显示 **3 ready**，材料卡标明 **Canvas file / Canvas page**。

重复勾选三份材料并再次导入，浏览器显示 **0 imported · 3 already present · 0 failed**；数据库仍然只有三份 Material，全部 completed。单元测试另验证内容变更保留旧版本及部分失败行为。

另用 390 × 844 的窄屏 viewport 验证：导入窗口宽 358px、左右各留 16px，没有横向溢出；结果列表可滚动，底部关闭和导入按钮可见。验收后恢复默认 viewport。

本次真实验收进行了上述小型材料的 embedding/indexing，没有调用题目或学习目标生成。原先只读可行性脚本仍然不会调用 embedding。

本地证据（gitignored）：

- `artifacts/canvas-material-import-2026-10-05/persisted-index-check.json`
- `artifacts/canvas-material-import-2026-10-05/browser-duplicate-import.png`

## 部署条件和当前边界

`CANVAS_SCOPES` 已加入文件列表/详情、public_url、页面列表/正文读取权限。完整配置见 [Canvas 集成文档](../canvas-toolkit-integration.md)。真实 UBC Canvas 需要管理员在 OAuth Developer Key 上允许这些 scopes，旧的 scoped 连接需要重新授权。

没有测试真实 UBC Canvas、持续同步、PowerPoint 转换、OCR、视频/外部工具内容抓取或所有 Canvas 自定义角色。Teacher 以外的角色策略可以作为下一步扩展；不能把所有“可访问课程”直接当作教师课程。本次交付是可使用的批量导入入口，不是定期后台同步服务。
