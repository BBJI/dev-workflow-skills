#!/usr/bin/env pwsh
# ============================================
# Dev Workflow Skills — PowerShell 一键安装脚本
# 无需 clone，一条命令直接安装到 Claude Code 和 Codex
# ============================================

param(
    [switch]$Claude,
    [switch]$Codex,
    [string]$Project = "",
    [string]$Repo = "",
    [switch]$Uninstall,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

$PLUGIN_NAME = "dev-workflow-skills"
$CLAUDE_DIR = Join-Path $env:USERPROFILE ".claude"
$SETTINGS_FILE = Join-Path $CLAUDE_DIR "settings.json"
$REPO_URL = if ($Repo) { $Repo } else { "https://github.com/BBJI/dev-workflow-skills.git" }

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   Dev Workflow Skills - 一键安装" -ForegroundColor Cyan
Write-Host "   Loop Engineering 全流程交付技能套件" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# -------------------------------------------
# 帮助
# -------------------------------------------
if ($Help) {
    Write-Host "用法:"
    Write-Host "  # 一键安装到 Claude Code（PowerShell）"
    Write-Host "  irm https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 | iex"
    Write-Host ""
    Write-Host "  # 一键安装到 Claude Code（CMD）"
    Write-Host '  powershell -Command "irm https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 | iex"'
    Write-Host ""
    Write-Host "  # 同时安装到 Claude Code + Codex"
    Write-Host "  irm https://raw.githubusercontent.com/BBJI/dev-workflow-skills/master/install.ps1 -OutFile install.ps1"
    Write-Host '  .\install.ps1 -Codex -Project "C:\my-app"'
    Write-Host ""
    Write-Host "参数:"
    Write-Host "  -Claude           安装到 Claude Code（默认）"
    Write-Host "  -Codex            为 Codex 生成 AGENTS.md"
    Write-Host "  -Project <path>   Codex 目标项目目录"
    Write-Host "  -Repo <url>       自定义仓库地址"
    Write-Host "  -Uninstall        卸载"
    Write-Host "  -Help             显示帮助"
    return
}

# 默认安装到 Claude Code
if (-not $Claude -and -not $Codex -and -not $Uninstall) {
    $Claude = $true
}

# -------------------------------------------
# Node.js 脚本：更新 settings.json
# -------------------------------------------
$NodeInstallScript = @'
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
    console.log('  [OK] marketplace 已注册/更新');
    changed = true;

    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    const key = pluginName + '@' + pluginName;
    settings.enabledPlugins[key] = true;
    console.log('  [OK] 插件已启用/更新');
    changed = true;

    if (changed) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log('  [OK] settings.json 已更新');
    } else {
        console.log('  [INFO] 无需更新，插件已安装');
    }
} catch (e) {
    console.error('  [ERROR] 更新失败:', e.message);
    process.exit(1);
}
'@

$NodeUninstallScript = @'
const fs = require('fs');
const settingsPath = process.argv[2];
const pluginName = process.argv[3];

try {
    if (!fs.existsSync(settingsPath)) { process.exit(0); }
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const key = pluginName + '@' + pluginName;
    let changed = false;
    if (s.enabledPlugins && s.enabledPlugins[key]) {
        delete s.enabledPlugins[key];
        console.log('  [OK] 已从 enabledPlugins 移除');
        changed = true;
    }
    if (s.extraKnownMarketplaces && s.extraKnownMarketplaces[pluginName]) {
        delete s.extraKnownMarketplaces[pluginName];
        console.log('  [OK] 已从 marketplaces 移除');
        changed = true;
    }
    if (changed) {
        fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
        console.log('  [OK] settings.json 已更新');
    }
} catch (e) {
    console.error('  [ERROR] 更新失败:', e.message);
}
'@

function Run-NodeScript {
    param([string]$Script, [string[]]$NodeArgs)
    $tempFile = [System.IO.Path]::GetTempFileName() + ".js"
    try {
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
        [System.IO.File]::WriteAllText($tempFile, $Script, $utf8NoBom)
        & node $tempFile @NodeArgs
    } finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
}

# -------------------------------------------
# Node.js 脚本：更新 installed_plugins.json
# -------------------------------------------
$NodeUpdateInstalledPlugin = @'
const fs = require('fs');
const path = require('path');
const claudeDir = path.dirname(process.argv[2]);
const pluginName = process.argv[3];
const installPath = process.argv[4];
const version = process.argv[5];
const gitSha = process.argv[6];

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
    console.log('  [OK] installed_plugins.json 已更新');
} catch (e) {
    console.error('  [WARN] 更新 installed_plugins.json 失败:', e.message);
}
'@

# -------------------------------------------
# 卸载
# -------------------------------------------
if ($Uninstall) {
    Write-Host "卸载 Dev Workflow Skills..." -ForegroundColor Yellow

    if (Get-Command node -ErrorAction SilentlyContinue) {
        Run-NodeScript $NodeUninstallScript @($SETTINGS_FILE, $PLUGIN_NAME)
    } else {
        Write-Host "  [WARN] 需要 Node.js 来更新配置文件" -ForegroundColor Yellow
    }

    $cacheDir = Join-Path $CLAUDE_DIR "plugins\cache\$PLUGIN_NAME"
    $marketDir = Join-Path $CLAUDE_DIR "plugins\marketplaces\$PLUGIN_NAME"

    # Kill any running dashboard processes
    Get-ChildItem -Path $cacheDir -Filter ".dashboard.pid" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $pid = Get-Content $_.FullName -Encoding utf8 -ErrorAction SilentlyContinue
        if ($pid) {
            try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
        }
    }

    if (Test-Path $cacheDir) { Remove-Item $cacheDir -Recurse -Force }
    if (Test-Path $marketDir) { Remove-Item $marketDir -Recurse -Force }
    Write-Host "  [OK] 缓存已清理" -ForegroundColor Green
    Write-Host ""
    Write-Host "卸载完成！重启 Claude Code 即可生效。" -ForegroundColor Green
    return
}

# -------------------------------------------
# 安装到 Claude Code
# -------------------------------------------
if ($Claude) {
    Write-Host "------------------------------------------------"
    Write-Host "安装到 Claude Code..." -ForegroundColor Cyan
    Write-Host "------------------------------------------------"
    Write-Host "  仓库: $REPO_URL"

    if (Get-Command node -ErrorAction SilentlyContinue) {
        Run-NodeScript $NodeInstallScript @($SETTINGS_FILE, $PLUGIN_NAME, $REPO_URL)

        # 克隆/更新 marketplace
        $marketDir = Join-Path $CLAUDE_DIR "plugins\marketplaces\$PLUGIN_NAME"
        if (Test-Path $marketDir) {
            # 检查是否是有效的 git 仓库
            $isGitRepo = Test-Path (Join-Path $marketDir ".git")
            if ($isGitRepo) {
                Write-Host "  更新 marketplace..." -ForegroundColor Gray
                Push-Location $marketDir
                git pull --ff-only 2>&1 | Write-Host
                Pop-Location
            } else {
                Write-Host "  marketplace 目录损坏，重新克隆..." -ForegroundColor Yellow
                Remove-Item $marketDir -Recurse -Force -ErrorAction SilentlyContinue
                & git clone --depth 1 $REPO_URL $marketDir 2>&1 | Write-Host
            }
        } else {
            Write-Host "  克隆仓库到 marketplace..." -ForegroundColor Gray
            & git clone --depth 1 $REPO_URL $marketDir 2>&1 | Write-Host
        }

        # 等待目录出现（git clone 可能在后台执行）
        $waitCount = 0
        while (-not (Test-Path $marketDir) -and $waitCount -lt 30) {
            Start-Sleep -Milliseconds 500
            $waitCount++
        }

        if (-not (Test-Path $marketDir)) {
            Write-Host "  [ERROR] 克隆仓库失败" -ForegroundColor Red
            Write-Host "  请检查:" -ForegroundColor Yellow
            Write-Host "    1. git 是否在 PATH 中 (运行 git --version 验证)" -ForegroundColor Yellow
            Write-Host "    2. 网络是否能访问 $REPO_URL" -ForegroundColor Yellow
            Write-Host "    3. 目录 $marketDir 是否被其他进程占用" -ForegroundColor Yellow
            return
        }

        # 获取 commit sha 和版本号
        Push-Location $marketDir
        $gitSha = git rev-parse --short HEAD
        $pluginJsonPath = Join-Path $marketDir ".claude-plugin\plugin.json"
        $version = ([System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($pluginJsonPath)) | ConvertFrom-Json).version
        Pop-Location

        # 创建 cache 目录结构
        $cacheDir = Join-Path $CLAUDE_DIR "plugins\cache\$PLUGIN_NAME\$PLUGIN_NAME\$version"
        if (Test-Path $cacheDir) {
            Remove-Item $cacheDir -Recurse -Force
        }
        New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

        # 复制插件文件到 cache
        Copy-Item (Join-Path $marketDir ".claude-plugin") $cacheDir -Recurse
        Copy-Item (Join-Path $marketDir "skills") $cacheDir -Recurse

        # Install dashboard dependencies
        $dashboardDir = Join-Path $cacheDir "skills\workflow-skill\dashboard"
        if ((Test-Path $dashboardDir) -and (Test-Path (Join-Path $dashboardDir "package.json"))) {
            Write-Host "  Installing dashboard dependencies..." -ForegroundColor Gray
            Push-Location $dashboardDir
            & npm install --production 2>&1 | Write-Host
            if (Test-Path (Join-Path $dashboardDir "node_modules")) {
                Write-Host "  [OK] Dashboard dependencies installed" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Dashboard dependencies installation failed" -ForegroundColor Yellow
                Write-Host "         You can install manually: cd $dashboardDir && npm install" -ForegroundColor Yellow
            }
            Pop-Location
        }
        Copy-Item (Join-Path $marketDir "commands") $cacheDir -Recurse
        Copy-Item (Join-Path $marketDir "codex") $cacheDir -Recurse -ErrorAction SilentlyContinue
        if (Test-Path (Join-Path $marketDir "README.md")) {
            Copy-Item (Join-Path $marketDir "README.md") $cacheDir
        }

        # 创建 .claude/skills/ 目录（Claude Code 加载技能的标准路径）
        $claudeSkillsDir = Join-Path $cacheDir ".claude\skills"
        New-Item -ItemType Directory -Path $claudeSkillsDir -Force | Out-Null
        $skillsDir = Join-Path $cacheDir "skills"
        if (Test-Path $skillsDir) {
            Get-ChildItem $skillsDir -Directory | ForEach-Object {
                Copy-Item $_.FullName $claudeSkillsDir -Recurse
            }
        }

        # 更新 installed_plugins.json
        Run-NodeScript $NodeUpdateInstalledPlugin @($SETTINGS_FILE, $PLUGIN_NAME, $cacheDir, $version, $gitSha)

        Write-Host "  [OK] 插件缓存已创建" -ForegroundColor Green
    } else {
        Write-Host "  [ERROR] 需要 Node.js 来更新配置文件" -ForegroundColor Red
        Write-Host ""
        Write-Host "  请手动编辑 $SETTINGS_FILE ："
        Write-Host ""
        Write-Host "  1. 在 enabledPlugins 中添加:"
        Write-Host "     `"$PLUGIN_NAME@$PLUGIN_NAME`": true"
        Write-Host ""
        Write-Host "  2. 在 extraKnownMarketplaces 中添加:"
        Write-Host "     `"$PLUGIN_NAME`": {"
        Write-Host "       `"source`": { `"source`": `"git`", `"url`": `"$REPO_URL`" }"
        Write-Host "     }"
        return
    }

    Write-Host ""
    Write-Host "  Claude Code 安装完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "  可用命令（重启 Claude Code 后生效）："
    Write-Host "    /req <需求描述>      - 需求调研分析"
    Write-Host "    /design              - UI/UX 设计"
    Write-Host "    /review              - 实现评估"
    Write-Host "    /task                - 任务拆分排期"
    Write-Host "    /dev <任务描述>      - 开发实现"
    Write-Host "    /test                - 测试验证"
    Write-Host "    /instruct            - 项目规范生成"
    Write-Host "    /workflow <需求描述> - 全流程交付"
}

# -------------------------------------------
# 安装到 Codex
# -------------------------------------------
if ($Codex) {
    Write-Host ""
    Write-Host "------------------------------------------------"
    Write-Host "为 Codex 生成 AGENTS.md..." -ForegroundColor Cyan
    Write-Host "------------------------------------------------"

    if (-not $Project) {
        Write-Host "  [WARN] Codex 安装需要指定项目目录" -ForegroundColor Yellow
        Write-Host "  用法: .\install.ps1 -Codex -Project C:\my-app"
        $Project = Read-Host "  请输入目标项目路径"
        if (-not $Project) {
            Write-Host "  跳过 Codex 安装"
            return
        }
    }

    if (-not (Test-Path $Project -PathType Container)) {
        Write-Host "  [ERROR] 目录不存在: $Project" -ForegroundColor Red
        return
    }

    $agentsPath = Join-Path $Project "AGENTS.md"

    # 从仓库下载 AGENTS.md
    $downloadUrl = ""
    if ($REPO_URL -match "github\.com") {
        $downloadUrl = $REPO_URL -replace '\.git$', '/raw/master/codex/AGENTS.md'
    } elseif ($REPO_URL -match "gitlab") {
        $downloadUrl = $REPO_URL -replace '\.git$', '/-/raw/master/codex/AGENTS.md'
    }

    $downloaded = $false
    if ($downloadUrl) {
        try {
            Write-Host "  下载 AGENTS.md..."
            Invoke-WebRequest -Uri $downloadUrl -OutFile $agentsPath -UseBasicParsing
            Write-Host "  [OK] AGENTS.md 已生成" -ForegroundColor Green
            $downloaded = $true
        } catch {
            Write-Host "  [WARN] 无法从仓库下载，本地生成..." -ForegroundColor Yellow
        }
    }

    if (-not $downloaded) {
        if (Test-Path $agentsPath) {
            Write-Host "  [WARN] 已存在 AGENTS.md" -ForegroundColor Yellow
            $overwrite = Read-Host "  是否覆盖？(y/N)"
            if ($overwrite -ne "y" -and $overwrite -ne "Y") {
                Write-Host "  跳过"
            } else {
                Copy-Item $agentsPath "$agentsPath.bak"
                Write-Host "  [OK] 已备份原文件" -ForegroundColor Green
                Generate-AgentsMd $agentsPath
            }
        } else {
            Generate-AgentsMd $agentsPath
        }
    }

    Write-Host ""
    Write-Host "  Codex 安装完成！" -ForegroundColor Green
    Write-Host "  请根据项目编辑 AGENTS.md 中的常用命令和项目结构"
}

# 本地生成 AGENTS.md（回退方案）
function Generate-AgentsMd {
    param([string]$Target)

    $agentsContent = @'
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
'@
    $agentsContent | Set-Content $Target -Encoding UTF8
    Write-Host "  [OK] AGENTS.md 已本地生成" -ForegroundColor Green
}

# -------------------------------------------
# 完成
# -------------------------------------------
Write-Host ""
Write-Host "================================================"
Write-Host "安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "使用提示:"
Write-Host "  * 重启 Claude Code 后输入 /workflow 启动全流程"
Write-Host "  * 也可单独使用 /req, /design 等触发特定阶段"
Write-Host "  * 卸载: .\install.ps1 -Uninstall"
Write-Host "================================================"
