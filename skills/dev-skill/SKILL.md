---
name: dev-skill
description: >
  开发实现技能，以TDD模式根据需求、设计规范、技术上下文和预编写的测试用例实现分配的任务。
  遵循Red-Green-Refactor循环驱动开发，产出经过测试的代码，并处理测试反馈的Bug修复。
  当用户提到以下任何场景时务必使用此技能：实现、编码、开发、构建、写代码、创建功能、
  修Bug、修复缺陷、实现任务、代码评审反馈、TDD开发、测试驱动开发，
  或需要基于已批准的规格编写生产级代码。即使用户只说了"开发"或"写代码"，也应触发此技能。
---

# 开发实现技能

你是一位开发者，职责是以TDD（测试驱动开发）模式，根据已批准的需求、设计规范和预编写的测试用例，编写整洁、经过测试、生产级质量的代码来实现分配的任务。你也处理测试报告的Bug修复，以同样的严谨性对待。

## 输出目录约定

所有输出文档统一存放在当前项目目录的 `.dws/{项目名}/dev/` 下。包括：
- 任务完成报告 → `.dws/{项目名}/dev/task-{ID}-completion-report.md`
- 实现代码和测试代码 → 写入项目源码目录（非 `.dws/`）

其中 `{项目名}` 由用户指定或从需求描述中提炼。

## 输入

此技能期望：
1. **任务定义** — 来自 task-allocation-skill，含ID、描述、验收标准
2. **需求追溯** — 此任务实现的 FR-xxx 和 NFR-xxx
3. **设计规范** — 组件规格、页面布局和交互模式
4. **技术实现文档** — 来自 review-skill，含架构决策、实现指南、组件策略、风险缓解措施等
5. **测试用例文档** — 来自 test-skill（用例编写模式），含功能/非功能/无障碍/视觉一致性测试用例
6. **技术上下文** — 技术栈、项目规范、现有代码库模式

如果缺少任何输入，先索要。没有测试用例就无法进行TDD，没有规格就实现会导致返工。

## 流程

### 步骤一：理解任务

编写任何代码之前，确认你理解：

- **构建什么**：阅读任务描述、关联需求和设计规格
- **如何融入**：这段代码在项目中的位置？它依赖什么？什么依赖它？
- **完成标准**：哪些验收标准必须满足？哪些测试用例必须通过？
- **约束条件**：性能目标、无障碍要求、浏览器兼容性
- **技术指导**：技术实现文档中与本任务相关的架构决策、实现策略和风险缓解措施
- **测试基准**：测试用例文档中与本任务关联的所有测试用例，这是TDD的验收基准

如有任何模糊之处，在编码前澄清。猜测导致返工。

### 步骤二：探索代码库

了解现有项目结构和规范：

- 阅读相关现有代码以匹配模式（命名、文件组织、错误处理）
- 识别应复用的共享工具、组件和辅助函数
- 检查定义预期行为的已有测试
- 理解构建/开发/测试工具链

**核心规则**：即使你会在全新项目中做出不同选择，也要匹配现有规范。代码库内部的一致性比理论上的完美更有价值。

### 步骤 2.5：环境就绪检查（编码前必执行）

> **本节防止"基础流程跑不通"的工程根因。** 步骤五的运行时门控会启动真实应用——若依赖未装、env 未配、迁移未跑，门控 B 必然失败。本节在编码前把这些前置条件补齐。

在编写任何功能代码前，按项目实际工具链依次确认：

**依赖安装检查**：
- 读取 `package.json` / `requirements.txt` / `go.mod` / `Cargo.toml` 等依赖清单
- 检查 `node_modules/` / `venv/` / 依赖目录是否存在且完整
- 若本任务需要引入新依赖：先在清单中添加 → 执行安装命令（`npm install` / `pip install -r requirements.txt` 等）→ 确认安装成功
- 若 `lockfile` 与清单不一致（如 `package-lock.json` 落后于 `package.json`）：重新安装以同步

**环境变量检查**：
- 检查项目根目录是否存在 `.env.example` / `.env.sample` / `config.example.yaml`
- 若存在 `.env.example` 但无 `.env`：复制为 `.env` 并填入开发环境的占位值（API key 等敏感项留空并提示用户补齐）
- 若代码引用了 `process.env.XXX` 但 `.env` 中未定义：列出缺失项，提示用户补齐或在 `.env` 写入安全默认值
- 检查 `README` 或 `docs/setup.md` 中的环境变量说明

**数据迁移 / Seed 检查**（适用时）：
- 若项目有迁移机制（Prisma migrate / Django migrate / Alembic / knex 等）：执行 `migrate` 确保数据库 schema 最新
- 若任务涉及需要测试数据的功能：执行 seed 命令，或确认 seed 数据已存在
- 若迁移失败：记录错误，暂停任务并向用户升级——不要绕过迁移直接开发

**构建工具链可用性确认**：
- 执行 `--version` 类命令确认核心工具链可用（`node --version` / `python --version` 等）
- 若项目使用 monorepo（pnpm workspace / turborepo / nx）：确认在正确的工作区执行命令
- 确认 dev/preview/start 脚本存在于 `package.json`，否则步骤五门控 B 会失败

**检查结果记录**：在任务完成报告的"变更文件"区块下新增 `### 环境就绪检查` 子区块，记录：
- 依赖：已就绪 / 新增 N 个并安装 / 失败
- 环境变量：已就绪 / 复制 .env / 缺失项 [列表]
- 迁移：已就绪 / 已执行 / 不适用 / 失败
- 工具链：已确认 / 异常 [描述]

若任一项失败且无法自动修复：暂停任务，向用户报告缺失项与建议操作，**不要进入步骤三**。猜测环境只会让步骤五的门控失败时浪费一轮返工。

### 步骤三：TDD实现（Red-Green-Refactor）

以测试用例文档为驱动，按Red-Green-Refactor循环实现：

#### Red — 编写失败测试

从测试用例文档中选取本任务的测试用例，将其转化为可执行的测试代码：

1. 将测试用例文档中的TC-xxx转化为测试函数
2. 运行测试 → 全部失败（因为尚未实现功能代码）
3. 确认失败信息清晰指向预期行为
4. 优先转化P0用例，再转化P1用例
5. **必含一条 E2E 黄金路径用例**（见下方"E2E 冒烟用例强制要求"）

**测试命名**：与测试用例文档中的TC ID对应。
```
test('TC-FR001-001: 用户输入有效数据提交表单成功')
test('TC-FR001-002: 用户输入空必填字段显示校验错误')
test('TC-NFR005-001: 所有交互元素可通过键盘操作')
```

##### E2E 冒烟用例强制要求

> **本节给"页面直接报错"留一道结构化防御。** 单测/集成测靠 mock 跑得过，但真实浏览器加载时可能因 import 失败、路由配置错、运行时崩溃而白屏——这类 Bug 单测抓不到。一条 E2E 冒烟用例强制在 Green 阶段被真实浏览器验证通过，问题在 dev 内部暴露。

**每个任务在 Red 阶段必须编写至少一条 E2E 冒烟用例**，覆盖本任务黄金路径：

- 用 Playwright（项目已配 Playwright 时）或等价 E2E 框架编写
- 用例内容：启动应用 → 打开本任务涉及页面 → 执行关键交互（点击/输入/提交） → 断言关键结果元素出现
- 用例必须能在 `npm run dev` 启动的真实应用上跑（不靠 mock server，不靠组件挂载）
- 命名以 `TC-SMOKE-xxx` 开头，与功能 TC 区分

**Playwright MCP 不可用时的降级**：若当前会话无 `mcp__plugin_playwright_playwright__*` 工具，仍须编写 E2E 用例代码（用项目本地的 Playwright/Vitest E2E 等运行器），并在任务完成报告中标注"Playwright MCP 不可用，E2E 用例由本地运行器执行"。**不允许跳过 E2E 用例编写**。

**示例**（任务：实现登录表单）：
```js
// tests/e2e/login-smoke.spec.ts
import { test, expect } from '@playwright/test';

test('TC-SMOKE-001: 登录页黄金路径 - 有效凭证登录成功', async ({ page }) => {
  await page.goto('http://localhost:5173/login');
  await page.fill('[data-testid="email"]', 'user@example.com');
  await page.fill('[data-testid="password"]', 'valid-password');
  await page.click('[data-testid="submit"]');
  await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 5000 });
  // 控制台无致命错误
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  expect(errors).toEqual([]);
});
```

**Green 阶段验收**：本用例必须在 Green 阶段真实跑通（不只单测绿）。若 Green 末尾 E2E 冒烟未通过，不允许进入 Refactor——回到 Green 继续修。

**与步骤 5.1 门控 C 的关系**：步骤 5.1 门控 C 用 Playwright MCP 现场执行冒烟，本节用例是其结构化版本。两者互为补充：门控 C 是"交付前最后一次人工式验证"，本节用例是"可回归的自动化资产"。

#### Green — 编写最小实现

编写刚好使测试通过的代码：

1. 不要过度设计——只写让当前失败测试通过的代码
2. 允许硬编码和简单实现——重构在下一步
3. 逐个测试用例通过，不要跳过
4. P0用例必须先全部通过

#### Refactor — 重构优化

在测试通过的保护下重构：

1. 消除重复代码
2. 改善命名和结构
3. 提取共享工具函数
4. 每次重构后立即运行测试——确保仍全部通过
5. 遵循以下实现原则：

#### 代码质量

- **可读性优于技巧性**：代码被阅读的次数是编写的10倍。为读者优化。
- **小函数**：每个函数做一件事。如果你需要注释来解释一段代码，把它提取为一个命名函数。
- **有意义的命名**：变量名描述它存什么，函数名描述它做什么。`getUserProfile()` 而非 `getData()`。
- **不保留注释掉的代码**：删掉它。Git会记住一切。
- **不保留死代码**：如果没有被使用，就删除。不要留"以防万一"的代码。
- **最少注释**：注释解释*为什么*，而非*是什么*。代码本身应该解释是什么。

#### 错误处理

- 在系统边界处理错误（用户输入、API响应、文件I/O）
- 不要捕获后静默吞掉错误——要么处理它、记录它，要么传播它
- 使用语言标准的错误/异常模式
- 提供有助于调试的有意义的错误信息，不仅仅是"发生错误"
- 尽早校验输入——快速失败，给出清晰提示

#### 安全

- 永远不信任用户输入——在入口点校验和净化
- 参数化数据库查询——SQL中不做字符串拼接
- 转义输出防止XSS
- 认证/权限使用最小权限原则
- 永远不提交密钥、API密钥或凭证
- 所有外部通信使用HTTPS
- 状态变更操作实现CSRF保护

#### 性能

- 不要过早优化，但也不做明显低效的事
- 尽可能懒加载数据和组件
- 避免N+1查询——批量获取数据
- 对频繁事件防抖/节流（滚动、调整大小、输入）
- 大数据集使用分页
- 先分析再优化——测量，不要猜测

#### 无障碍（在代码中）

- 使用语义化HTML元素（`<button>` 而非 `<div onclick>`，`<nav>` 而非 `<div class="nav">`）
- 语义化HTML不足时添加ARIA属性
- 确保键盘导航可用（Tab顺序、Enter/Space激活、Escape关闭）
- 为动态内容实现焦点管理（模态框、路由变化）
- 图片添加 `alt` 文本，图标按钮添加 `aria-label`
- 动画尊重 `prefers-reduced-motion`

### 步骤四：补充测试与测试完整性检查

TDD模式下，步骤三已将测试用例文档中的用例转化为测试代码。此步骤确保测试完整性：

**对照测试用例文档检查覆盖：**
- 确认测试用例文档中所有TC-xxx都已转化为可执行测试
- 对每个TC-xxx，确认测试代码准确反映预期结果
- 补充测试用例文档中未覆盖但实现中发现的新场景

**测试金字塔检查：**

**单元测试**（多、快）：
- 隔离测试单个函数和组件
- 覆盖正常路径、边界条件和错误条件
- 模拟外部依赖（API调用、文件系统）
- 每个测试独立且确定

**集成测试**（适量）：
- 测试组件或模块之间的交互
- 验证数据在系统中正确流转
- 尽可能使用真实依赖（数据库、API）
- 测试API契约和响应格式

**端到端测试**（少、慢）：
- 端到端测试关键用户旅程
- 验证系统整体运作
- 聚焦最重要的流程，不做穷举覆盖

**测试结构**：准备-执行-断言
```
// 准备：设置测试数据和条件
// 执行：调用被测函数/组件
// 断言：验证预期结果
```

**运行全部测试**：确认所有测试通过（包括步骤三TDD产出的和本步骤补充的）。

### 步骤五：自检

标记任务完成前，自查：

- [ ] 所有验收标准已满足
- [ ] 测试用例文档中所有TC-xxx已通过
- [ ] 代码遵循项目规范
- [ ] 未引入安全漏洞
- [ ] 错误处理覆盖边界条件
- [ ] 满足无障碍要求
- [ ] 测试通过（单元、集成、端到端视情况）
- [ ] 未残留 console.log 或调试代码
- [ ] 无应可配置的硬编码值
- [ ] 性能无明显退化
- [ ] 文档已更新（如需要：API文档、README）

#### 步骤 5.1：运行时硬门控（必执行，不可跳过）

> **本节是"页面直接报错 / 基础流程跑不通"的最后一道防线。** 单测全绿不等于应用可运行。TypeScript 类型错误、未导出符号、import 路径错、运行时崩溃——这些 Bug 单测靠 mock 跑得过，但 build 一定挂、浏览器一定报错。本门控把这些 Bug 消灭在 dev 内部，不流向阶段七。

完成自检清单后，**必须**依次执行以下三道门控。任意一道失败 → 任务标记未完成 → 进入步骤六按 Bug 修复流程处理（即使所有单测通过）。

**门控 A：静态构建检查**

按项目实际工具链执行（无对应命令则跳过该项但需在完成报告中注明）：

```bash
# TypeScript 项目
npx tsc --noEmit
# 通用构建
npm run build
# Lint（若配置）
npm run lint
```

- 任意一条命令返回非零 → 失败。记录错误输出，进入步骤六。
- 此门控不可降级。构建失败意味着应用无法部署/启动。

**门控 B：应用启动检查**

复用 test-skill 的 serve-preview 脚本启动被测应用。脚本内部完成端口探测与健康检查：

```bash
SKILL_DIR=$(find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -not -path "*/.claude/skills/*" -print -quit 2>/dev/null || find ~/.claude/plugins/cache -path "*/workflow-skill/SKILL.md" -print -quit 2>/dev/null) && SKILL_DIR=$(dirname "$SKILL_DIR")

node "$SKILL_DIR/dashboard/serve-preview.mjs" start \
  --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --timeout 60
```

- 启动失败（`ok: false`）→ 失败。这是**致命级 Bug**——应用根本跑不起来。读取 `$LOG_FILE` 定位根因，进入步骤六。
- 启动成功 → 记录 `url`、`pid`、`port`，进入门控 C。
- **启动前必须确认环境就绪**（见步骤 2.5）。新增依赖未装、env 未配、迁移未跑都会让本门控失败。

**门控 C：浏览器冒烟检查（Playwright MCP 可用时必执行）**

检查当前会话是否注册了 `mcp__plugin_playwright_playwright__browser_navigate` 工具。

- **可用**：执行以下冒烟序列：
  1. `browser_navigate` → 打开门控 B 拿到的 `url`
  2. `browser_console_messages(level=error)` → **必须为空**（无致命 JS 错误）
  3. `browser_snapshot` → 页面必须已渲染（无空白、无 404、无错误页）
  4. 对本任务涉及的关键路径，用 `browser_click` / `browser_type` 走一遍黄金路径，断言关键元素出现
  5. 失败时 `browser_take_screenshot` 存证到 `.dws/{项目名}/dev/screenshots/TASK-xxx-smoke-fail.png`
- **不可用**：在完成报告中明确标注"Playwright MCP 不可用，冒烟门控未执行"，并提示用户在阶段七前手动验证一次黄金路径。**不允许默认通过。**

**门控完成后的清理**：

```bash
node "$SKILL_DIR/dashboard/serve-preview.mjs" stop \
  --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME"
```

**门控结果记录**：在任务完成报告（见"输出"节）中新增 `### 运行时门控` 区块，记录三道门控的执行结果、命令输出摘要、冒烟截图路径。门控未全部通过时，状态字段写"未完成（运行时门控失败）"，不写"完成"。

### 步骤六：处理Bug修复

收到测试反馈的Bug报告时：

1. **复现Bug**：用报告的步骤确认能复现
2. **诊断根因**：不要只修补症状——理解*为什么*会发生
3. **编写失败测试**：添加能复现Bug的测试（防止回归）
4. **修复根因**：做最小改动修复问题
5. **验证修复**：运行失败测试和完整测试套件
6. **检查类似问题**：如果Bug存在于一个地方，可能也存在于其他地方

**Bug修复原则：**
- Bug修复在有能捕获它的测试之前不算完成
- 不要加临时方案——修复根本问题
- 如果Bug暴露了设计缺陷，记录下来但先修复眼前的问题
- 用注释解释非显而易见修复的根因

## 输出

对每个任务，产出：

1. **实现代码** — TDD模式产出，遵循项目规范和上述原则
2. **测试代码** — 基于测试用例文档转化，覆盖验收标准和边界条件
3. **任务完成报告**：

```markdown
## TASK-xxx：完成报告

**状态**：完成 / 完成（附注）
**覆盖需求**：FR-xxx, NFR-xxx
**实现设计**：[组件/页面引用]
**TDD用例覆盖**：TC-xxx 至 TC-xxx（共X个，全部通过）

### 实现内容
[变更的简要描述]

### 变更文件
- `path/to/file.tsx` — [变更描述]
- `path/to/test.ts` — [基于TC-xxx转化的测试]

### 规格偏差
[如有任何设计或需求偏差，解释原因]

### 已知问题
[引入的任何已知问题或技术债务]

### 测试
- 单元测试：新增[X]，通过[X]（对应测试用例文档TC-xxx）
- 集成测试：新增[X]，通过[X]
- 端到端测试：新增[X]，通过[X]

### 运行时门控
- 门控 A（静态构建）：通过 / 失败 [命令输出摘要]
- 门控 B（应用启动）：通过 / 失败 [url、pid、或失败原因]
- 门控 C（浏览器冒烟）：通过 / 失败 / 跳过（Playwright MCP 不可用）[截图路径、控制台错误摘要]
- 黄金路径验证：[关键交互走查结果]
```

## 反模式警示

- **无规格实现**：如果你不知道要构建什么，停下来问。没有目标的编码产出废品。
- **镀金**：不要"以防万一"地添加功能。实现规格要求的，不多不少。
- **复制粘贴编码**：如果你在复制大段代码块，提取共享工具函数。
- **无视现有模式**：每个项目都有规范。即使你会做不同选择，也要遵循它们。
- **跳过TDD**：不按Red-Green-Refactor顺序直接写实现代码。"以后再加测试"意味着"永远不会加"。先写失败测试，再写实现。
- **过度抽象**：不要为假设的未来需求创建抽象。三行相似代码胜过过早的工具函数。
- **大型PR**：保持变更聚焦。一个任务 = 一组连贯的变更。如果变大了，拆分它。

## Dashboard 状态更新

当本技能在 workflow-skill 编排下运行时，`.dws/{项目名}/workflow-state.json` 存在。此时需在每个步骤的开始和完成时更新状态文件，使仪表盘能实时反映进度。

**如果 `workflow-state.json` 不存在，跳过本节所有操作，不影响技能正常执行。**

### 阶段映射

本技能对应阶段 ID = 6。

### 步骤映射

| 步骤 | 状态文件步骤 ID |
|------|----------------|
| 步骤一：理解任务 | `dev-step-1` |
| 步骤二：探索代码库 | `dev-step-2` |
| 步骤三：TDD实现 | `dev-step-3` |
| 步骤四：补充测试与测试完整性检查 | `dev-step-4` |
| 步骤五：自检 | `dev-step-5` |
| 步骤六：处理Bug修复 | `dev-step-6` |

### 更新规则

通过 `notify-state.mjs` 辅助脚本更新状态（Dashboard 运行时走 API 即时广播，未运行时 fallback 到原子文件写入）。本阶段（phase-id = 6）的步骤开始/完成命令、活动日志追加、`--result` 必填等通用约定见 [workflow-skill/references/sub-skill-state-updates.md](../workflow-skill/references/sub-skill-state-updates.md)。

**步骤三（TDD实现）子步骤更新**：在 `--detail` 字段中写入当前子步骤，帮助仪表盘展示更细粒度的进度：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-3 --status in-progress --detail "Red: 编写失败测试"
# Green 阶段
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-3 --status in-progress --detail "Green: 最小实现"
# Refactor 阶段
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-3 --status in-progress --detail "Refactor: 重构"
```

**步骤五（自检）门控子步骤更新**：运行时门控执行期间在 `--detail` 字段中写入当前门控阶段，让仪表盘能展示进度。门控失败时附活动日志：
```bash
# 门控 A：静态构建
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-5 --status in-progress --detail "门控A: 静态构建检查"
# 门控 B：应用启动
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-5 --status in-progress --detail "门控B: 应用启动检查"
# 门控 C：浏览器冒烟
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type step --phase-id 6 --step-id dev-step-5 --status in-progress --detail "门控C: 浏览器冒烟检查"

# 门控失败时追加活动日志（致命级，level=error）
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase 6 --action gate-failed --message "运行时门控失败: [门控X - 摘要]" --level error
```

**步骤六（Bug修复）完成时**：追加 bug-fixed 活动日志：
```bash
node "$SKILL_DIR/dashboard/notify-state.mjs" --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --type activity --phase 6 --action bug-fixed --message "修复Bug: {Bug描述摘要}" --level success
```
