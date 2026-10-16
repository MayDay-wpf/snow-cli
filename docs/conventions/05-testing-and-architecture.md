# 01. 测试与架构规范 (Testing & Architecture Conventions)

> **位置**：`conventions/01-testing-and-architecture.md`  
> **状态**：Active / Baseline

---

## 一、测试分层哲学 (Testing Hierarchy)

测试按照运行成本、覆盖广度与依赖深度严格划分为三层：

```text
source/test/
├── unit/             # 单模块单元测试（运行时间 < 200ms，纯内存/纯函数/最小隔离）
│   ├── core/         # 基础微内核（路径、字符串、守卫）
│   ├── config/       # 配置解析、环境变量解析
│   ├── api/          # 契约转换、预算裁剪
│   └── codebase/     # 规则解析、快照比对
├── integration/      # 跨模块集成测试（运行时间 < 2s，沙箱临时磁盘 I/O）
│   ├── core/         # 流式超时守护、重试机制、统一设置读写
│   └── config/       # 历史配置迁移、Profile 切换
└── <feature>.test.ts # 全链路端到端特性测试（带真实并发、子进程调度或复杂状态机）
```

---

## 二、沙箱微环境铁律 (100% Sandbox Isolation)

任何涉及持久化读写、环境变量覆写或配置文件生成的测试，**必须在隔离沙箱中运行**：

```ts
import test from 'ava';
import {runInSandbox} from '../helpers/sandbox.js';
import {withEnvOverrides} from '../../utils/config/envConfig.js';

test('Feature: isolated execution with zero host leak', async t => {
    await runInSandbox(async ctx => {
        // ctx.sandboxDir 为隔离的临时测试目录
        await withEnvOverrides({
            SNOW_CONFIG_DIR: ctx.sandboxDir.posix,
        }, async () => {
            // 执行业务逻辑...
            t.true(true);
        });
    });
});
```

### 必须遵守的准则：
1. **零宿主穿透**：测试执行过程中，严禁向用户的真实宿主目录 `~/.snow` 写入任何字节；
2. **零副作用残留**：测试完成后，环境变量必须 100% 恢复，临时目录必须自动被回收；
3. **零标准流污染**：测试套件禁止输出无意义的调试 `console.log`，凡涉及日志拦截必须使用 `MemoryLogSink`。

---

## 三、架构门禁测试 (Guard Rail Testing / Lint-as-Test)

不仅依赖 linter 或代码审查，将核心架构约束直接作为 Ava 测试用例持续运行：

- **`source/test/unit/core/zeroLeakStorageGuard.test.ts`**：
  全量 AST 扫描 `source/` 目录，一旦检测到任何未经豁免的直接调用 `homedir(), '.snow'`，测试立刻失败，阻止代码合并。
- **`source/test/unit/core/architectureGraphGuard.test.ts`**：
  全量遍历源码依赖图，一旦检测到任何循环依赖（Directed Cycle），测试立刻失败，杜绝运行时 TDZ 和循环死锁隐患。
