#!/bin/bash
# ============================================
# Dev Workflow Skills — 一键安装脚本
# 无需 clone，一条命令直接安装到 Claude Code 和 Codex
# ============================================

set -e

PLUGIN_NAME="dev-workflow-skills"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

# 默认仓库地址（可通过环境变量覆盖）
REPO_URL="${DEV_WORKFLOW_SKILLS_REPO:-https://github.com/BBJI/dev-workflow-skills.git}"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Dev Workflow Skills — 一键安装             ║"
echo "║   Loop Engineering 全流程交付技能套件        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# -------------------------------------------
# Node.js 脚本：更新 settings.json
# -------------------------------------------
run_node_install() {
  local ACTION="$1"  # install or uninstall
  shift

  local TEMP_FILE=$(mktemp /tmp/dev-workflow-skills.XXXXXX.js)
  trap "rm -f $TEMP_FILE" EXIT

  if [ "$ACTION" = "uninstall" ]; then
    cat > "$TEMP_FILE" << 'NODEEOF'
const fs = require('fs');
const path = require('path');
const settingsPath = process.argv[2];
const pluginName = process.argv[3];

try {
    if (!fs.existsSync(settingsPath)) { process.exit(0); }
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const key = pluginName + '@' + pluginName;
    let changed = false;
    if (s.enabledPlugins && s.enabledPlugins[key]) {
        delete s.enabledPlugins[key];
        console.log('  ✅ 已从 enabledPlugins 移除');
        changed = true;
    }
    if (s.extraKnownMarketplaces && s.extraKnownMarketplaces[pluginName]) {
        delete s.extraKnownMarketplaces[pluginName];
        console.log('  ✅ 已从 marketplaces 移除');
        changed = true;
    }
    if (changed) {
        fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
        console.log('  ✅ settings.json 已更新');
    }
} catch (e) {
    console.error('  ❌ 更新失败:', e.message);
}
NODEEOF
    node "$TEMP_FILE" "$SETTINGS_FILE" "$PLUGIN_NAME"
  else
    cat > "$TEMP_FILE" << 'NODEEOF'
const fs = require('fs');
const path = require('path');
const settingsPath = process.argv[2];
const pluginName = process.argv[3];
const repoUrl = process.argv[4];

try {
    const dir = path.dirname(settingsPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let settings = {};
    if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    let changed = false;

    if (!settings.extraKnownMarketplaces) settings.extraKnownMarketplaces = {};
    settings.extraKnownMarketplaces[pluginName] = {
        source: { source: 'git', url: repoUrl }
    };
    console.log('  ✅ marketplace 已注册/更新');
    changed = true;

    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    const key = pluginName + '@' + pluginName;
    settings.enabledPlugins[key] = true;
    console.log('  ✅ 插件已启用/更新');
    changed = true;

    if (changed) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('  ✅ settings.json 已更新');
    } else {
        console.log('  ℹ️  无需更新，插件已安装');
    }
} catch (e) {
    console.error('  ❌ 更新失败:', e.message);
    process.exit(1);
}
NODEEOF
    node "$TEMP_FILE" "$SETTINGS_FILE" "$PLUGIN_NAME" "$REPO_URL"
  fi
}

# -------------------------------------------
# 更新 installed_plugins.json
# -------------------------------------------
update_installed_plugins() {
  local VERSION="$1"
  local GIT_SHA="$2"
  local CACHE_DIR="$3"
  local INSTALLED_FILE="$CLAUDE_DIR/plugins/installed_plugins.json"

  local TEMP_FILE=$(mktemp /tmp/dev-workflow-skills.XXXXXX.js)
  cat > "$TEMP_FILE" << NODEEOF
const fs = require('fs');
const path = require('path');
const claudeDir = process.argv[2];
const pluginName = process.argv[3];
const version = process.argv[4];
const gitSha = process.argv[5];
const installPath = process.argv[6];

try {
    const installedPath = path.join(claudeDir, 'plugins', 'installed_plugins.json');
    let data = { version: 2, plugins: {} };
    if (fs.existsSync(installedPath)) {
        data = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
    }
    if (!data.plugins) data.plugins = {};

    const key = pluginName + '@' + pluginName;
    data.plugins[key] = [{
        scope: 'user',
        installPath: installPath,
        version: version,
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        gitCommitSha: gitSha
    }];

    fs.writeFileSync(installedPath, JSON.stringify(data, null, 2));
    console.log('  ✅ installed_plugins.json 已更新');
} catch (e) {
    console.error('  ⚠️ 更新 installed_plugins.json 失败:', e.message);
}
NODEEOF
  node "$TEMP_FILE" "$CLAUDE_DIR" "$PLUGIN_NAME" "$VERSION" "$GIT_SHA" "$CACHE_DIR"
  rm -f "$TEMP_FILE"
}

# -------------------------------------------
# 解析参数
# -------------------------------------------
INSTALL_CLAUDE=false
INSTALL_CODEX=false
TARGET_PROJECT=""
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --claude)   INSTALL_CLAUDE=true; shift ;;
    --codex)    INSTALL_CODEX=true; shift ;;
    --project)  TARGET_PROJECT="$2"; shift 2 ;;
    --repo)     REPO_URL="$2"; shift 2 ;;
    --uninstall) UNINSTALL=true; shift ;;
    --help|-h)
      echo "用法: curl -fsSL <url>/install.sh | bash -s -- [选项]"
      echo ""
      echo "选项:"
      echo "  --claude           安装到 Claude Code（默认包含）"
      echo "  --codex            同时为 Codex 生成 AGENTS.md"
      echo "  --project <path>   Codex 目标项目目录"
      echo "  --repo <url>       自定义 git 仓库地址"
      echo "  --uninstall        卸载"
      echo "  -h, --help         显示帮助"
      echo ""
      echo "示例:"
      echo "  # 一键安装到 Claude Code"
      echo "  curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash"
      echo ""
      echo "  # 同时安装到 Claude Code + Codex"
      echo "  curl -fsSL https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.sh | bash -s -- --codex --project ./my-app"
      echo ""
      echo "  # 使用内部 GitLab"
      echo "  curl -fsSL https://gitlab.example.com/skills/install.sh | bash -s -- --repo https://gitlab.example.com/skills/dev-workflow-skills.git"
      exit 0
      ;;
    *)
      echo "未知参数: $1，使用 --help 查看帮助"
      exit 1
      ;;
  esac
done

# 默认安装到 Claude Code
if [ "$INSTALL_CLAUDE" = false ] && [ "$INSTALL_CODEX" = false ] && [ "$UNINSTALL" = false ]; then
  INSTALL_CLAUDE=true
fi

# -------------------------------------------
# 卸载
# -------------------------------------------
if [ "$UNINSTALL" = true ]; then
  echo "📦 卸载 Dev Workflow Skills..."

  if command -v node &> /dev/null; then
    run_node_install uninstall
  fi

  # 清理缓存
  CACHE_DIR="$CLAUDE_DIR/plugins/cache/$PLUGIN_NAME"
  MARKET_DIR="$CLAUDE_DIR/plugins/marketplaces/$PLUGIN_NAME"

  # Kill any running dashboard processes
  find "$CACHE_DIR" -name ".dashboard.pid" -exec cat {} \; 2>/dev/null | while read pid; do
    kill "$pid" 2>/dev/null || true
  done

  rm -rf "$CACHE_DIR" "$MARKET_DIR" 2>/dev/null
  echo "  ✅ 缓存已清理"
  echo ""
  echo "🎉 卸载完成！重启 Claude Code 即可生效。"
  exit 0
fi

# -------------------------------------------
# 安装到 Claude Code
# -------------------------------------------
install_claude() {
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 安装到 Claude Code..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  仓库: $REPO_URL"

  if ! command -v node &> /dev/null; then
    echo "  ❌ 需要 Node.js 来更新配置文件"
    echo "  请手动编辑 ~/.claude/settings.json："
    echo ""
    echo '  1. 在 enabledPlugins 中添加:'
    echo "     \"$PLUGIN_NAME@$PLUGIN_NAME\": true"
    echo ""
    echo '  2. 在 extraKnownMarketplaces 中添加:'
    echo "     \"$PLUGIN_NAME\": {"
    echo "       \"source\": { \"source\": \"git\", \"url\": \"$REPO_URL\" }"
    echo "     }"
    return 1
  fi

  run_node_install install

  # 克隆/更新 marketplace
  MARKET_DIR="$CLAUDE_DIR/plugins/marketplaces/$PLUGIN_NAME"
  if [ -d "$MARKET_DIR" ]; then
    echo "  → 更新 marketplace..."
    (cd "$MARKET_DIR" && git pull --ff-only 2>/dev/null || true)
  else
    echo "  → 克隆仓库到 marketplace..."
    git clone --depth 1 "$REPO_URL" "$MARKET_DIR"
  fi

  # 获取版本号和 commit sha
  GIT_SHA=$(cd "$MARKET_DIR" && git rev-parse --short HEAD)
  VERSION=$(node -e "console.log(require('$MARKET_DIR/.claude-plugin/plugin.json').version)")

  # 创建 cache 目录结构
  CACHE_DIR="$CLAUDE_DIR/plugins/cache/$PLUGIN_NAME/$PLUGIN_NAME/$VERSION"
  rm -rf "$CACHE_DIR"
  mkdir -p "$CACHE_DIR"

  # 复制插件文件到 cache
  cp -r "$MARKET_DIR/.claude-plugin" "$CACHE_DIR/"
  cp -r "$MARKET_DIR/skills" "$CACHE_DIR/"
  cp -r "$MARKET_DIR/commands" "$CACHE_DIR/"

  # Install dashboard dependencies
  DASHBOARD_DIR="$CACHE_DIR/skills/workflow-skill/dashboard"
  if [ -d "$DASHBOARD_DIR" ] && [ -f "$DASHBOARD_DIR/package.json" ]; then
    echo "  → Installing dashboard dependencies..."
    (cd "$DASHBOARD_DIR" && npm install --production 2>/dev/null)
    if [ $? -eq 0 ]; then
      echo "  ✅ Dashboard dependencies installed"
    else
      echo "  ⚠️  Dashboard dependencies installation failed (dashboard will not be available)"
      echo "     You can install manually: cd ~/.claude/plugins/cache/dev-workflow-skills/.../skills/workflow-skill/dashboard && npm install"
    fi
  fi
  [ -d "$MARKET_DIR/codex" ] && cp -r "$MARKET_DIR/codex" "$CACHE_DIR/"
  [ -f "$MARKET_DIR/README.md" ] && cp "$MARKET_DIR/README.md" "$CACHE_DIR/"

  # 创建 .claude/skills/ 目录（Claude Code 加载技能的标准路径）
  mkdir -p "$CACHE_DIR/.claude/skills"
  for skill_dir in "$CACHE_DIR/skills"/*/; do
    [ -d "$skill_dir" ] && cp -r "$skill_dir" "$CACHE_DIR/.claude/skills/"
  done

  # 更新 installed_plugins.json
  update_installed_plugins "$VERSION" "$GIT_SHA" "$CACHE_DIR"

  echo "  ✅ 插件缓存已创建"

  echo ""
  echo "  🎉 Claude Code 安装完成！"
  echo ""
  echo "  可用命令（重启 Claude Code 后生效）："
  echo "    /req <需求描述>      — 需求调研分析"
  echo "    /design              — UI/UX 设计"
  echo "    /review              — 实现评估"
  echo "    /task                — 任务拆分排期"
  echo "    /dev <任务描述>      — 开发实现"
  echo "    /test                — 测试验证"
  echo "    /instruct            — 项目规范生成"
  echo "    /workflow <需求描述> — 全流程交付"
}

# -------------------------------------------
# 安装到 Codex
# -------------------------------------------
install_codex() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📦 为 Codex 生成 AGENTS.md..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  if [ -z "$TARGET_PROJECT" ]; then
    echo "  ⚠️  Codex 安装需要指定项目目录"
    echo "  用法: ... | bash -s -- --codex --project /path/to/project"
    read -p "  请输入目标项目路径: " TARGET_PROJECT
    if [ -z "$TARGET_PROJECT" ]; then
      echo "  跳过 Codex 安装"
      return
    fi
  fi

  # 展开相对路径
  TARGET_PROJECT=$(cd "$TARGET_PROJECT" 2>/dev/null && pwd || echo "$TARGET_PROJECT")

  if [ ! -d "$TARGET_PROJECT" ]; then
    echo "  ❌ 目录不存在: $TARGET_PROJECT"
    return 1
  fi

  # 下载 AGENTS.md（从仓库 raw URL）
  local AGENTS_URL="${REPO_URL%.git}/raw/master/codex/AGENTS.md"

  # 如果是 gitlab，URL 格式不同
  if echo "$REPO_URL" | grep -q "gitlab"; then
    AGENTS_URL="${REPO_URL%.git}/-/raw/master/codex/AGENTS.md"
  fi

  if command -v curl &> /dev/null; then
    echo "  → 下载 AGENTS.md 到 $TARGET_PROJECT/AGENTS.md ..."
    if curl -fsSL "$AGENTS_URL" -o "$TARGET_PROJECT/AGENTS.md" 2>/dev/null; then
      echo "  ✅ AGENTS.md 已生成"
    else
      echo "  ⚠️  无法从仓库下载，尝试本地生成..."
      generate_agents_md
    fi
  else
    echo "  → 无 curl，本地生成 AGENTS.md ..."
    generate_agents_md
  fi

  echo ""
  echo "  🎉 Codex 安装完成！"
  echo "  📋 请根据项目编辑 AGENTS.md 中的常用命令和项目结构"
}

# 本地生成 AGENTS.md（当无法从仓库下载时的回退方案）
generate_agents_md() {
  local TARGET="$TARGET_PROJECT/AGENTS.md"

  if [ -f "$TARGET" ]; then
    echo "  ⚠️  已存在 AGENTS.md"
    read -p "  是否覆盖？(y/N): " overwrite
    if [ "$overwrite" != "y" ] && [ "$overwrite" != "Y" ]; then
      echo "  跳过"
      return
    fi
    cp "$TARGET" "$TARGET.bak"
    echo "  ✅ 已备份原文件"
  fi

  cat > "$TARGET" << 'AGENTSEOF'
# Dev Skills — AI 自主交付工作流

## 概述
本文件为 OpenAI Codex 提供全流程软件交付工作流指令。基于 Loop Engineering 原则，支持从需求到交付的自主闭环。

## 角色能力
你同时具备以下8种角色能力，按需切换：

### 1. 需求分析师
- 将模糊想法转化为结构化需求（FR-xxx + NFR-xxx）
- 强制澄清步骤不可跳过
- 输出：需求文档、追溯矩阵、待决问题/风险

### 2. UI/UX 设计师
- 将需求转化为设计规范（设计令牌、组件规格、页面布局、交互模式）
- 所有组件必须覆盖完整状态（默认/悬停/聚焦/禁用/加载/错误）
- 无障碍作为默认要求（WCAG 2.2 AA）
- 输出：设计规范、用户流程、页面规格、设计决策日志

### 3. 实现评审员
- 三维度评估：需求覆盖、设计一致性、技术可行性
- 识别跨维度缺口
- 按致命/高/中/低分级风险
- 输出：评估报告、风险登记

### 4. 任务协调者
- 分解为50-200行代码的原子任务
- 构建依赖图和关键路径
- MoSCoW优先级 + 执行优先级
- 输出：任务分解、迭代计划、进度跟踪器

### 5. 开发者
- 按规格编码，匹配项目现有模式
- 同步编写测试（测试金字塔：单元>集成>E2E）
- Bug修复必须先写失败测试
- 输出：实现代码、测试代码、完成报告

### 6. 测试工程师
- 功能/非功能/无障碍/安全/视觉一致性全维度测试
- Bug报告必须包含复现步骤
- 回归测试验证修复不引入新问题
- 输出：测试结果、Bug报告、通过/不通过评估

### 7. 规范生成器
- 为 AI 编程工具生成项目规范文件
- 已有项目：流程前生成；新项目：流程后生成
- 支持 CLAUDE.md、AGENTS.md、.cursor/rules/、copilot-instructions.md
- 输出：各工具格式的规范文件

### 8. 工作流编排者
- 编排以上7种角色形成闭环
- 开发↔测试形成收敛循环（最多3轮Bug修复）
- 门控检查：每个阶段有退出条件
- 人工检查点：可配置自主级别

## 常用命令
| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 启动开发 | `npm run dev` |
| 运行测试 | `npm test` |
| 代码检查 | `npm run lint` |
| 构建 | `npm run build` |

## 工作流程
### 判断项目类型
- 已有项目：先执行项目规范生成，再进入需求分析
- 新项目：先进入需求分析，最后生成项目规范

### 阶段顺序
1. 项目规范（条件执行）
2. 需求分析 — 澄清→分解→结构化→验证
3. UI/UX设计 — 信息架构→用户流程→设计令牌→组件→页面→交互
4. 实现评估 — 需求覆盖→一致性→可行性→缺口→风险
5. 任务拆分 — 识别→映射→依赖→估算→优先级→迭代计划
6. 开发实现 — 理解→探索→实现→测试→自检→Bug修复
7. 测试验证 — 功能→非功能→无障碍→安全→视觉→回归→报告
8. 项目规范（新项目）

### 收敛规则
- 开发↔测试闭环最多3轮Bug修复
- Bug数量应递减：[N] → [N/3] → [0]
- 3轮不收敛则暂停分析根因

## 规则与约束
- 不要跳过需求澄清步骤
- 不要只设计正常路径
- 非功能需求是一等公民
- Bug修复必须先写失败测试
- 每个设计决策都要追溯到需求
- 规范文件保持在200行以内
- 用祈使句和可量化标准

## 术语表
| 术语 | 含义 |
|------|------|
| FR-xxx | 功能需求编号 |
| NFR-xxx | 非功能需求编号 |
| MoSCoW | Must/Should/Could/Won't 优先级 |
| Loop Engineering | 收敛反馈闭环的工程方法 |
AGENTSEOF

  echo "  ✅ AGENTS.md 已本地生成"
}

# -------------------------------------------
# 执行安装
# -------------------------------------------
if [ "$INSTALL_CLAUDE" = true ]; then
  install_claude
fi

if [ "$INSTALL_CODEX" = true ]; then
  install_codex
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 安装完成！"
echo ""
echo "💡 使用提示:"
echo "  • 重启 Claude Code 后输入 /workflow 启动全流程"
echo "  • 也可单独使用 /req, /design 等触发特定阶段"
echo "  • 卸载: curl -fsSL <url>/install.sh | bash -s -- --uninstall"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
