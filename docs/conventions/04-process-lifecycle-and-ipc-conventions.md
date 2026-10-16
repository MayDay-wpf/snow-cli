# Snow CLI 跨端系统进程管理与 IPC 工程规范 (Process Lifecycle & IPC Conventions)

本文档确立 Snow CLI 在多端（Windows / POSIX: Linux & macOS）环境下，关于操作系统进程管理、生命周期状态机、信号机制、父子/孤儿进程收割、IPC 管道流以及容错看门狗的核心哲学原则与工程实施契约。

---

## 一、 核心设计哲学 (Core Philosophies)

### 1. 进程演化哲学：不可变状态机 (Process Lifecycle State Machine)
- **平台无关性**：抹平 Win32 与 POSIX 的生命周期差异，进程状态单向不可逆流动：
  $$\text{IDLE} \xrightarrow{\text{spawn}} \text{STARTING} \xrightarrow{\text{handshake}} \text{ACTIVE} \xrightarrow{\text{busy}} \text{EXECUTING} \xrightarrow{\text{idle}} \text{DRAINING} \xrightarrow{\text{kill}} \text{TERMINATING} \xrightarrow{\text{waitpid/IOCP}} \text{REAPED}$$
- **状态硬门禁**：一旦进程进入 `DRAINING` 或 `TERMINATING` 状态，严禁向其管道写入新请求，所有新请求必须快速失败或转入重试调度。

### 2. IPC 抽象哲学：一切皆是流 (Everything is a Stream)
- **统一流门面**：不管是 Windows 异步命名管道（IOCP）还是 Unix Domain Socket / FIFO，均统一抽象为 `Duplex Stream`；
- **防死锁排空准则 (Pipe Stall Immunity)**：
  - OS 匿名管道缓冲区具有硬上限（Linux/macOS 默认 64KB，Windows 视内核分配）；
  - 严禁对未配置流监听器的子进程管道无节制写入。对于探活（Probe）等瞬态操作，必须显式声明 `stderr: 'ignore'` 或重定向至系统黑洞（Windows `NUL`，POSIX `/dev/null`）；
  - 对于业务长连通道，必须消费双通道，并在超大吞吐量输出时施加背压水位线（High/Low Watermark）控制。

### 3. 容错哲学：崩溃隔离与父死子随 (Supervisor & Orphan Reaping)
- **Let it Crash**：外部工具与第三方 MCP 进程天然不可信，主进程只做崩溃监控与退出码捕获，严禁在主线程内吞没子进程段错误或 OOM；
- **双轨生命周期收割契约**：
  - **瞬态探活 (Ephemeral Probe)**：仅为了获取协议定义与能力列表。一旦探测完毕（无论成功、失败或超时），必须在 `finally` 阶段调用 `processManager.killProcess` / `killPidTree` 彻底斩断整个子孙进程树；
  - **常驻长连 (Persistent Client)**：进程实时向 `processManager.register` 注册，在 10 分钟 idle 超时、配置重载或主进程收到退出信号时才进行整树终结；
- **跨平台整树强杀契约**：
  - Windows：使用 `taskkill /PID ${pid} /T /F`（终极演进为 Rust Native Job Object `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）；
  - POSIX：使用进程组信号 `kill(-pid, SIGKILL)` 配合 `prctl(PR_SET_PDEATHSIG)` 级联清理。

### 4. 确定性配置与缓存契约 (Deterministic Hash & Cache Metrics)
- **消除遍历无序性**：配置对象、工具列表与扫描结果在生成快照前必须经过 `canonicalSortObject` 深度字典排序，杜绝不同平台或不同执行时期的哈希漂移；
- **度量可观测性**：每次 Catalog 加载必须采集 `MCPCacheStats`，记录命中率及未命中分类（`MISS_NOT_FOUND`, `MISS_HASH_CHANGED`, `MISS_CORRUPTED`）。

---

## 二、 平台阻抗匹配对照表 (Platform Impedance Mappings)

| 进程管理维度 | Windows (Win32) | POSIX / Unix-Like | Snow CLI 抽象层实现 |
| :--- | :--- | :--- | :--- |
| **进程派生** | `CreateProcessW` | `fork` + `execve` | `child_process.spawn` + 参数数组与环境净化 |
| **异步通知** | IOCP / `WaitForSingleObject` | `epoll` / `signalfd` / `waitpid` | libuv 事件驱动 (`exit`, `error`, `data`) |
| **整树销毁** | `taskkill /PID <pid> /T /F` | `kill(-pid, SIGKILL)` | `processManager.killPidTree(pid)` |
| **父死子随** | Win32 `Job Object` (0x2000) | `prctl(PR_SET_PDEATHSIG)` | `processManager.killAll` 退出钩子 + Native Job |
| **标准流黑洞** | `NUL` / `ignore` | `/dev/null` / `ignore` | `stdio: ['ignore', 'pipe', 'ignore']` |

---

## 三、 测试工程铁律 (Testing Engineering Invariants)

1. **真实三代孤儿验证 (Real 3-Generation Test)**：
   测试进程管理时，必须真实派生 `Parent -> Child -> Grandchild`，在调用清理方法后利用底层探测器 `process.kill(pid, 0)` 验证孙子进程物理死亡，严禁纯虚拟 Mock。
2. **防管道死锁测试 (Pipe Stall Buffer Test)**：
   必须测试子进程向 `stderr`/`stdout` 突发写入超过 64KB（如 256KB~1MB）数据时，系统是否能正常处理或忽略，绝不可挂死。
3. **沙箱隔离与拓扑回环 (Deterministic Sandbox & Zero Host Leakage)**：
   测试必须使用 `os.tmpdir()` + `randomUUID()` 隔离目录，并在 `test.after.always` 中 100% 回收沙箱文件与跟踪进程，严禁污染宿主配置环境。
