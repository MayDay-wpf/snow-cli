---
dynamics: [立,守,改,增]
domain: meta
status: normative
---

# Snow CLI Conventions Index — 约定目录索引与元规范 (Meta)

> **同步与版本契约（CRITICAL SYNC DIRECTIVE）**：
> 1. **双向严格镜像**：本目录（`D:/dogepy/Tools/Snow/snow-cli/docs/conventions/`）与根目录（`D:/dogepy/Tools/Snow/conventions/`）的内容必须保持 **100% 字节级镜像对齐**。
> 2. **历史排序规范**：所有规范文档严格按照**历史创建时间（Git 提交先后）统一进行两位数序号化命名（`01-` ~ `08-`）**。
> 3. **AI 与开发者行为守则**：**每一次在此处新增、修改或重命名任何规范文档时，必须同步更新另一端，严禁只改一边**！
> 4. **核心原则**：**索引即登记表，目录即域集合。约定定义“工作怎么做”的标准与规范边界。**

---

## 1. 规范矩阵全景（Convention Registry）

当前全套规范体系按历史演化排序共包含 **10 大核心规范**（含 1 篇元规范基底与 9 篇领域工程规范）：

| # | 规范文档 (Document) | 首次确立时间 | 领域类别 | 范畴与权责 (Scope) | 状态 |
|---|---|---|---|---|---|
| **00** | [00-meta-conventions.md](./00-meta-conventions.md) | 2026-10-16 12:11 | `meta` | 规范写作模态、四大硬性结构、硬规范与软规范界限、启发/消融/反向消融思维推演范式 | 基础元规范 |
| **01** | [01-tui-testing-conventions.md](./01-tui-testing-conventions.md) | 2026-10-13 | `ui / verify` | React/Ink 终端交互 L0~L5 测试金字塔、纯内存组件渲染（~90%）与无头 PTY 仿真（~10%）的分层治理 | 强制规范 |
| **02** | [02-color-science-conventions.md](./02-color-science-conventions.md) | 2026-10-15 | `design-system` | OKLCH 感知色彩微内核、APCA 对比度硬门禁、12 阶语义阶梯与 ANSI 底色穿透标准 | 强制规范 |
| **03** | [03-test-engineering-conventions.md](./03-test-engineering-conventions.md) | 2026-10-16 00:06 | `test / matrix` | 8 大核心业务领域（Domain）与测试纵轴（Tier）映射模型、启发/消融/反向消融思维推演准则 | 强制规范 |
| **04** | [04-process-lifecycle-and-ipc-conventions.md](./04-process-lifecycle-and-ipc-conventions.md) | 2026-10-16 00:06 | `os / runtime` | 跨端进程生命周期不可变状态机、管道流防死锁排空、崩溃隔离与父死子随孤儿进程收割契约 | 强制规范 |
| **05** | [05-testing-and-architecture.md](./05-testing-and-architecture.md) | 2026-10-16 11:58 | `architecture / test` | 测试分层哲学、100% 幂等沙箱微环境、Lint-as-Test 架构门禁守卫体系 | 强制规范 |
| **06** | [06-logging-and-observability.md](./06-logging-and-observability.md) | 2026-10-16 11:58 | `observability / guard` | 统一结构化日志（ECS/OTel 语义兼容）、TUI 渲染防击穿硬门禁、三层 Sink（TUI/文件/测试）、基于依赖图的日志覆盖审计 | 强制规范 |
| **07** | [07-posix-path-discipline.md](./07-posix-path-discipline.md) | 2026-10-16 11:58 | `filesystem / core` | 全链路 POSIX 统一单斜杠、不可变 `StructuredPath` 值对象、`snowContext` 唯一沙箱持久化源头 | 强制规范 |
| **08** | [08-dependency-graph-guards.md](./08-dependency-graph-guards.md) | 2026-10-16 11:58 | `architecture / graph` | 单向依赖流向分层、Registry 依赖倒置解耦模式、运行时循环依赖恒为 0 门禁 | 强制规范 |
| **09** | [09-engineering-governance-and-static-verification-guards.md](./09-engineering-governance-and-static-verification-guards.md) | 2026-10-16 19:07 | `verify / toolchain` | 五维静态验证流水线 (Biome/Pre-commit/TSC/GuardMesh/Knip)、0-容忍门禁网格、启发/消融/反向消融契约 | 强制规范 |

---

## 2. 约定文档写作守则（How to Write a Convention）

存放在本目录下的领域文档必须满足以下结构规范：

1. **统一文件命名**：采用 `两位数序号-小写短横线.md`，新增规范序号递增，并在本索引表中登记。
2. **Frontmatter 必填头**：
   - `dynamics`: 动力学标签集合（`立`、`守`、`改`、`增`、`废`）；
   - `domain`: 归属领域（如 `verify`、`meta`、`cli`、`design-system` 等）；
   - `status`: 规范模态（`normative` 强制规范 或 `descriptive` 描述指南）。
3. **结构要素**：
   - **定位与哲学**：明确解决的测试或工程痛点；
   - **分层架构与规则**：技术栈、职责分工与时序约束；
   - **红线与禁令（Invariants & Bans）**：明确列出严禁反模式；
   - **验收检查单（Checklist）**：提供可逐项对照的交付标准。
