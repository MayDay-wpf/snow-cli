---
dynamics: [立,守,改,增]
domain: meta
status: normative
---

# Snow CLI Conventions Index — 约定目录索引与元规范 (Meta)

> 定位：本目录是全部 Snow CLI 工程约定文档的单一权威登记表与索引中心。
> 参照先例：`IV8` 仓 `docs/conventions/README.md` 与 `skills-collection` 仓 `docs/CONVENTIONS.md`。
> 核心原则：**索引即登记表，目录即域集合。约定定义“工作怎么做”的标准与规范边界。**

---

## 1. 约定文档索引（Convention Registry）

| # | 约定文档 (Document) | 存储路径 (Location) | 范畴与权责 (Scope) | 状态 |
|---|---|---|---|---|
| 1 | **TUI Testing Conventions** | `docs/conventions/tui-testing-conventions.md` | Snow CLI 终端界面测试层级规范：L0 契约层、L1 内存组件渲染层（`ink-testing-library` + 虚拟输入输出）与 L2 PTY 无头终端仿真层，规定测试金字塔与反模式禁令。 | 生效中 |

新约定文档成立即在此表登记，未在索引中登记的约定文档视为孤儿文档。

---

## 2. 约定文档写作守则（How to Write a Convention）

存放在 `docs/conventions/` 下的领域文档必须满足以下结构规范：

1. **Frontmatter 必填头**：
   - `dynamics`: 动力学标签集合（`立`、`守`、`改`、`增`、`废`）；
   - `domain`: 归属领域（如 `verify`、`meta`、`cli` 等）；
   - `status`: 规范模态（`normative` 强制规范 或 `descriptive` 描述指南）。
2. **结构要素**：
   - **定位与哲学**：明确解决的测试或工程痛点；
   - **分层架构与规则**：技术栈、职责分工与时序约束；
   - **红线与禁令（Invariants & Bans）**：明确列出严禁反模式；
   - **验收检查单（Checklist）**：提供可逐项对照的交付标准。
