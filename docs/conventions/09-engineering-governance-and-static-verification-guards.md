---
dynamics: [立,守,改,增]
domain: verify
status: normative
---

# 09. 工程治理与全维静态验证门禁规范 (Engineering Governance & Static Verification Guards)

> **定位**：定义 Snow 全仓（`snow-cli` 及工具矩阵）在**代码静态分析、编译契约防御、类型健全性保障、Rust 极速工具链（Biome/Oxlint 对标 Ruff）与 0-容忍物理门禁网格（Guard Mesh）**的标准工程范式。  
> **参照先例**：`00-meta-conventions.md` 元规范准则、`03-test-engineering-conventions.md` 领域纵横轴矩阵、Google Engineering Practices。  
> **核心哲学**：**静态先于动态，编译阻断于运行；不写口号，只立门禁；消灭死寂，闭环可测。**

---

## 一、架构层级与分工定位 (Layering & Scope)

在 Snow 系统架构拓扑中，本规范位于 **Engineering Governance & Quality Infrastructure Layer（工程治理与质量基础设施层）**：

```
┌────────────────────────────────────────────────────────┐
│  Presentation / CLI Layer (UI / Ink TUI / Commands)   │
├────────────────────────────────────────────────────────┤
│  Domain & Core Layer (MCP / Session / Agents / Config) │
├────────────────────────────────────────────────────────┤
│  Observability Microkernel (Logger / Tracing / Metrics)│
├════════════════════════════════════════════════════════┤
│  Engineering Governance & Static Verification Layer    │ ◄── [09 规范治理范围]
│  • Tier 0: Save-time Auto-Fix & Formatting (Biome)     │
│  • Tier 1: Commit-time Incremental Hook (pre-commit)   │
│  • Tier 2: AOT Type Soundness Oracle (tsc --noEmit)    │
│  • Tier 3: Zero-Tolerance Architecture Guard Mesh      │
│  • Tier 4: Dead-Code & Orphan Radar (Knip)             │
└────────────────────────────────────────────────────────┘
```

---

## 二、五维静态验证纵深防御流水线 (The 5-Tier Verification Pipeline)

为防止“开发测试全绿，打包发布卡死”的割裂现象，全仓建立五级纵深防御体系：

### 1. Tier 0: 保存期极速修整（Save-Time Fix via Biome）
- **工具选型**：`@biomejs/biome`（Rust 多线程微秒级引擎，全仓对标 Python `Ruff`）。
- **职责**：
  - 代码格式化（替换重型 Prettier，消灭格式配置内耗）；
  - 自动移除未使用的无用变量与 orphan 孤立 import（Organize Imports）；
  - 基础 AST 反模式静态扫描。
- **性能基准**：全仓 200+ 文件扫描在 **< 100ms** 内完成，无感集成到 IDE 自动保存。

### 2. Tier 1: 提交期增量安全气囊（Commit-Time Hook via Git pre-commit）
- **部署位置**：`.git/hooks/pre-commit`。
- **执行原则**：**仅增量扫描当前暂存区（`git diff --cached --name-only`）**，绝不进行全量全工程拖慢提交体验。
- **执行时序（严格串行短路）**：
  1. **Phase 1: 轻量 AST/正则契约扫描（< 50ms）**
     - 拦截任何非标准的 logger 命名（只能声明为 `const log`）；
     - 拦截对全局单例 `logger.` 的跨级直调；
     - 拦截无任何线索的静默 `catch {}` 或 `catch (e) {}`；
     - 拦截任何非法 `console.log` / `console.error`；
     - 拦截绕过 `snowContext` 的硬编码 `homedir()/.snow`。
  2. **Phase 2: 暂存区 Biome 增量格式化与 Lint 校验（< 80ms）**
     - 运行 `npx @biomejs/biome check --staged` 确保提交的代码风格与静态规则零违规。

### 3. Tier 2: 类型健全性编译仲裁（Type-Soundness Oracle via `tsc --noEmit`）
- **职责定位**：类型系统的绝对最高法官。
- **工程约束**：
  - 继承 `@sindresorhus/tsconfig` 顶级严格标准；
  - `noUnusedLocals: true`、`noUnusedParameters: true`、`noPropertyAccessFromIndexSignature: true` 均为硬性拦截；
  - **绑定位置**：作为 `scripts/gate-runner.mjs` 的 **Step 0 强制前置检查**。执行 `npm test` 前必须先通过类型编译，杜绝测试框架 JIT `transpileOnly` 掩盖类型破损。

### 4. Tier 3: 六维 0-容忍架构门禁网格（Zero-Tolerance Guard Mesh）
全量门禁以高优先级单元测试形式固化于 `source/test/unit/core/`，并永久绑定至 `gate-runner.mjs fast` 核心套件：

| 门控名称 | 测试文件路径 | 物理拦截目标 | 验收棘轮 (Ratchet) |
| :--- | :--- | :--- | :--- |
| **ZeroSilentCatchGuard** | `zeroSilentCatchGuard.test.ts` | 拦截全仓无诊断日志记录的盲目 `catch {}` | **0** (零容忍) |
| **ZeroLoggerNameGuard** | `zeroLoggerNameGuard.test.ts` | 严禁除 `const log = logger.child(...)` 以外的任何变体命名，含反消融测试 | **0** (零容忍) |
| **ZeroRootLoggerGuard** | `zeroRootLoggerGuard.test.ts` | 严禁业务模块越权直调全局单例 `logger.*`（必须使用 namespace `log`） | **0** (零容忍) |
| **ZeroConsoleLeakGuard** | `zeroConsoleLeakGuard.test.ts` | 严防控制台裸输出击穿 Ink/TUI 终端缓冲区 | **0** (零容忍) |
| **ZeroLeakStorageGuard** | `zeroLeakStorageGuard.test.ts` | 杜绝绕过 `snowContext` 裸拼写 `~/.snow` 导致跨盘符/沙箱污染 | **0** (零容忍) |
| **ArchitectureCycleGuard**| `architectureCycleGuard.test.ts` | 基于 DFS 强连通分量分析，禁止跨模块无序循环依赖新增 | **10** (基准锁死不增殖) |

### 5. Tier 4: 全仓死代码与孤立依赖雷达（Dead-Code & Orphan Radar via Knip）
- **工具选型**：`knip`（TypeScript 现代化死代码消除工业标准）。
- **扫描维度**：
  - 未被引用的孤立 `.ts` 文件与废弃脚本文档；
  - `export` 出去但全仓 0 次消费的僵尸类型、函数与常量；
  - `package.json` 中占坑但未被源码引用的冗余依赖包。

> [!WARNING] **静态 AST 扫描图与动态反射调度的本质局限（Static vs. Dynamic Boundary Notice）**
> 1. **静态工具的视界盲区**：Knip / AST 解析器仅能沿着静态 `import ... from '...'` 进行有向图可达性遍历（Reachability Analysis）。
> 2. **动态调度的伪死代码误报（False Positive Trap）**：
>    - **反射与注册表模式**：系统中的 Subagents（如 `BashOutputSummaryAgent`、`ReviewAgent`）通过 `agentResolver` / `AgentRegistry` 在运行期根据 LLM 决策或意图动态加载实例化，静态图误判为 0 引用；
>    - **CLI 命令动态路由器**：所有 `/goal`、`/diff` 命令遵循 `default: Command` 导出契约，由运行时 Slash 调度器按用户输入派发；
>    - **跨进程通信与存储契约**：大量导出的 `interface / type`（如 `OAuthClaims`、`HookErrorDetails`）是落盘序列化、OTel APM 追踪与外部 IDE 扩展对齐的契约资产，内部源码无强静态调用。
> 3. **治理金科玉律（Engineering Invariant）**：
>    - **严禁机械化一键批量删除！** Tier 4 的扫描报告**绝对不可作为自动化删除的自动执行流水线**，只能作为“架构审视雷达”与重构参考线索；
>    - **动静结合四步确认法**：在清理任何被报告为“Unused”的类/导出前，必须经过：（1）全局字符串正则全仓复核；（2）动态注册表溯源；（3）跨进程/JSON落盘契约确认；（4）单测覆盖反消融断言。

---

## 三、启发式、消融性与反向消融推演 (3D Audit Analysis)

依据 `00-meta-conventions.md` 元规范要求，本治理体系的三维推演如下：

### 1. 启发式探索 (Heuristics)
- **极值边界**：在开发者高强度并发开发或大型多分支合流（Merge Conflict）场景下，代码容易留下失效未引用导入或破坏性 Mock 数据；
- **自愈与先验防护**：工具链必须在“保存时自动清理、提交时增量拦截、测试时全量验型”，形成多道自愈网格，使系统处于**自净化稳态（Self-Purification Equilibrium）**。

### 2. 消融性分析 (Ablation)
- **消融 Tier 0 (无 Biome/自动清理)**：全仓产生大量无用孤立 import，重命名函数导致数十个文件残留无用变量，最终在构建时集中爆炸。
- **消融 Tier 1 (无 pre-commit 增量拦截)**：开发者误将非标 `const myLog = ...` 提交到远程，污染 Commit 历史，CI 阶段才失败导致上下文切换成本剧增。
- **消融 Tier 2 (无 tsc --noEmit 前置)**：AVA 测试因仅转译执行显示“全绿 132 passed”，误导开发者认为一切正常，打包构建 `npm run build` 时才发现 60+ 项编译失败。
- **消融 Tier 3 (无 Guard Mesh 架构门禁)**：代码退化为散落裸调 `logger.info`、`console.log` 与静默 `catch {}`，可观测性全链路断裂。

### 3. 反向消融推演 (Reverse Ablation - 预防过度设计)
- **避免臃肿**：严禁在 `pre-commit` 中直接跑全量 132 个测试套件（耗时 20s 会破坏开发者提交流畅度）；提交期只做 <200ms 的轻量 AST 正则检查，耗时大检查交由 GateRunner 与 CI；
- **最小入侵**：六大 Guard 均以现有 `node:fs` 纯函数正则与轻量图算法实现，零引入外部笨重抽象。

---

## 四、硬红线禁令与违规处理准则 (Hard Invariants)

1. **【禁止类型逃逸】**：业务源码中严禁使用 `any` 或 `as any` 逃避类型检查（单元测试 mock private 方法除外）。
2. **【禁止非标标识符】**：全仓 child logger 必须且只能命名为 `const log`，严禁 `xxxLogger`、`cmdLog`、`otelLog` 等个性化命名。
3. **【禁止吞错无迹】**：任何 `catch (e)` 降级分支必须附带 `log.debug(...)` 或 `log.warn(...)`，必须提供具有排查意义的上下文结构体。
4. **【禁止绕道编译】**：PR 或本地提交前必须保证 `tsc --noEmit` 零警告、零报错。

---

## 五、规范自审与门禁验收清单 (Verification Checklist)

- [ ] 本地执行 `node scripts/gate-runner.mjs fast` 是否包含 `tsc --noEmit` 并且 100% 通过？
- [ ] 六重 0-容忍 Guard 是否均锁定在约定阈值（5 项为 0，循环依赖 $\le 10$）？
- [ ] 暂存区增量提交是否受 `.git/hooks/pre-commit` 严格守门？
- [ ] 内外两处 Conventions 目录是否保持字节级同步镜像？
