# CREATE H5P Studio：找图、生图与看图出题方案

日期：2026-09-28。状态：设计提案，尚未实施。此文不代表媒体 AI 题型已经开放。

## 1. 产品目标与范围

教师描述教学任务后，CREATE 协助寻找或生成真实图片，教师选定素材，再由 GPT-6 Luna 查看图片并生成匹配的 H5P 活动。图片能在官方编辑器中继续修改、保存、重新打开及随 H5P 包导出。

首版支持两个入口，汇入同一个素材选择面板：

- **找图片**：优先复用已保存的课程图片，再搜索 Pexels / Wikimedia Commons。
- **生成图片**：默认低画质，允许显式选择中画质；一次生成一张候选，费用在操作前显示。

上传自己的图片作为始终可用的入口。课程 PDF 自动提图属于后续增强，不能假定现有文字 RAG 已经保留了图片文件。

首版先验证 Flashcards、Image Pair 及图片选择题。每个类型独立完成适配和开放；新装的 editorOnly 类型不能仅修改标记就宣布 AI 可用。首版产物走原生 H5P 活动版本，不自动扩展课程 Question 的所有生成和导出能力。

## 2. 教师体验

示例请求：“创建一个辨认水果的活动，包含苹果、香蕉、梨和橙子。”

1. 系统生成素材需求清单：四种水果，各一张，单主体、背景简单、无答案文字。
2. 展示候选图，每个需求默认最多展示六张。图片卡包含来源、作者/署名、许可、使用按钮。检索无结果时提供改关键词、上传、生图入口，不自动产生生图费用。
3. 点击“生成图片”后显示主题、风格、画质、数量和预计费用。默认 Low、1024×1024、一张；风格独立选择“教学插画”或“照片风格”。
4. 候选图可以使用、替换或重新生成。选中四张后，点击“用这些图片生成活动”。
5. Luna 实际接收图片输入，生成内容描述及题目；后端检查必需图片、答案和配对关系。
6. 显示真实 H5P 预览，沿用已有候选版本、接受/保留当前版本及历史恢复流程。

用户只修改题干或反馈时复用图片；更换图片时使相关答案检查失效，重新审查受影响题目。更新画质是一次新的生成/编辑，会增加费用，也可能改变图片构图；不能承诺是原图的无损升级。

进度显示：正在查找 → 等待选图 → 正在生成图片（可选）→ 检查图片 → 生成活动 → 可预览。

## 3. 素材来源策略

| 来源 | 首版用途 | 处理方式 |
| --- | --- | --- |
| 已保存/用户上传 | 课程专用图片、配套步骤图 | 保留 owner、课程和来源；上传成功不等于已授予任意公开使用许可 |
| Pexels | 通用人物、物品、环境照片 | 后端搜索；显示平台及摄影师署名；遵循 API 配额和条款 |
| Wikimedia Commons | 物种、历史、地理、学术图示 | 获取原始来源及许可元数据；缺少可核实信息时不自动导入 |
| Openverse | 第二阶段扩充检索 | 聚合结果仍需核对原始来源、可用文件和实际许可 |
| AI 图片 | 找不到合适图片的通用插画/虚构场景 | 标记生成来源、模型和参数；不把生成结果伪装为课程证据 |
| 程序绘图 | 后续支持几何、函数、数据图、流程图 | 从结构化数据绘制，保留节点/区域坐标，供热点或拖放使用 |

首版图库许可建议优先支持公共领域、CC0、CC BY，以及满足 Pexels 条款的素材。CC BY-SA 等需要明确处理相应署名、修改和共享条件后再开放；不把所有 Creative Commons 素材统一视为无限制。

搜索结果先显示候选和元数据；只有教师采用、且来源允许本地使用时才导入正式素材。媒体导入服务下载到受管存储，检查格式、大小、尺寸、超时和目标地址，不能让 LLM 输出任意网络地址后直接下载。私有课程不发送给图库，只发送完成检索必需的通用关键词。

## 4. 模型分工、画质和成本控制

### Luna 的工作

- 从教学目标提取图片需求和检索词。
- 对受管图片发送真正的图片输入，而不是普通文本 URL。
- 检查主体是否符合需求、是否遮挡、是否有泄露答案的文字；输出可核对的描述和不确定项。
- 根据选定图片和课程证据生成题目、答案及解释。

视觉描述是模型推断，不能替代学科事实或自动认定准确率。模型自报 confidence 不是通过标准。专业结构、细小差异和精确定位需教师复核。

### 生图的工作

Luna 负责提示词和内容规划；生图模型输出实际文件。后端使用显式的模型、size、quality 和数量，避免由模型自由决定昂贵档位。先用直接 Images API 适配器控制参数和计费，再评估集成到 Responses 的工具调用。

| 产品选项 | 建议参数 | 预期用途 |
| --- | --- | --- |
| 低画质（默认） | quality=low, size=1024x1024, n=1 | 清晰单主体卡片、通用情境插画 |
| 中画质 | quality=medium, size=1024x1024, n=1 | 需要更多细节的场景；低画质结果不合适时重新生成 |

画质是推理/渲染档位，不等同于分辨率、JPEG 压缩率或插画/照片风格。实际可用模型和参数以 provider 能力检查为准；接口不支持就明确禁用，不静默改成 auto。精细教学标注用 H5P 文本叠加，避免把关键答案写死在图片中。

供预算参考：GPT Image 2 1024×1024 官方输出估价 Low US$0.006、Medium US$0.053，提示词输入另计。500 个生图输入 tokens 约 US$0.0025；Luna 若合计 10,000 个计费输入 tokens 和 2,000 个计费输出 tokens，约 US$0.002。对应一次成功的“一张图片＋出题”约 US$0.0105 / US$0.0575。此为参数化预算示例，不是实测账单；若选择 Image 2.5 等其他模型，应重新标定价格和用量，不能沿用单图价。

实现时：

- 模型和价格配置带版本/生效时间；区分预计费用、已知实际 usage 和未知费用。
- 设置每次图片数、单活动预算、用户日预算和并发限制；初始建议每次一张、每活动上限 US$0.50，部署管理员可调整。
- 用 provider 请求 ID、请求摘要和持久化生成任务防重复购买。未知结果的超时不能自动再次生图；返回“结果待确认/请检查后重试”。
- 图片已生成但 H5P 打包失败时，只重试打包，不重新生图。
- 课程/所有者范围内缓存选定图片和分析结果；文本修订复用素材。图像文件或分析模型/提示词契约变化时才重新分析。
- 使用现有用户模型凭据与环境密钥权限机制；生图 provider 权限和看图能力分别检测，密钥不进入浏览器或日志。

## 5. 与现有代码的连接

本次已阅读的运行代码：

- `routes/create/services/h5pStudioAIService.js`：目前媒体题型要求保存好的模板，trustedMedia 只从模板收集；提示词禁止编造媒体路径、新 URL 或声称看过未提供的图片。
- `routes/create/services/authoring/artifactVersionService.js`：保存 native 版本，复制已有媒体引用，检查保存后的文件存在。
- `routes/create/services/authoring/authoringService.js`：现有 run/lease/checkpoint、显式接受版本和 interrupted 恢复流程。
- `routes/create/config/h5p-studio-targets.json`：editorOnly 限制应按类型测试后逐个解除。

建议增加的职责（以下名称是提案，不代表文件已存在）：

| 组件 | 职责 |
| --- | --- |
| Studio 素材面板 | 找图、生图、选图、替换、署名、费用提示 |
| `mediaSearchService` | Pexels/Commons provider 适配和候选归一化 |
| `mediaImportService` | 下载校验、受管文件、来源/许可元数据 |
| `imageGenerationService` | 显式 low/medium、生图任务、费用预留和收据 |
| `mediaAnalysisService` | Luna 图片输入、结构化描述、问题标记 |
| `h5pMediaBindingService` | 通过服务端资产 ID 绑定验证过的文件，生成 H5P 图片字段 |

素材记录至少包括 owner、courseId、来源类型、源页面、provider ID、作者、许可及版本、署名、文件 hash/MIME/尺寸、生成模型/quality/size（如有）、模型分析版本和教师选择状态。生成提示词属于私有创作数据，不能放在通用审计日志中。

LLM 引用服务端发放的 asset ID。服务端验证所有权、可用文件及选定关系，再解析成 H5P 媒体路径。扩展 trustedMedia 的可信来源为“已保存模板或当前授权素材”，保留拒绝虚构路径的约束。

对于采用新图片的原生活动，使用专门类型适配器构造媒体字段或可信模板，再执行 schema 校验、Lumi 保存、预览和导出。不能简单删去现有模板/媒体检查。

采用现有创作 run 模型的持久化阶段，例如 media_requested、awaiting_selection、image_request_sent、asset_saved、analysis_saved、h5p_saved；名称可在实施中调整。恢复时优先复用已保存的资产与模型输出。native 活动与课程 Question 的发布边界继续保留。

## 6. 分阶段交付与验收

1. **素材基础及免费找图**：上传/已有素材、Pexels 和 Commons 搜索、署名、采用后导入、所有权和存储。检索为空或供应商不可用时仍可上传。
2. **低/中画质生图**：使用相同素材记录，加入显式费用提示、任务恢复、预算和参数验证。先实测一组 low/medium 同提示词图片再确定默认模型。
3. **Luna 看图出题**：先开放经过验证的 Flashcards、Image Pair、图片选择题；真实编辑器保存、重开、交互答题和导出后导入均通过。
4. **更复杂的图片活动**：图片排序要确认完整顺序和成套一致性；热点/拖放要提供坐标预览与教师调整。后续再做 PDF 提图、全景和视频。

验收不仅检查 JSON：验证题目确实依赖当前图片、图片没有泄露答案、答案唯一且反馈对应操作、错误图片可替换、署名保留、导出后无失效路径、教师已接受版本不会被失败任务覆盖。

故障测试覆盖：重复点击、断网、图库限流、外部文件失效、生成超时结果未知、生成成功后打包失败、预算不足、取消任务、重开页面恢复、跨用户 asset ID 拒绝。

实现用户入口时更新 `docs/help/h5p-studio.md` 及帮助检索覆盖。本次仅写设计文档，不提前把拟议功能加入使用手册。

## 7. 本次示例与真实画质评测边界

用户选择只使用内置 imagegen 工具。已生成同主题的两张预览图：一个红苹果，短棕色果柄和一片绿叶，浅色背景，无文字；分别为简洁教学插画和照片风格。

内置工具没有暴露 quality 或模型选择，因此两图只能比较视觉风格和细节需求，不能标记为 API low / medium，也不能用于核实上面的单图价格。本次没有调用用户付费 API 密钥，没有进行真实 low/medium 参数对比。

观察：两图都具有清晰单主体、干净背景、无文字，可作为水果辨认卡片候选。照片风格多出果皮和叶脉纹理；对“识别苹果”这一学习任务，插画已能提供必要视觉信息。此结论不能外推到复杂场景、专业结构图或实际低画质接口。

后续真实质量测试使用相同模型、提示词、尺寸和图数，仅改变 quality。保留原始文件、请求参数、耗时和 usage，至少覆盖单主体、多个物体、步骤图三类；逐档多次生成以区分随机构图变化和质量档位差异。检查正常卡片尺寸和原图，不用压缩图片伪造低画质。

### 示例的原始提示词

工具：内置 imagegen；两张均为新生成、不透明背景，没有指定 API quality。

**教学插画：**

```text
Use case: illustration-story. Asset type: preview-only square educational image for an H5P vocabulary flashcard. Subject: exactly one ripe red apple with a short brown stem and exactly one green leaf attached near the stem. Three-quarter view, centered, fully visible, occupies about 65 percent of the square canvas. Plain warm off-white background. No text, letters, numbers, labels, border, watermarks or logos. Visually unambiguous apple shape, uncluttered and recognizable at a small card size. This is an ordinary image example, not an API quality comparison; do not put any quality labels in the picture. Style: simple friendly educational illustration, flat red and green shapes, restrained soft shading, clean silhouette, minimal surface detail, no photorealism.
```

**照片风格：**

```text
Use case: photorealistic-natural. Asset type: preview-only square educational image for an H5P vocabulary flashcard. Subject: exactly one ripe red apple with a short brown stem and exactly one green leaf attached near the stem. Three-quarter view, centered, fully visible, occupies about 65 percent of the square canvas. Plain warm off-white background. No text, letters, numbers, labels, border, watermarks or logos. Visually unambiguous apple shape, uncluttered and recognizable at a small card size. This is an ordinary image example, not an API quality comparison; do not put any quality labels in the picture. Style: natural studio photograph with realistic red apple skin, subtle pores and highlights, clear green leaf veins, soft diffuse lighting, gentle grounding shadow. No dramatic background or decorative props.
```

## 参考

- [OpenAI GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [OpenAI 图片生成与质量参数](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI API 定价](https://developers.openai.com/api/docs/pricing)
- [Pexels API](https://www.pexels.com/api/documentation/)
- [Wikimedia Commons 元数据](https://www.mediawiki.org/wiki/Extension:CommonsMetadata)
- [Openverse API](https://docs.openverse.org/api/)
