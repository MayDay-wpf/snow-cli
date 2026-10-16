# 03. 路径 POSIX 化与沙箱约束规范 (POSIX Path Discipline & Sandboxing)

> **位置**：`conventions/03-posix-path-discipline.md`  
> **状态**：Active / Baseline

---

## 一、路径流转硬性要求 (POSIX Invariant)

1. **统一单斜杠 `/`**：
   - 所有在系统内部传递、比较、作为缓存 Key 或用于 UI 呈现的路径，必须严格通过 `toCanonicalPath()` 或 `parseCanonicalPath()` 转换为单斜杠。
   - 严禁在字符串中直接拼接原生反斜杠 `\\`。

2. **不可变值对象封装 (`StructuredPath`)**：
   - 外部入参或底层 OS 获取的路径，应提升为不可变结构化路径对象：
     - `.posix`：用于日志、跨进程通信、配置存储、CLI 显示；
     - `.native`：仅在直接传递给底层 OS Node.js API（如 `fs.readFileSync`、`spawn`）时使用；
     - `.isChildOf(parent)` / `.relativeFrom(parent)`：杜绝裸字符串 `startsWith` 进行目录包含判断，免疫跨盘符和大小写伪越权。

---

## 二、持久化资产访问规范 (Snow Context)

业务代码中**绝对禁止直接调用**：
```ts
// ❌ 严重违规：硬编码绕过沙箱，直接污染宿主目录
const configDir = path.join(os.homedir(), '.snow');
```

**唯一合法访问入口**：
```ts
// ✅ 统一路由：自动感知 SNOW_CONFIG_DIR 沙箱重定向
import {getGlobalSnowDir, getWorkspaceSnowDir, getSnowPath} from '../utils/core/snowContext.js';

const globalDir = getGlobalSnowDir();
const themeConfig = getSnowPath('global', 'theme.json');
```

---

## 三、单例管理器动态 Getter 原则

所有持有存储目录属性的单例管理器（如 `SessionManager`、`TaskManager`、`CommandUsageManager`），其存储路径属性必须声明为动态 Getter，严禁在构造函数中固化：

```ts
// ✅ 动态 Getter：测试期修改 process.env['SNOW_CONFIG_DIR'] 能立即动态重定向
export class SessionManager {
    get sessionsDir(): string {
        return getSnowPath('global', 'sessions').native;
    }
}
```
