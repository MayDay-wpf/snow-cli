---
dynamics: [立,守,改,增]
domain: verify
status: normative
---

# TUI Testing Conventions — Snow CLI 终端交互界面测试层级规范

> 定位：定义 Snow CLI 交互式终端应用（基于 React/Ink 渲染器与流式状态机）的**测试分层金字塔与质量验收规范**。
> 参照先例：`testing-scenario-tui` 终端交互规范、`skills-collection` SZ 测试架构与 `IV8` 仓 `testing-conventions.md`。
> 核心哲学：交互式 TUI 既不是传统 CLI，也不是 Web 前端。它的本质是**受限物理视口（字符网格）上的有状态流式状态机**。测试核心在于**组件纯内存渲染（~90%）与无头 PTY 终端模拟（~10%）的分层治理**。

---

## 1. 测试层级金字塔（The Multi-Tier Testing Hierarchy）

依据测试成本、执行速度与时序稳定性比率律，Snow CLI 的终端测试严格分层：

| 层级 | 测试技术代表 | 推荐精力占比 | 核心验证目标 | 成本与特征 |
|---|---|---|---|---|
| **L0: 契约与纯逻辑层** | 纯函数、Schema 校验、Error 类单元测试 | - | MCP 工具参数契约、错误字段传递、AbortSignal 级联赛跑取消逻辑 | 微秒级反馈（<10ms），零环境依赖 |
| **L1: 内存组件测试** | `ink-testing-library` + 本地 ESM Loader 模块映射 | **~90%** | Props 驱动渲染、状态转移、多选/单选复选框显示、输入框输入及键盘导航（Enter、Space、Tab、数字键、ESC、e 键） | 毫秒级反馈（<200ms），纯内存运行，无 OS 进程开销，Flaky 免疫 |
| **L2: 无头 PTY 仿真** | `node-pty` / ConPTY + xterm-headless | **~10%** | 构建后二进制在真实伪终端环境下的 Raw Mode、TTY 尺寸适配与信号传播（SIGINT/Ctrl+C） | 秒级开销（1-5s），拉起真实 OS 进程，验证最终打包交付物 |

---

## 2. 核心规程与设计范式

### 2.1 L1 内存测试运行时基础设施（ESM Loader Hook）
由于项目在生产环境中深度魔改了 `ink` 并内联于 `source/vendor/ink`，导致外部测试工具 `ink-testing-library` 在 Node 原生 ESM 解析下无法在 `node_modules` 找到 `ink`。
- **正典规范**：通过 `scripts/test-loader.mjs` 注册自定义 ESM 解析钩子，将所有对 `ink` 的 `import` 拦截重定向至 `./source/vendor/ink/src/index.ts`；
- **配置固化**：在 `package.json` 的 `ava` 配置中注册 `--loader=./scripts/test-loader.mjs`，并开启 `TS_NODE_TRANSPILE_ONLY=true`，实现源码级热测，无需侵入打包产物。

### 2.2 确定性虚拟时序取代硬编码 Sleep（Deterministic Virtual Timers）
- **[禁止] 严禁反模式**：在虚拟 stdin 写入后使用长达数秒的无上限 sleep 或轮询等待。
- **正典规范**：利用受控微阶梯延时（如 30-50ms）等待 Ink 完成 `reconciler.batchedUpdates`，随后即刻通过 `lastFrame()` 抓取渲染帧或断言答案回调，杜绝测试时序偶发挂死。

### 2.3 键盘心智保真与状态自闭环（Keyboard Invariants & Auto-Selection）
- **单选模式（Single-Selection）**：无复选框 `[✓]/[ ]`，按 `Enter` 或数字键立即以单值字符串完成提交并退出（0 额外按键）；
- **多选模式（Multi-Selection）**：显示复选框 `[✓]/[ ]`，按 `Space` 或数字键切换勾选状态，按 `Enter` 提交已选数组；若未按空格勾选，按 `Enter` 默认自动将当前高亮项作为唯一选择提交；
- **输入框换行清洗（Newline Sanitization）**：内嵌 `TextInput` 在接收到大段外部粘贴时，必须统一将 `\r\n` / `\n` 清洗规整为单行空格，防止意外截断或提前触发提交；输入完成后单选直接提交，多选自动追加并勾选进集合。

---

## 3. 红线禁令（TUI Invariants & Bans）

1. **[禁止] 为每个纯逻辑/正则算法拉起真实 PTY** — 契约与算法必须在 L0 或纯函数中完成。
2. **[禁止] 在无真实 TTY 的管道中假定 Raw Mode 生效** — 交互式按键必须在 `ink-testing-library` 虚拟 stdin 或真实 PTY 挂载下驱动。
3. **[禁止] 裸正则清洗 ANSI 序列** — L2 终端测试严禁直接用正则剥离色彩转义字符断言排版，必须使用虚拟终端模拟器（如 `xterm-headless`）重构二维字符网格。
4. **[禁止] 依赖鼠标事件驱动** — 终端应用以键盘按键（Enter/Space/Tab/Arrows/Esc/数字键）为唯一真理源。

---

## 4. 终端组件测试验收检查单（TUI Test Acceptance Checklist）

所有新增或重构的终端交互组件，必须通过以下测试验收标准：

- [ ] **L0 契约就绪**：MCP 参数 Schema 与错误传递有独立的单元测试覆盖；
- [ ] **L1 默认渲染断言**：断言标题、提示行、选项前缀（单选数字序号 vs 多选复选框）；
- [ ] **L1 按键序列驱动**：方向键导航、空格切换勾选、回车提交均有虚拟按键时序测试；
- [ ] **L1 特殊操作断言**：数字键快速跳转、`e` 键载入编辑、`ESC` 取消、Tab 焦点流转全部测试覆盖；
- [ ] **L1 外部粘贴与边界防御**：验证多行文本粘贴清洗规整与完成输入后的自动选中行为；
- [ ] **L1 确定性与无泄露**：测试套件在 2 秒内稳定完成，无悬挂定时器或未捕获的异步 Promise。
