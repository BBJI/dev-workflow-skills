# 自动化浏览器验证参考

test-skill 模式二（测试验证）依赖 Playwright MCP 工具集自动驱动浏览器，把"待手动验证清单"变成 skill 自驱的自动化验证。本文档汇总辅助脚本调用、MCP 工具用法、降级决策树、产物路径约定。

## 1. 辅助脚本：serve-preview.mjs

位置：`skills/workflow-skill/dashboard/serve-preview.mjs`（与 notify-state.mjs 同目录）。

零依赖 Node ESM 脚本，负责被测应用的启动 / 停止 / 状态查询。

### 1.1 start 子命令

```bash
node "$SKILL_DIR/dashboard/serve-preview.mjs" start \
  --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME" \
  --timeout 60
```

行为：
1. 读取 `{project-root}/package.json` 的 `scripts`，按优先级 `--script` 覆盖 > `preview` > `dev` > `start` 选取
2. `spawn` `npm run <script>` 子进程 detached，cwd 为 project-root，stdout/stderr 重定向到 `.dws/{项目名}/test/.serve/log.txt`
3. 轮询候选端口 `5173/4173/3000/8080/5000/8888` 与子进程输出里出现的 `localhost:PORT`，HTTP 探测 200
4. 健康检查通过后写 `.dws/{项目名}/test/.serve/status.json`，退出码 0，子进程继续在后台运行
5. 超时（默认 60s）→ 杀子进程、写错误状态、退出码 1

成功输出（stdout JSON）：
```json
{ "ok": true, "pid": 12345, "port": 4173, "url": "http://localhost:4173", "script": "preview", "logFile": "...", "startedAt": "..." }
```

### 1.2 status 子命令

```bash
node "$SKILL_DIR/dashboard/serve-preview.mjs" status \
  --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME"
```

输出当前 status.json 内容（或 `{ "ok": false, "running": false }`）。CC 在 start 后轮询此命令拿 `url`。

### 1.3 stop 子命令

```bash
node "$SKILL_DIR/dashboard/serve-preview.mjs" stop \
  --project-root "$PROJECT_ROOT" --project-name "$PROJECT_NAME"
```

读取 status.json 的 pid，Windows 用 `taskkill /PID /T /F`、其他平台用 `SIGTERM`→`SIGKILL`，清理 status.json。

## 2. Playwright MCP 工具用法

### 2.1 导航与快照

```
browser_navigate({ url })                          → 打开页面
browser_snapshot()                                  → 取无障碍树（含 ref，用于后续 click/type 的 target）
browser_snapshot({ target: "<ref>" })               → 取特定子树
```

`browser_snapshot` 返回的每个节点有 `ref` 字段，作为 `browser_click` / `browser_type` 的 `target` 参数。这是 Playwright MCP 的核心交互模式——不写 CSS 选择器，而是先 snapshot 拿 ref 再操作。

### 2.2 交互

```
browser_click({ element: "提交按钮", target: "<ref>" })
browser_type({ element: "邮箱输入框", target: "<ref>", text: "test@example.com" })
browser_press_key({ key: "Enter" })
browser_select_option({ element: "...", target: "<ref>", values: ["opt1"] })
browser_hover({ element: "...", target: "<ref>" })
browser_fill_form({ fields: [{ target, name, type, value }, ...] })
```

### 2.3 断言（核心）

`browser_evaluate` 接收一个 `function` 字符串，在页面上下文执行并返回值。所有断言都通过它实现：

```
browser_evaluate({
  function: "() => { const el = document.querySelector('[data-testid=toast]'); return el !== null; }"
})
```

返回值会被序列化回 CC，CC 据此判定通过/失败。

**异步函数**支持（用于 axe-core 注入）：
```
browser_evaluate({
  function: "async () => { await loadAxe(); return await window.axe.run(document); }"
})
```

### 2.4 证据采集

```
browser_take_screenshot({ filename: "TC-001-fail.png" })   → 截图存到默认目录
browser_console_messages({ level: "error" })               → 取所有 error 级控制台消息
browser_console_messages({ all: true })                    → 取全部消息（含网络错误）
browser_network_requests({ filter: "/api/" })              → 取匹配的 XHR
```

### 2.5 视口与等待

```
browser_resize({ width: 375, height: 667 })         → 切到移动端视口
browser_wait_for({ text: "保存成功" })                → 等文本出现
browser_wait_for({ time: 1 })                        → 固定等待（少用）
```

## 3. 典型测试模式

### 3.1 表单提交 + 校验

```
1. browser_navigate → /settings
2. browser_snapshot → 拿到邮箱输入框 ref、提交按钮 ref
3. browser_type({ target: emailRef, text: "" })               // 留空
4. browser_click({ target: submitRef })
5. browser_evaluate({
     function: "() => { const e = document.querySelector('#email-error'); return !!e && getComputedStyle(e).display !== 'none'; }"
   })  → 期望 true
6. 失败时 browser_take_screenshot({ filename: "TC-FR002-001-fail.png" })
```

### 3.2 响应式断点

```
for (const vp of [{w:375,h:667},{w:768,h:1024},{w:1440,h:900}]) {
  browser_resize({ width: vp.w, height: vp.h })
  const result = browser_evaluate({
    function: "() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, sw: document.documentElement.scrollWidth, iw: window.innerWidth })"
  })
  if (result.overflow) browser_take_screenshot({ filename: `TC-RWD-${vp.w}-fail.png` })
}
```

### 3.3 axe-core 无障碍扫描

```
browser_evaluate({
  function: `async () => {
    if (!window.axe) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/axe-core@4/axe.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('axe-core load failed'));
        document.head.appendChild(s);
      });
    }
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa'] } });
    return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })) };
  }`
})
```

axe-core CDN 不可达时降级为基本检查：连续 `browser_press_key Tab` + `browser_snapshot` 追踪焦点，验证 Tab 顺序与无键盘陷阱。

### 3.4 性能基线

```
browser_evaluate({
  function: `() => {
    const [nav] = performance.getEntriesByType('navigation');
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
      load: Math.round(nav.loadEventEnd - nav.startTime),
      fcp: fcp ? Math.round(fcp.startTime) : null,
    };
  }`
})
```

Lighthouse 分数无法在 MCP 内取，列入"需人工补测项"。

### 3.5 XSS 转义验证

```
1. browser_type({ target: inputRef, text: "<img src=x onerror=window.__xss=true>" })
2. browser_click({ target: submitRef })
3. browser_evaluate({ function: "() => window.__xss === true" })  → 期望 false
```

## 4. 降级决策树

```
检查 mcp__plugin_playwright_playwright__browser_navigate 是否注册？
├─ 否 → 整体降级：跳过 1.5/2/3/4 自动化，输出"手动验证清单"
└─ 是 → 执行 serve-preview start
        ├─ 失败 → 步骤 2~4 标"阻塞"，仅静态分析继续，列入"需人工补测项"
        └─ 成功 → 逐 TC 执行
                  ├─ browser_evaluate 异常 → 重试 1 次
                  │   ├─ 仍失败 → 该 TC 标"阻塞"
                  │   └─ 成功 → 继续
                  ├─ axe-core CDN 不可达 → 降级为基本 a11y 检查
                  └─ 元素选择器不匹配 → 该 TC 标"阻塞"，列入"需人工补测项"
```

降级原则：**能自动化的不留给用户**。只有以下情形列入"需人工补测项"：
- 真实屏幕阅读器播报（NVDA/VoiceOver）
- 真实网络下的性能（Lighthouse / WebPageTest）
- 服务端行为（CSRF、服务端校验、数据库副作用）
- 物理设备触控（真实移动端硬件）

## 5. 产物路径约定

```
.dws/{项目名}/test/
├── test-cases.md                    # 模式一产出
├── test-plan.md                     # 模式二步骤一
├── test-summary.md                  # 模式二步骤七
├── bug-report-{ID}.md               # 模式二步骤六
├── screenshots/                     # Playwright 失败截图
│   ├── TC-FR001-001-fail.png
│   └── TC-RWD-375-fail.png
└── .serve/                          # serve-preview.mjs 工作目录
    ├── status.json                  # { ok, pid, port, url, script, logFile, startedAt }
    └── log.txt                      # dev server 输出
```

截图文件名规范：`{TC-ID}-{断点或场景}-fail.png`，便于在 Bug 报告里直接引用相对路径。

## 6. 与 Dashboard 的协作

- 步骤 1.5 完成后**不单独广播活动**——"浏览器自动化环境就绪：$URL" 信息放进步骤二开始时的 `--detail` 字段。早期版本曾通过 `--type activity --action browser-env-ready` 广播，但活动日志会触发 Dashboard 的 auto-advance（在没有 in-progress 步骤时将下一个 pending 步骤提前标为 in-progress），造成进度面板与实际执行不同步。
- 步骤二的 `--detail` 字段记录自动化用例占比，如 `"自动化用例 12/15"`。
- 测试结束（步骤七完成后）调 `serve-preview.mjs stop` 释放端口。
