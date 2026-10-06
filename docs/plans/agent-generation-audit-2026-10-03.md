# CREATE Agent 生成诊断与优化学习记录

日期：2026-10-03。目标：检查真实聊天生成 15 道题的质量、耗时和稳定性；从本地 Pi 学习合适的设计，并保留可复现证据。

## 1. 先确定实际能力边界

本记录以当前工作树代码为准（包含未提交功能），不是仅凭 README 或已安装 H5P 库计数。

- 当前课程关联聊天题集使用 Column，支持 **13 种**：multiple-choice、true-false、flashcard、guess-the-answer、summary、discussion、matching、ordering、cloze、mark-the-words、single-choice-set、essay、documentation-tool。
- 跨容器的课程题型共 **16 种**；另 3 种 sort-paragraphs、crossword、branching-scenario 不属于当前 Column 聊天题集路径。
- 原生 H5P 聊天活动目录：56 项中，24 项直接生成、12 项需要已有媒体模板、19 项仅手动、1 项不可用。24 包含容器与非测验活动，且与上述 13 种重叠，不能相加。
- 统一查询入口：`routes/create/services/authoring/authoringActivityCapabilities.js`。题型策略、容器兼容、安装完整性共同决定能力。

这是代码声明的范围，不代表本次逐一对 24 种活动完成了真实模型验收。

## 2. 验证方案

通过真实浏览器以已有 Faculty 身份，在 Test 课程中选用已处理的 `week3-lecture-notes`，新建独立 QA 会话。保留用户已有题目；不修改其数据库记录。前后使用同一材料和同一请求。

```text
QA agent audit 2026-10-03. Generate a complete learning activity with exactly 15 multiple-choice questions based on all topics in the attached week3-lecture-notes. Audience: first-year university students. Purpose: prepare for assessment. Difficulty: intermediate, no calculus. Each question must have four options with exactly one correct answer and helpful feedback. Cover the main topics in the notes with distinct scenarios and avoid near-duplicate questions. Please plan and generate the complete activity now.
```

基线会话：`e3b71c9ac1d80398a30ae14e`。实际模型以 token 收据确认。记录端到端时间、模型请求数、输入/输出 tokens、成功/返工题数和人工答案检查；单组前后样本不作为稳定速度提升的统计证明。

运行期间冻结 `routes/` 下代码及测试修改：本地 nodemon 会监听这些文件，重启会干扰任务。只读诊断脚本：`node scripts/inspect-authoring-audit.mjs <sessionId> <report-name>`。报告保存在 git 忽略的 `artifacts/agent-audit-2026-10-03/`，不输出密钥或原始材料。

## 3. 已复现的问题（修复前）

### 模型上下文重复与增长

实际 prompt builder 的合成测量：读取 0/2/10/20/31 次 6,000 字符材料时，决策 prompt 分别为 17,366 / 33,332 / 92,190 / 156,464 / 227,167 字符。最新摘录同时出现在原始 observations 和 taskContext 中。32 步预算限制调用次数，但没有限制输入体积。

规划环节也将材料分别放入 PLANNING EVIDENCE 和 SOURCE CONTEXT：32 个约 1,000 字符来源时，35,877 字符 context 变为 71,020 字符 prompt，同一摘录出现两次。不能简单删除较长来源块，否则会丢掉另一个块中被截断的事实。

### 并发去重的竞争条件

对同一 session 并发调用两次 `reserveIfNovel()`，使用完全相同题干，两项都得到 `novel: true`，而 reservation Map 最终只留下第二项。检查池在 await 前取快照、await 后用旧数组写回，导致检查与预留不是一个原子操作。题目生成可继续并发，只有共享去重状态的检查与预留需要按 session 串行。

### 规划跨行重复任务

同一 LO 拆成两行，任务 ID 和 focus 不同，但 instructions 完全相同，仍可通过行内校验。应在付费生成前检查跨行完全重复的规范化任务要求；语义相似仍交给现有题目质量与新颖性检查。

## 4. 开发与验证记录

### 基线完成

真实模型收据确认 `gpt-6-luna`。从单条用户请求到 READY：**221.128 秒**；最终 Quiz 引用 **15 道**已检查题目。45 次模型请求，输入 173,462、输出 38,054、合计 **211,516 tokens**。14 题先通过，另 1 题答案检查失败；保留 14 题并自动续做后完成，无人工点击重试。

人工读取全部 15 个题干、选项和解析：每题 4 选项、1 个正确答案，15 个不同题干，15/15 有来源引用和 AI feedback review 记录。覆盖向量/合力、三条定律、受力图、支持力、摩擦力和张力。斜面题独立复算约为 2.81 m/s²。材料范围依然是采样来源，不能据此宣称穷尽每页知识。

另外发现两项展示/教学体验问题：

- 正确答案全部位于第 1 项；Column 的 H5P 配置关闭了 `randomAnswers`，真实预览也固定第一项。Question Set 已开启。统一新生成 Column 的运行时随机答案显示，整条选项连同正确标记和反馈移动，不修改原 Question 数据。旧独立 H5P 文档不自动覆写。
- 反馈中的 `12 × 9.8` 显示成 `117.60000000000001`。服务器验证仍保留完整计算精度，显示最多 10 位有效数字，发生舍入用 `≈`。这不是改变题目要求的答案精度，也不是放宽真假计算检查。

测量陷阱：不能用 `Question.find({quiz})` 的条数当作已交付题数。重试会保留未发布的准备记录；本次一度有 28 条记录，但已发布题目应以 `Quiz.questions` 引用为准。只读检查脚本已按实际发布集合统计。

### 修改步骤与设计理由

1. **先用真实基线分解耗时。** 目标生成阶段 49.878 秒，其中 3 次模型调用约为 15.4 / 16.1 / 17.4 秒。前两次（profile、digest）只依赖同一 inventory，不依赖对方。
2. **并行独立准备工作。** `llmService.js` 用两个局部 async 函数和 `Promise.all`；各自保留 fallback，最后的 LO 生成等两者完成。只对这两个材料整理请求明确 low，主生成、review、覆盖检查不降级。
3. **模型输入与持久历史分开。** Agent 使用纯 projection 模块去重、限制旧文本；原始 observations、付费响应和恢复检查点保留。来源版本与作用域变化要先验证，不能因压缩把过期材料重新加入。
4. **规划只发一份来源。** `studioPlanningEvidence.js` 保留 source ID、页面/段落、采样说明和旧 context 中可见的后半段事实；不简单保留原来被截成 700 字符的短副本。legacy 纯文本 context 继续支持。
5. **只串行共享状态。** `questionMemoryService.js` 每个 session 使用自己的 Promise 队列，将比较与预留视作一个事务；不同 session 不互相阻塞，题目模型生成仍并发 3。clear 后旧异步结果不能复活。
6. **尽早拒绝无效任务。** 公共 plan validator 校验跨行完全重复任务；改 focus 标签不能掩盖相同 instructions。同一概念的不同任务仍允许。完全重复检查不冒充语义质量评审。
7. **修正观测数据。** `questionStreamingService.js` 读取真实 `questionData.generationMetadata.processingTime`，缺失时保持未知，去掉假定 2000ms。
8. **修复展示并补回归。** 数值显示与 H5P 随机答案如上。一次测试发现旧期望仍要求浮点尾数，更新为近似值；独立审查又发现 legacy 已舍入 result 会误用等号，改为依据服务器实际计算值决定 `=` / `≈`。

### 从 Pi 学习什么

本地参考：`/Users/fanhaocheng/tlef/pi`。这里借鉴职责分离，而非将其 coding agent 整体移入教师产品。

- `packages/agent/src/agent-loop.ts` 的 `prepareRequest`：模型请求前单独准备上下文。CREATE 对应纯输入 projection，而不是删除数据库历史。
- `packages/agent/src/types.ts` 的 `AgentToolResult`：`content` 面向模型、`details` 面向 UI/日志、`structuredContent` 面向程序。大体积原始事实不必在每一步全部发给模型。
- `packages/coding-agent/src/core/session-manager.ts` 的 `buildContextEntries`：保存的会话树与实际模型输入有不同表示。CREATE 需要继续保留自己的多用户权限、租约、持久任务和付费重试保护。
- `packages/coding-agent/examples/extensions/dynamic-tools.ts`：工具通过 schema + execute 注册，通常函数组合就足够。CREATE 已有 canonical type adapter + AI Strategy registry + installed capability facade，增加 H5P 支持应扩展策略和契约，而不是在 agent loop 加大量按类型判断。

对应设计原则：单一职责（投影/执行/保存分开）、依赖方向（共享能力注册表决定可用类型）、组合优先、共享状态原子性。这里无需为每个工具建立深层继承结构；有状态服务与策略对象各有适用范围。

### 验证进度

- 并发去重 12 项通过；H5P 导出 24 项通过。
- LO 并行准备、实际耗时、来源及恢复相关 6 suites / 37 项通过。
- 规划/证据/算术/反馈相关 5 suites / 162 项通过；独立审查修正 legacy 数值显示后，相关 3 suites / 87 项再次通过。
- 帮助检索、质量门禁、token 记账、策略相关 4 suites / 198 项通过；更新帮助文档后，帮助检索/H5P 导出/规划/证据 4 suites / 245 项通过。不同组有重叠，不能相加当作唯一测试数。
- 隔离 Mongo 集成测试第一次 179/180 通过，1 个 queued clarification fixture 超时：空计划 mock 配合自动生成意图触发 approval 失败，等待循环跑满。将初始要求明确为先审计划，并新增 queued run 成功断言；整个 authoringWorkspace 67/67 重新通过，另外两个 suite 的 113 项已通过，三组共 180 个场景通过。
- 最终上下文投影及 agent/source/task context 四组 80/80 通过。模拟两页材料只读取两次就继续构建；真实模型端到端尚未重跑。以上 mocked 测试不能证明真实模型速度或所有题型教学质量。

### 第一次实测反馈：不要为了压缩而压缩

优化候选 A 会话：`4260bb5008d0cc051c2a440f`，请求与来源完全相同。

最终结果为 **14/15 题，Needs attention，264.063 秒，55 次模型调用**，输入 218,381、输出 38,961，共 **257,342 tokens**。独立 LO 准备阶段从 49.878 秒降至 31.912 秒，但额外材料读取与同一题的重复返工抵消了收益。候选 A 的整体时间和消费都变差，不能宣称本轮已证明整体提速。

候选 A 的投影对所有非最新材料正文直接裁为 800 字符。真实 agent 读过 `0–6000` 与 `6000–7220` 后，又开始读取重叠范围。只读对照发现：两页原文完整保留时 packet 仅约 8,776 字符，远低于 32k；提前裁剪后正文只剩约 2,019 字符。额外读取与提前丢失事实相符，但模型随机性也会影响决策。

因此修改设计：**先保留完整的、验证过的近期证据，只有超出预算才裁剪旧正文**。先缩到 800，仍超再移除正文，最后才丢弃旧非关键记录。整个 Agent prompt 还包含系统指导和用户要求，32k 指工具上下文 packet，不是总 prompt 的硬上限。

最终版本的合成短材料 packet 为 **8,778 字符**，6000+1220 字符正文完整保留、关键事实只出现一次；新测试覆盖读取后还有 requirement check 的情况。先前激进裁剪版本的长 prompt 缩减比例不作为最终版本的性能结论。

这说明字符数变小不等于任务更快。真实验收需要同时看输入长度、工具重复调用、端到端耗时与结果质量。只用合成 prompt 长度宣布成功会漏掉这个问题。

### 剩余一题失败的具体原因

原计划 Q14 固定为 2.0 kg 静止悬挂物体求拉力；Q15 为 3.0 kg 向上加速物体求拉力。两者分别考平衡与加速，但题目模板相近。Q14 最后草稿的最高词法相似度为 0.6078（对 Q15），低于阈值 0.76；实际拒绝分数 0.904 超过语义阈值 0.90，属于语义检查触发。

不能据此认定物理题完全重复，也不能直接放宽阈值。固定任务已锁定情境、数字与答案，轻微改写后继续付费重试很难改变相似度。现有失败记录没有保存实际语义最近题身份、相似度和 rejected draft；因此只能确认词法最近题是 Q15，不能断言语义最近题也是它。这是诊断与计划修复能力的缺口。

真实浏览器确认 14 道已通过题可预览；随机选项后首题正确答案位于第四项，点击后获得 1/1 分且反馈正确。截图保存在 `artifacts/agent-audit-2026-10-03/randomized-answer-check.png`。未宣称剩余第 15 题已修好。

人工逐条检查候选 A 的 14 个题干、4 个选项和解析：答案键未发现明确错误，均有来源；斜面加速度复算为约 3.20 m/s²，向上加速拉力为 35.4 N。但教学质量仍有改进空间：多题直接提供待使用公式，30° 斜面与水平接触情境反复出现，“intermediate”尚缺独立难度评价。这说明通过 schema、算术与相似度检查不等于题集的认知层次和情境多样性达标。

补充修复沿用已有 `RejectedQuestionDraft`，没有新建第二套状态系统：`questionNoveltyDiagnostic.js` 只整理应用自身算出的分数、阈值和两类 closest 摘要；候选与诊断保存在 instructor-owned 内容中，普通 job receipt 仍只保留安全失败代码。词法和语义最近题分别记录，不能借用对方的 identity。已有详情组件按 `review.novelty` 显示 **Application duplicate check**，避免称作 AI 的答案评审。历史候选 A 不回填猜测数据。

前端诊断详情与 workspace 两组 63/63 通过；最终独立审查又将诊断 footer/空态同步区分应用检查与 AI，详情组件 4/4 回归通过。帮助检索补上成本与去重诊断后 163/163 通过。最终 `npm run build` 通过，仍有已有的大 bundle / 混合动态导入提示，未在本次扩展为打包重构。

去重诊断后端 5 个 focused mocked suites 共 61/61 通过；新增真实隔离 Mongo 验证 1/1 通过（仅指定这一用例，其余 31 个未重跑），使用临时数据库验证 owner+quiz+job+index upsert 与受权限约束的读回，并覆盖另一 owner、旧 job、ready item 不泄露。没有放宽阈值、改写已批准任务、调用付费模型或回填历史诊断。

最终状态：已完成能力清点、两轮真实测试、根因分析及上述代码修复；免费回归与构建通过。用户关注 API 消费后未追加真实生成，所以最终裁剪策略与诊断版本的 15/15 成功率、端到端速度和费用改善仍待真实复测。还需进一步解决固定任务与语义相似度边界冲突、难度与情境多样性、美元预算和 embedding 计费覆盖；不能将本轮局部修复称为全部 agent 问题已解决。

### API 费用核算与消费约束

用户提出希望控制 API 消费后，暂停新增真实生成；本地检查与 mock 测试不调用付费模型。以下按 **2026-10-03 核对的 OpenAI GPT-6 Luna Standard 短上下文价格**估算，不是账户最终账单。

| 每百万 tokens | 普通输入 | 缓存读取 | 缓存写入 | 输出 |
| --- | ---: | ---: | ---: | ---: |
| 美元单价 | $0.10 | $0.01 | $0.125 | $0.50 |

来源：[官方价格](https://developers.openai.com/api/docs/pricing)、[GPT-6 Luna 模型说明](https://developers.openai.com/api/docs/models/gpt-6-luna)、[官方预算控制示例的 token 分类规则](https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api)。示例中的虚构单价没有用于本计算。

输入总数包含缓存读取与缓存写入，不能重复收费；输出总数已经包含 reasoning。计算：`((input - cached - cacheWrites) × 0.10 + cached × 0.01 + cacheWrites × 0.125 + output × 0.50) / 1,000,000`。

| 实测 | 输入总数 | 缓存读取 | 缓存写入 | 输出总数 | 模型费用估算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 基线：15/15 | 173,462 | 0 | 173,327 | 38,054 | US$0.040706375 |
| 候选 A：14/15，含返工 | 218,381 | 5,375 | 212,841 | 38,961 | US$0.046155875 |
| 合计 | 391,843 | 5,375 | 386,168 | 77,015 | **US$0.08686225** |

两次都已核实模型为 `gpt-6-luna`，endpoint host 为 `api.openai.com`。全部 100 条模型收据有输入/输出/缓存字段；单次请求最大输入分别为 15,395 / 11,971 tokens，不触发 >272k 长上下文价格。任务累积的 468,858 tokens 不能当作单次请求输入。

计费限制：收据未保存实际 `service_tier`，代码没有显式指定；因此这里明确假设 Standard。embedding 调用尚未进入此收据，未计入；也不包含税费、账户定价差异或托管成本。失败和被质量检查拒绝的模型调用仍计入收据。`tokenUsage.status=complete` 只表示 token 主计数完整，不保证所有计费信息完整。

本次样本约每组 15 题 **4–5 美分**，不能保证所有材料/题型同价，也不能把每题平均值直接外推成单题调用成本。减少重复阅读和无效重试应优先于盲目削弱题目审查。下一步费用 UI 应显示“估算 US$…”与展开明细；预算限制需要在并发调用前预留额度，而非只在完成后累计 tokens。当前尚未实现美元预算硬上限。

基线费用分解：agent 决策约 $0.00307，需求澄清 $0.00065，学习目标 $0.00418，逐题计划 $0.00311，题目生成及返工 $0.01436，题目检查 $0.01533。完整安全汇总在 `artifacts/agent-audit-2026-10-03/costs.json`。同规模重复 100 次才适合按这个样本粗估约 $4–5 的模型费用；不能承诺不同材料、模型或题型也在此范围。帮助文档也补充了费用口径、失败重试仍消耗 tokens、当前无美元预算限制，162 项帮助检索回归通过。

### 怎样阅读和复现实验

```text
聊天请求
  → Agent 决策（完整收据保留，模型输入单独投影）
  → 授权材料 inventory
  → profile ─┐
    digest ──┴→ 学习目标 + 覆盖检查 → 逐题计划 + 数量/重复验证
  → 3 个并发生成 worker
      → 每题独立 review
      → 同 session 原子去重预留
      → 通过检查的题目才进入发布集合
  → H5P 预览 + token/时间收据
```

并发测试用可控制的 Promise gate，证明 digest 在 profile 尚未返回时已启动，并且最终草稿等待两个结果。去重测试让相同候选同时到达，断言只允许一个通过。这比用机器运行时间猜测是否并发更可靠。真实性能则另外由模型 token 收据和真实浏览器任务衡量。
