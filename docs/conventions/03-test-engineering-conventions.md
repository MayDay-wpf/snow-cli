# Snow CLI 测试工程体系规范 (Test Engineering Conventions)

本文档定义 Snow CLI 的多层测试调度体系、8 大核心业务领域（Domain）矩阵映射规范，以及启发式、消融式与反向消融推演准则。

---

## 一、 核心架构原则：二维矩阵模型 (Tier × Domain)

为了彻底根除测试文件平铺散乱（“平躺式”）所带来的维护成本爆炸，Snow CLI 的测试资产采用**「测试范式（纵轴 Tier） × 业务领域（横轴 Domain）」**的标准二维矩阵结构：

```
source/test/
├── unit/                              [L0 单元层：纯逻辑白盒，零 IO，纳秒级]
│   ├── core/
│   ├── mcp/
│   ├── theme/
│   ├── session/
│   ├── conversation/
│   ├── codebase/
│   ├── api/
│   └── agents/
│
├── integration/                       [L1-L4 中枢编排层：时序、锁、状态机、JIT 容器]
│   ├── core/
│   ├── mcp/
│   ├── theme/
│   ├── session/
│   ├── conversation/
│   └── codebase/
│
└── e2e/                               [端到端黑盒层：独立抽离，宿主交互与用户旅程]
    ├── tui/                              - Ink 真实全帧挂载、多选防误触、24×80 终端视口不变量
    └── scenarios/                        - 全流程业务闭环、Headless 离屏 Worker 模式
```

---

## 二、 8 大核心领域（Domain）映射契约

| 领域标识 | 源码对应资产 | 领域核心职责 | 典型测试资产 |
| :--- | :--- | :--- | :--- |
| **`core`** | `source/utils/core/`, `platform/`, `config/` | 基础配置、进程树管理、异步日志、高精耗时统计、退出控制序列注销 | `logger-async`, `performance-hub`, `terminal-exit-cleanups` |
| **`mcp`** | `source/mcp/`, `source/utils/execution/mcp/` | 静态 Catalog 存储、两轨调度、JIT 连接池、内置服务分发器、WebSearch | `mcp-catalog-scheduler`, `mcp-jit-lifecycle`, `websearch-dual-track-fetch` |
| **`theme`** | `source/ui/themes/`, `source/utils/color-science/` | OKLCH 感知色彩微内核、APCA 对比度硬门禁、12 阶阶梯推导、Diff 高亮增益 | `color-science-engine`, `color-science-cdc-contract`, `custom-theme-viewport-invariants` |
| **`session`** | `source/utils/session/`, `source/hooks/session/` | 会话持久化、提示词就近回溯保护、会话压缩摘要、恢复工具 pending 幂等 | `session-command-plane`, `session-resume-and-compact-resilience` |
| **`conversation`**| `source/hooks/conversation/`, `source/prompt/` | 思考内容代码围栏保护、流式切片解析、输入草稿粘贴标记、命令拦截 | `thinkingExtractor`, `restoreTextWithMarkers`, `hookAdditionalContext` |
| **`codebase`** | `source/utils/codebase/`, `source/mcp/aceCodeSearch.ts` | ACE 索引引擎、三端家目录与系统根卫兵、grep 深度限制、Todo 扫描 | `engine-self-healing-resilience`, `todo-scanner` |
| **`api`** | `source/api/` | LLM 适配器、流式传输、Token 负载计量、敏感命令决策模型 | `max-tokens-payload` |
| **`agents`** | `source/agents/`, `source/skills/` | 自定义 Agent 容器、SubAgent 调度、Claude Code Skills 兼容层 | `projectAgents`, `team-worktree-path`, `snow-docs` |

---

## 三、 三维思维实验准则

### 1. 启发式探索 (Heuristics)
- **时序与锁 invariant**：任何涉及外部进程（stdio/http）的调用必须具备单飞锁（In-flight lock）防抖、严格超时熔断（5s/20s）与 `AbortSignal` 级联；
- **终端无污染 invariant**：任何终端序列（DEC 焦点跟踪 `?1004`、粘贴包裹 `?2004`、光标可见度 `?25h`）必须在退出前 100% 注销；
- **数据单向流 invariant**：会话反序列化严格以 `tool_call.id` 后续是否存在 result 决定是否展示 pending，杜绝幽灵卡片。

### 2. 消融性分析 (Ablation)
- **消融模块划分**：若保持单层平铺，测试资产达到 40+ 后维护成本呈 $O(N^2)$ 爆炸，开发者丧失领域覆盖率全貌感知；
- **消融端到端层**：纯单元测试无法拦截 Ink 视口高度溢出（行抖动）、键盘输入流吞字与终端焦点序列泄漏，E2E 层的 `tui/` 必须作为独立防线；
- **消融单元层**：若全部依赖集成测试，微小的矩阵算法或正则回溯缺陷将导致长链路耗时剧增且错误定位模糊。

### 3. 反向消融推演 (Reverse Ablation)
- **L0 Unit**：最小不可再分纯函数（数学变换、路径归一化、Schema 校验）。要求：运行时间 `< 1ms`，零网络、零磁盘、零子进程；
- **L1 Integration**：协作状态机与调度器（JIT 连接池、两轨缓存切换、锁竞争）。要求：沙箱化 Mock 外部依赖，运行时间 `< 500ms`；
- **L2 E2E**：真实终端视口与全链路旅程。要求：受控且最小化用例数，专注于全链路契约与终端工效不变量。

---

## 四、 自动化调度契约 (package.json 规范)

```json
{
  "scripts": {
    "test": "ava",
    "test:unit": "ava source/test/unit/**/*.test.ts",
    "test:integration": "ava source/test/integration/**/*.test.ts",
    "test:e2e": "ava source/test/e2e/**/*.test.{ts,tsx}",
    "test:mcp": "ava source/test/{unit,integration}/mcp/*.test.ts",
    "test:theme": "ava source/test/{unit,integration}/theme/*.test.ts",
    "test:session": "ava source/test/{unit,integration}/session/*.test.ts"
  },
  "ava": {
    "files": [
      "source/test/**/*.test.ts",
      "source/test/**/*.test.tsx"
    ],
    "timeout": "30s"
  }
}
```
