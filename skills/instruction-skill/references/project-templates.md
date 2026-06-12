# 各类型项目规范模板

以下模板用于快速生成不同类型项目的规范文件。根据项目实际情况修改，删除不适用的部分。

## 模板一：React/Next.js 前端项目

```markdown
# [项目名称] — AI 编程规范

## 项目概述
[一句话描述]。
技术栈：Next.js 14 (App Router) + TypeScript + Tailwind CSS + [状态管理库]

## 常用命令
| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 启动开发 | `npm run dev` |
| 构建 | `npm run build` |
| 运行测试 | `npm test` |
| 测试监视 | `npm test -- --watch` |
| 代码检查 | `npm run lint` |
| 格式化 | `npm run format` |
| 类型检查 | `npm run typecheck` |

## 项目结构
```
src/
├── app/           # Next.js App Router 页面
├── components/    # 可复用组件
├── hooks/         # 自定义 Hooks
├── lib/           # 工具函数和配置
├── stores/        # 状态管理
├── types/         # TypeScript 类型定义
└── styles/        # 全局样式
```

## 代码约定
### 命名
- 组件文件：`PascalCase.tsx`
- 工具函数：`camelCase.ts`
- 自定义 Hooks：`useCamelCase.ts`
- 类型文件：`*.types.ts`
- CSS Modules：`*.module.css`

### 组件模式
**推荐：**
```tsx
// 函数式组件，Props 类型定义在同文件
interface ButtonProps {
  variant?: 'primary' | 'secondary'
  children: React.ReactNode
}
export function Button({ variant = 'primary', children }: ButtonProps) {
  return <button className={styles[variant]}>{children}</button>
}
```

**不推荐：**
```tsx
// 不要使用默认导出组件
export default function Button(props: any) { ... }
```

### 数据获取
- 页面级数据获取使用 Server Components（默认）
- 交互组件使用 'use client' 指令
- 客户端数据获取使用 SWR/React Query

## 架构决策
| 决策 | 选择 | 原因 |
|------|------|------|
| 路由 | App Router | 支持Server Components，更优性能 |
| 状态管理 | [Zustand/Redux/Jotai] | [原因] |
| 样式方案 | Tailwind CSS | 原子化CSS，开发效率高 |

## 绝对不要
- 不要在 Server Components 中使用 useState/useEffect
- 不要使用 any 类型
- 不要直接在组件中调用 fetch，使用 lib/api.ts 封装
- 不要修改 next.config.js 中的环境变量配置

## 测试
- 框架：Vitest + React Testing Library
- 位置：与源文件同目录，`*.test.tsx`
- 组件测试：渲染 + 用户交互
- Hook 测试：使用 @testing-library/react-hooks
- 运行单个：`npm test -- path/to/test`

## Git 约定
- 提交格式：`type(scope): description`
  - feat: 新功能
  - fix: 修复
  - refactor: 重构
  - test: 测试
  - docs: 文档
- 分支：`feature/描述`、`fix/描述`
```

---

## 模板二：Python 后端项目

```markdown
# [项目名称] — AI 编程规范

## 项目概述
[一句话描述]。
技术栈：Python 3.11+ / FastAPI + SQLAlchemy + [其他]

## 常用命令
| 操作 | 命令 |
|------|------|
| 创建虚拟环境 | `python -m venv .venv` |
| 激活环境 | `source .venv/bin/activate` |
| 安装依赖 | `pip install -r requirements.txt` |
| 启动开发 | `uvicorn app.main:app --reload` |
| 运行测试 | `pytest` |
| 测试覆盖率 | `pytest --cov=app` |
| 代码检查 | `ruff check .` |
| 格式化 | `ruff format .` |
| 类型检查 | `mypy app/` |

## 项目结构
```
app/
├── main.py           # 应用入口
├── routers/          # API路由
├── services/         # 业务逻辑
├── models/           # 数据库模型
├── schemas/          # Pydantic模型
├── dependencies/     # 依赖注入
├── core/             # 配置和安全
└── utils/            # 工具函数
tests/
├── unit/             # 单元测试
├── integration/      # 集成测试
└── conftest.py       # 测试配置
```

## 代码约定
### 命名
- 文件：`snake_case.py`
- 类：`PascalCase`
- 函数/变量：`snake_case`
- 常量：`UPPER_SNAKE_CASE`

### API 模式
**推荐：**
```python
@router.get("/users/{user_id}", response_model=UserSchema)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db)):
    user = await UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

**不推荐：**
```python
@router.get("/users/{user_id}")
def get_user(user_id):
    session = Session()
    user = session.query(User).get(user_id)
    return user
```

## 绝对不要
- 不要创建新的 Session，使用 `Depends(get_db)`
- 不要在路由中写业务逻辑，放到 services/
- 不要跳过 Pydantic 模型直接返回 ORM 对象
- 不要硬编码配置，使用 app/core/config.py

## 测试
- 框架：pytest + httpx (异步测试用 pytest-asyncio)
- 位置：tests/ 目录，镜像 app/ 结构
- 命名：`test_*.py`
- Fixture：定义在 conftest.py
- 运行单个：`pytest tests/unit/test_user.py -v`
```

---

## 模板三：全栈项目

```markdown
# [项目名称] — AI 编程规范

## 项目概述
[一句话描述]。
技术栈：
- 前端：Next.js 14 + TypeScript + Tailwind CSS
- 后端：FastAPI + Python 3.11
- 数据库：PostgreSQL + Prisma/SQLAlchemy

## 常用命令
### 前端
| 操作 | 命令 |
|------|------|
| 安装依赖 | `cd frontend && npm install` |
| 启动开发 | `cd frontend && npm run dev` |
| 测试 | `cd frontend && npm test` |

### 后端
| 操作 | 命令 |
|------|------|
| 安装依赖 | `cd backend && pip install -r requirements.txt` |
| 启动开发 | `cd backend && uvicorn app.main:app --reload` |
| 测试 | `cd backend && pytest` |

## 项目结构
```
frontend/          # Next.js 前端
├── src/
│   ├── app/       # 页面路由
│   ├── components/# 组件
│   └── lib/       # 工具和API客户端
backend/           # FastAPI 后端
├── app/
│   ├── routers/   # API路由
│   ├── services/  # 业务逻辑
│   └── models/    # 数据模型
shared/            # 前后端共享类型定义
```

## 架构决策
| 决策 | 选择 | 原因 |
|------|------|------|
| API 风格 | REST | 简单直观，团队熟悉 |
| 认证 | JWT | 无状态，前后端分离友好 |
| 数据库迁移 | [Prisma Migrate/Alembic] | [原因] |

## 绝对不要
- 不要在前端直接访问数据库
- 不要跳过 API 层直接从后端获取数据
- 不要在 API 响应中暴露内部数据模型
- 不要硬编码 API URL，使用环境变量

## 跨端约定
- API 响应格式：`{ data: T, error?: string }`
- 错误码：HTTP 标准状态码 + 业务错误码
- 分页：`?page=1&size=20`，响应包含 `total`
- 日期格式：ISO 8601（`2024-01-15T10:30:00Z`）
```

---

## 模板四：Monorepo 项目

```markdown
# [项目名称] — AI 编程规范

## 项目概述
[一句话描述]。
使用 [Turborepo/pnpm workspaces/Nx] 管理 monorepo。

## 常用命令
| 操作 | 命令 |
|------|------|
| 安装所有依赖 | `pnpm install` |
| 构建所有包 | `pnpm build` |
| 运行所有测试 | `pnpm test` |
| 检查所有包 | `pnpm lint` |
| 开发特定包 | `pnpm --filter @org/package-name dev` |

## 项目结构
```
packages/
├── ui/             # 共享UI组件库
├── utils/          # 共享工具函数
├── config/         # 共享配置（ESLint、TSConfig等）
├── tsconfig/       # 共享TypeScript配置
apps/
├── web/            # Web应用
├── admin/          # 管理后台
└── docs/           # 文档站点
```

## Monorepo 特定约定
- 包命名：`@org/package-name`
- 包之间依赖使用 workspace 协议：`"ui": "workspace:*"`
- 共享类型放在 packages/types/
- 修改共享包后，检查所有依赖它的应用
- 不要在应用中直接引用另一个应用的代码

## 绝对不要
- 不要在 apps/ 之间创建直接依赖
- 不要复制粘贴共享代码，抽取到 packages/
- 不要锁定特定包的版本，使用 workspace 协议
```
