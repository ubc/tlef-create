# CREATE 的 UBC Canvas Toolkit 接入

## 结论与边界

原实现没有使用 LMS toolkit：`canvasApiService.js` 自己调用 `fetch`，完成 OAuth、刷新 token 和 Canvas REST 请求。本次将这些协议操作换成官方 `@ubc/ubc-genai-toolkit-lms-integration` **1.4.0**。原有前端接口和课程导出流程保留。

官方源码固定在 [2bf95b4](https://github.com/ubc/ubc-genai-toolkit-lms-integration/tree/2bf95b48c499d9e947abf8489349aa18df2fbeab)。本机没有 GitHub Packages 的读取凭据，因此使用该提交未经修改的源码构建 npm 包，依赖、对应源码及校验值见 `vendor/README.md`。它是实际 toolkit 代码，不是重新实现同名接口。

Toolkit 提供 Canvas/Moodle 账号授权、API 客户端、课程/名单/文件/成绩读取，以及 Canvas 成绩和反馈 PDF 写回。它**没有提供 LTI 1.3 服务或 H5P 播放器**。

| 职责 | 当前负责方 |
| --- | --- |
| Canvas OAuth 授权 URL、交换 code、刷新和撤销 token | UBC toolkit |
| 带认证的 Canvas REST 请求、401 后重试、列表分页 | UBC toolkit |
| CREATE 登录、OAuth state 与用户绑定、连接状态 | CREATE |
| Token 加密、旧连接兼容、Canvas 实例隔离 | CREATE TokenStore 适配层 |
| 模块、页面、ExternalTool 创建的业务参数 | CREATE，通过 toolkit API client 发送 |
| LTI 启动验证、学生身份和 AGS 成绩回传 | 现有 `ltijs` 服务 |
| H5P/Mixed Activity 内容、快照、渲染 | CREATE |

## 在本项目里如何使用

```text
老师点击 Connect to Canvas
  → CREATE 生成并保存一次性 state
  → toolkit.buildAuthorizeUrl
  → Canvas 授权 → CREATE /canvas/oauth/callback
  → toolkit.exchangeCodeForTokens → CREATE 加密保存

老师选择 Canvas 课程/模块并导出
  → toolkit.getCourses / client.getAll
  → toolkit client.post 创建 ExternalTool 模块项
  → Canvas 保存指向 CREATE LTI 的链接

学生打开模块项
  → Canvas 发起 LTI 1.3 launch
  → CREATE ltijs 验证 → H5P/Mixed Activity 播放
```

入口文件：

- `routes/create/services/canvasToolkitConnection.js`：直接调用 toolkit 的 OAuth、refresh、revoke、createApiClient；并发刷新合并；网络错误不删除已有连接。
- `routes/create/services/canvasTokenStore.js`：实现 toolkit `TokenStore` 的 `get/set/delete` 契约，继续使用 `canvas_tokens` 集合和现有加密字段。不同 Canvas 主机的 token 不混用。
- `routes/create/services/canvasApiService.js`：维持原有 service 函数签名；课程使用 `canvas.getCourses`，模块和 external tools 使用 `client.getAll`，写操作使用 `client.post`。
- `routes/create/controllers/canvasController.js`：保留原来前端使用的路径和成功响应；Canvas 连接过期返回可恢复的 409，不误触发 CREATE 的 401 登出逻辑。
- `routes/create/services/ltiService.js`：保留 LTI 服务，使用相同的 Canvas 实例配置。

没有直接挂 toolkit 的 `createAuthRouter` / `requireAuth`，因为它们的默认路由、跳转和响应格式与 CREATE 现有弹窗流程不同。这里使用它公开的底层协议 API，保留 CREATE 会话和加密存储。

## 配置和操作步骤

1. `npm install`。当前固定源码包随项目提供，不需要 GitHub Packages 凭据。
2. 由 Canvas 管理员创建 **OAuth Developer Key**，设置下面的 redirect URI，并允许后面的 scopes。
3. 在本地 `.env` 设置以下变量；密钥不要提交到 Git。

```dotenv
# 正式 UBC Canvas：裸域名默认 HTTPS
CANVAS_DOMAIN=ubc.instructure.com
CANVAS_CLIENT_ID=<OAuth Developer Key ID>
CANVAS_CLIENT_SECRET=<OAuth Developer Key secret>
CANVAS_REDIRECT_URI=https://<CREATE-backend-host>/api/create/canvas/oauth/callback
FRONTEND_URL=https://<CREATE-frontend-host>
```

本地 Canvas 可以继续使用 `CANVAS_BASE_URL=http://localhost`，并使用
`CANVAS_REDIRECT_URI=http://localhost:8051/api/create/canvas/oauth/callback`。
`CANVAS_DOMAIN` 若设置会优先于旧的 `CANVAS_BASE_URL`；本地 HTTP 实例请写完整 `http://...`。
回调 URL 必须与 Canvas Developer Key 的允许列表完全一致。

4. 导出可播放的 CREATE 活动还需要单独的 **LTI Developer Key/工具安装**：`LTI_CLIENT_ID`、`LTI_PUBLIC_URL` 及原有 LTI 配置。OAuth client ID 与 LTI client ID 不是同一个用途。Canvas 和学生浏览器必须能访问对应的公开 HTTPS 地址；生产环境不可使用 localhost。
5. 重启后端，在学习对象的 Canvas 导出界面点击 **Connect to Canvas**，完成授权，选课程和模块，再导出。
6. 从 Canvas 实际打开生成的模块项，检查学生视图及需要的成绩回传。API 测试通过不代表 LTI 注册和真实 Canvas 部署已验证。

OAuth Developer Key 需要允许的 scopes：

```text
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:course_id/modules
url:POST|/api/v1/courses/:course_id/modules
url:POST|/api/v1/courses/:course_id/pages
url:POST|/api/v1/courses/:course_id/modules/:module_id/items
url:GET|/api/v1/courses/:course_id/external_tools
url:GET|/api/v1/accounts/:account_id/external_tools
url:POST|/api/v1/courses/:course_id/external_tools
```

最后一个安装权限是旧实现遗漏的。已有连接若缺少新增 scope，需要重新授权；权限仍受 Canvas 用户角色限制。教师无法安装工具时应由 Canvas 管理员提前安装。

已有数据库记录无需批量迁移。旧 token 仍可读取、刷新；新授权会保存 Canvas 用户 ID。如果更换 Canvas 域名，需要重新连接。重新授权若 Canvas 没有返回 refresh token，只在确认同一个 Canvas 用户时保留旧 refresh token；身份未知的旧记录不跨账号复用。

Disconnect 现在会尝试通过 toolkit 撤销 Canvas token（旧实现只删除本地记录），并清理本地连接；遵循 toolkit 的退出行为，已失效 token 或网络故障不会阻止本地断开。响应中的 `revoked` 表示是否确认远端撤销；无法确认时，也可从 Canvas 账号设置撤销 CREATE 授权。

## Toolkit 的其他功能怎么用

在服务器上获得 `client = await connection.getClient(userId)` 后，可调用：

```js
import { canvas } from '@ubc/ubc-genai-toolkit-lms-integration';
import { canvasConfig, createCanvasConnection } from './canvasToolkitConnection.js';
import { createCanvasTokenStore } from './canvasTokenStore.js';

// 在 service 模块初始化时创建一次。
const config = canvasConfig();
const connection = createCanvasConnection({
  config,
  tokenStore: createCanvasTokenStore(config.canvasDomain)
});

// 在已完成 CREATE 身份与课程访问检查的请求处理函数内调用。
const client = await connection.getClient(userId);
const courses = await canvas.getCourses(client);
const files = await canvas.getCourseFiles(client, courseId);
const file = await canvas.downloadFile(client, courseId, fileId, {
  maxBytes: 10 * 1024 * 1024,
  via: 'public-url'
});
```

文件导入当前尚未接到 CREATE 的材料上传界面，需要再做大小/类型限制、课程归属和材料处理流程，并增加对应 Canvas scopes。

Toolkit 还支持 `matchCourseRoster`、`preflightGradeExport`、`postGrades`，以及反馈 PDF 回传。它们适合教师审核后的批量成绩/反馈操作；当前接入没有启用这些新功能，也没有替换学生的 LTI AGS 成绩回传。UBC 名单关联使用 PUID (`integration_id`)，不要用 CWL 名称或学号冒充 PUID。

## 验证范围

回归测试使用真实 toolkit 实现和模拟 Canvas HTTP 响应，覆盖授权参数、加密 token 兼容、分页、跨域拒绝、刷新/401 重试、网络故障、断开连接、模块创建和 LTI 模块项请求。另有 Express 路由测试覆盖 OAuth state、账户切换、重复回调及错误响应。

上线前仍需在已配置的 Canvas 测试实例完成真实授权 → 选课程 → 建模块项 → LTI 启动。没有这一步不能声称已完成真实 UBC Canvas 端到端验证。


## 2026-09-26 本地真实 Canvas 联调

现有 Canvas 目录：`/Users/fanhaocheng/tlef-create/canvas-lms-docker`。沿用 `canvas-lms-debian` 项目与原数据库卷。启动 Docker Desktop 后，在该目录运行：

```sh
COMPOSE_PROJECT_NAME=canvas-lms-debian DISTRIBUTION=debian docker compose -f compose.yml -f /Users/fanhaocheng/tlef/tlef-create/scripts/canvas-local.override.yml up -d --pull never
```

覆盖配置仅清理网页容器中的过期 `server.pid` 并监听 `0.0.0.0`，不删除数据库或课程。CREATE 的本地 `.env` 已使用现有 Canvas OAuth Developer Key，秘密值没有进入文档或版本库。

真实接口验证：官方 toolkit 的 OAuth refresh/revoke、加密 token 存储、课程列表、模块列表/创建、页面创建和模块条目、现有 LTI Developer Key 安装均通过。临时接口测试凭据已撤销。另通过 CREATE 网页完成选课、新建模块、导出，随后在 Canvas 内启动 Branching Scenario，选择分支并到达结尾反馈。初次浏览器 OAuth 授权弹窗未完整观测；网页测试使用已保存的有效连接。未验证生产 UBC Canvas、Canvas 手机 App 或成绩回传。

联调修复：
- 未连接 Canvas 的用户也能进入 Create Course 的可选连接步骤。
- 浏览器拒绝弹窗时给出明确提示。
- 导出缺少 Canvas 连接时返回可恢复的 409，不触发 CREATE 登录过期。
- H5P 包按官方文件允许列表排除 SCSS/YAML 开发文件，避免 Branching Scenario 导入失败。
- Canvas LTI 页面改用现有只读播放资源路径，避免错误请求 Studio 的认证资源路径造成空白。
- 使用 Canvas `lti.frameResize` 协议报告活动高度，避免长反馈被固定高度截断。

测试课程：[CREATE Toolkit QA 2026-09-26](http://localhost/courses/2/modules)。浏览器导出位于 `Browser export verification` 模块。测试条目保留为未发布，教师可预览；学生正式使用前需在 Canvas 发布课程、模块和条目。
