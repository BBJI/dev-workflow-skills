# 各工具规范文件格式详解

## CLAUDE.md（Claude Code）

### 文件位置
- 根目录：`./CLAUDE.md`
- 子目录：`./src/CLAUDE.md`、`./src/components/CLAUDE.md` 等

### 加载机制
Claude Code 启动时自动加载从根目录到当前工作目录的所有 CLAUDE.md 文件。更深层级（更具体）的文件覆盖上层规则。

### 格式
纯 Markdown，无特殊标记。

### 示例
```markdown
# MyApp - 项目规范

## 概述
React 18 + TypeScript 任务管理应用，使用 Next.js App Router。

## 常用命令
- 安装：`npm install`
- 开发：`npm run dev`
- 构建：`npm run build`
- 测试：`npm test`
- 检查：`npm run lint`

## 代码约定
- 组件使用函数式 + Hooks
- 文件名：组件用 PascalCase.tsx，工具用 camelCase.ts
- 使用 Server Components 获取数据，客户端组件仅用于交互

## 绝对不要
- 不要修改 prisma/generated/ 下的文件
- 不要使用 any 类型
- 不要在客户端组件中直接调用数据库

## 测试
- 框架：Vitest + React Testing Library
- 文件位置：与源文件同目录，命名 `*.test.tsx`
- 运行单个测试：`npm test -- path/to/test`
```

### 子目录 CLAUDE.md 示例
`src/components/CLAUDE.md`：
```markdown
# 组件目录规范

- 每个组件一个目录：`ComponentName/index.tsx`
- 样式使用 CSS Modules：`ComponentName/styles.module.css`
- 如有子组件，放在同目录下
- 导出从 index.tsx 统一导出
```

---

## AGENTS.md（OpenAI Codex）

### 文件位置
- 根目录：`./AGENTS.md`
- 子目录：`./src/AGENTS.md` 等

### 加载机制
Codex CLI 递归向上查找 AGENTS.md 文件，子目录文件覆盖上层。与 CLAUDE.md 加载机制类似。

### 格式
纯 Markdown。OpenAI 建议使用祈使句，包含精确命令。

### 示例
```markdown
# MyApp 项目指令

## 概述
Python FastAPI 后端服务，提供 REST API 给前端 React 应用。

## 开发命令
- 创建虚拟环境：`python -m venv .venv`
- 安装依赖：`pip install -r requirements.txt`
- 启动开发服务器：`uvicorn app.main:app --reload`
- 运行测试：`pytest`
- 代码检查：`ruff check .`

## 代码约定
- 使用 async/await 处理数据库调用
- 路由定义在 app/routers/ 目录
- 使用依赖注入获取数据库会话
- 响应使用 Pydantic 模型序列化

**推荐：**
```python
async def get_users(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User))
    return result.scalars().all()
```

**不推荐：**
```python
def get_users():
    session = Session()
    users = session.query(User).all()
    session.close()
    return users
```

## 约束
- 不要直接创建新的 Session，使用 Depends(get_db)
- 不要在路由函数中写业务逻辑，放到 app/services/
- 所有 API 响应必须有对应的 Pydantic schema
```

---

## .cursor/rules/（Cursor）

### 文件位置
`.cursor/rules/` 目录下，每个规则一个 `.mdc` 文件。

### 格式
每个文件包含 YAML frontmatter 和 Markdown 内容：

```markdown
---
description: 规则描述（AI决定是否加载此规则的依据）
globs: ["匹配模式1", "匹配模式2"]  # Auto Attached 类型需要
alwaysApply: true|false            # true = Always 类型
---

[规则内容]
```

### 规则类型

| 类型 | alwaysApply | globs | 加载时机 |
|------|-------------|-------|---------|
| Always | true | 不需要 | 每次对话 |
| Auto Attached | false | 需要设置 | 引用文件匹配 glob 时 |
| Agent Requested | false | 不需要 | AI 根据描述自行决定 |
| Manual | false | 不需要 | 用户 @引用 时 |

### 示例文件结构

**.cursor/rules/general.mdc**（Always）：
```markdown
---
description: 通用编码标准和项目约定
alwaysApply: true
---

# 通用规范

## 命令
- 安装：`npm install`
- 开发：`npm run dev`
- 测试：`npm test`

## 约定
- 使用 TypeScript strict 模式
- 使用函数式组件和 Hooks
- 提交格式：Conventional Commits

## 禁止
- 不要使用 any 类型
- 不要提交 console.log
```

**.cursor/rules/frontend.mdc**（Auto Attached）：
```markdown
---
description: 前端组件开发规范
globs: ["src/components/**/*.tsx", "src/components/**/*.css"]
alwaysApply: false
---

# 前端规范

- 组件使用 PascalCase 命名
- 样式使用 Tailwind CSS，不使用 inline style
- 状态管理使用 Zustand store
- 每个 页面组件 放在 app/ 目录对应路由下
```

**.cursor/rules/database.mdc**（Agent Requested）：
```markdown
---
description: 数据库模式和迁移规范，涉及 Prisma 或数据库变更时使用
alwaysApply: false
---

# 数据库规范

- 修改 schema 后运行：`npx prisma generate` 和 `npx prisma db push`
- 迁移脚本：`npx prisma migrate dev --name 描述`
- 不要手动修改 SQL 迁移文件
- 新增字段必须有默认值或设为可选
```

---

## .github/copilot-instructions.md（GitHub Copilot）

### 文件位置
`.github/copilot-instructions.md`

### 格式
纯 Markdown，GitHub 建议保持简洁、使用祈使句。

### 示例
```markdown
# Copilot 指令

## 项目
Next.js 14 App Router + TypeScript + Prisma + Tailwind CSS

## 命令
- 开发：`npm run dev`
- 测试：`npm test`
- 检查：`npm run lint`

## 编码标准
- 使用 TypeScript strict 模式，不允许 any
- React 组件使用函数式 + Hooks
- 数据获取使用 Server Components
- 样式使用 Tailwind CSS 类名

## 约束
- 不要修改 prisma/generated/ 目录
- 不要在客户端组件中直接访问数据库
- API 路由放在 app/api/ 下
- 新增 API 必须有输入校验
```

---

## .windsurfrules（Windsurf）

### 文件位置
项目根目录 `.windsurfrules`

### 格式
纯 Markdown，简洁风格。

### 示例
与 copilot-instructions.md 格式类似，内容可复用统一源文档的核心部分。
