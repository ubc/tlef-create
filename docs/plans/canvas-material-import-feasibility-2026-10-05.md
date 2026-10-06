# Canvas 课程材料导入：可行性测试记录

日期：2026-10-05。范围：验证教师授权后，CREATE 能否读取 Canvas 材料并复用现有解析流程。

## 结论

**技术上可行，本地 API → PDF 下载 → CREATE 文件检查 → PDF 解析已验证。**

当前产品还没有 Canvas 材料导入界面、导入 API 或持续同步任务。本次没有创建 CREATE Material、进行向量索引或生成题目，不能称为完整产品导入验收。真实 UBC Canvas 的 Developer Key、权限及文件存储仍需测试。

## 实际测试环境和结果

使用已有本地 Canvas `http://localhost`、已保存的 Faculty Canvas 连接、官方 UBC LMS toolkit 1.4.0，以及现有 CREATE 服务。连接按现有流程刷新了过期 token；没有记录 token、cookie、下载签名或页面正文。

测试课程：`CREATE Toolkit QA 2026-09-26`，Canvas course ID `2`。课程原本没有文件，因此通过 toolkit 上传了一个 **1,459 字节的合成 PDF**，文件 ID `4`，名称 `CREATE Canvas import QA 2026-10-05.pdf`。该文件不含真实教学或学生资料，保留在本地 QA 课程供复测。

| 检查 | 实际结果 |
| --- | --- |
| 教师课程列表 | 成功读取 2 门 teacher 课程，确认目标课程在其中 |
| 课程文件列表 | 成功找到合成 PDF |
| Canvas Pages 正文 | 成功读取 1 个页面的非空 HTML 正文 |
| Modules 目录 | 2 个模块、3 个条目，类型为 Page / ExternalTool |
| 签名下载链接 | `public_url` 接口成功返回链接，链接没有输出到日志 |
| 下载完整性 | 下载内容 SHA-256 与原 PDF 完全一致 |
| CREATE 文件检查 | PDF MIME、文件名、大小通过现有 `FileService.validateFile` |
| CREATE PDF 解析 | `QuizRAGService.parsePdfPages` 提取 1 页、157 个字符 |
| 下载大小限制 | 设置 1 字节上限后返回 413 |

以上 **8 项现场检查通过**。测试 **0 次 LLM 调用、0 次 embedding 调用**，没有模型 API 消费。正式导入后的向量索引可能有费用，取决于配置的 embedding provider。

另新增 9 项 toolkit 契约测试，验证：文件分页、课程范围校验、签名下载不携带认证、403 权限失败、声明及实际大小超限、下载不完整、登录 HTML 响应和异常下载域名。加上已有 Canvas 测试，**4 个 suite、39/39 tests 通过**。

## 为什么本地成功还不能直接上线

`canvasToolkitConnection.js` 的当前 `CANVAS_SCOPES` 以课程导出为主，缺少文件列表、文件详情、签名链接和页面读取权限。本地旧连接能调用这些接口，不证明带有 Enforce Scopes 的 UBC Developer Key 也能调用。

支持本次读取范围，需要在现有 scopes 基础上评估并授权：

```text
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/courses/:course_id/files/:id
url:GET|/api/v1/files/:id/public_url
url:GET|/api/v1/courses/:course_id/pages
url:GET|/api/v1/courses/:course_id/pages/:url_or_id
url:GET|/api/v1/courses/:course_id/modules/:module_id/items
```

课程和模块列表读取 scope 已存在。权限变更后需要按实际授权配置重新连接。导入不需要 Canvas 文件上传/删除权限；本次上传仅用于建立本地测试夹具。

下载建议使用 toolkit 的 `via: 'public-url'`，它先确认文件属于课程，再下载签名链接。普通 `/files/:id/download` 不属于 `/api/v1` scope 路径，开启 Enforce Scopes 的 key 可能拒绝；toolkit 的 fallback 不能替代缺失的权限验证。

现有 `canvasApiService.listCourses()` 没有指定教师过滤，不能把“可访问课程”直接当作“教师管理课程”。本次脚本明确使用 `enrollment_type: 'teacher'`。产品版还需明确 TA、designer、admin 的规则，并在每次导入时检查 Canvas 课程权限及 CREATE Folder 所有权。

## 首版建议与格式边界

教师连接 Canvas → 选择课程 → 看到可导入文件/页面 → 选择材料 → 批量导入 → 查看每份材料的处理状态。这可以省去手工下载、再上传。

- **PDF**：本次实际验证了下载、文件检查及文本解析；扫描 PDF/OCR 未验证。
- **DOCX**：现有 CREATE 材料类型包含 DOCX，可作为首版候选，但本次没有验证 Canvas DOCX 下载和解析。
- **Canvas Pages**：实际验证读取 HTML；还需正文转文本、来源记录和 Material 持久化。
- **PPTX、视频、外部工具**：不是当前已验证的材料解析范围。PPTX 不在现有上传 MIME 白名单，不能承诺直接使用；ExternalTool 条目能列出，不等于可以读取第三方工具内容。

“首次批量导入”和“以后自动同步更新”应分开交付。持续同步还需要变更检测、失败恢复、授权失效处理、重复导入控制，以及避免覆盖教师在 CREATE 的编辑。

## 如何在现有架构上实现

保持 controller 薄：认证/参数/Folder 所有权检查，交给独立 Canvas 材料导入服务。服务复用现有 toolkit 下载和材料处理边界，不复制 OAuth 或自行 fetch 任意 URL。

以 `Canvas instance + course ID + resource type + resource ID` 标识来源，保存更新时间和内容 checksum。相同来源、相同内容跳过；有更新时明确呈现版本。Pages 适配为文本材料，PDF/DOCX 适配为现有文件材料，再进入共同处理流程。这样未来增加材料来源可以增加适配器，不必重写解析和索引逻辑。

应保留原文件名、Canvas 来源及 PDF 页码供题目引用。限制单文件大小、批次大小和处理并发；失败按材料展示，成功项保留。分页和 HTTP 403 必须正确处理，不能把无权限解释为“没有材料”。

## 复现

脚本只允许本地 Canvas；不上传文件、不创建 CREATE Material、不调用模型。它会使用已有加密连接，并可能按正常授权流程刷新 token。参数中的 CREATE user 必须有该本地 Canvas 连接。

在仓库根目录：

```sh
node scripts/check-canvas-material-import.mjs <CREATE_USER_ID> 2 4
```

若本地原文件还存在，可传第四个参数检查字节完全一致：

```sh
node scripts/check-canvas-material-import.mjs <CREATE_USER_ID> 2 4 artifacts/canvas-material-import-2026-10-05/fixture.pdf
```

现场结果保存于 gitignored `artifacts/canvas-material-import-2026-10-05/live-check.txt`；临时下载文件会清理。

在 `routes/create` 运行契约及现有回归：

```sh
RAG_SKIP_AUTO_INIT=true NODE_OPTIONS=--experimental-vm-modules npx jest \
  --config jest.unit.config.js --runInBand --silent \
  __tests__/unit/canvasMaterialImportContract.test.js \
  __tests__/unit/canvasToolkitConnection.test.js \
  __tests__/unit/canvasApiService.test.js \
  __tests__/unit/canvasController.test.js
```

生产验证下一步：使用 UBC Canvas 测试课程和 scoped Developer Key，确认上述读取权限、PDF/DOCX 下载和重新授权，然后验收 CREATE 实际导入、索引与来源引用。这些步骤尚未完成。

## 官方接口依据

- [Canvas Files API](https://developerdocs.instructure.com/services/canvas/resources/files)：课程文件列表、课程范围详情、签名链接及对应 scopes。
- [Canvas Pages API](https://developerdocs.instructure.com/services/canvas/resources/pages)：页面列表及正文读取。
- [Canvas Modules API](https://developerdocs.instructure.com/services/canvas/resources/modules)：模块和条目目录。
