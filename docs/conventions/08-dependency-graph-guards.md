# 04. 依赖拓扑图与零循环门禁规范 (Dependency Graph & Zero-Cycle Guard)

> **位置**：`conventions/04-dependency-graph-guards.md`  
> **状态**：Active / Baseline

---

## 一、架构分层与依赖流向 (Dependency Flow)

系统整体严格遵循单向依赖流：

```text
[UI / Presentation Layer]
          │
          ▼
[Commands / MCP Tools Layer]
          │
          ▼
[Execution & Task Engines]
          │
          ▼
[Agents Layer]
          │
          ▼
[Config & Context Layer]
          │
          ▼
[Core Microkernels & Utilities] (StructuredPath, Logger, StreamGuards)
```

**铁律**：下层底座（如 `utils/config`）绝对禁止静态导入上层业务实现（如 `agents/*` 或 `utils/execution/*`）。

---

## 二、观察者/注册表解耦模式 (Registry Inversion)

当底座需要在特定事件发生时通知上层（例如 Profile 切换清空所有 Agent 缓存）时，**必须使用 Registry 模式彻底切断静态引用**：

```ts
// 1. 底层暴露纯注册表 (cacheRegistry.ts)
const clearers = new Set<() => void>();
export function registerCacheClearer(fn: () => void) { clearers.add(fn); }
export function clearAllRegisteredCaches() { clearers.forEach(fn => fn()); }

// 2. 上层 Agent 在初始化时自注册
registerCacheClearer(() => codebaseReviewAgent.clearCache());

// 3. 底层配置切换时仅调用无外部依赖的 clearAllRegisteredCaches()
```

---

## 三、拓扑门禁与环路自动化检测 (Graph Cycle Detection)

全库通过 DFS / 强连通分量算法持续进行无环（DAG）守护：
- 静态门禁测试：[`source/test/unit/core/architectureGraphGuard.test.ts`](file:///d:/dogepy/Tools/Snow/snow-cli/source/test/unit/core/architectureGraphGuard.test.ts)
- 运行期检测脚本：`node scripts/graph-cycle-detect.mjs`

所有 PR 和合并必须确保：
$$\text{Circular Dependency Cycles} = 0$$
