<div align="center">

<img src="docs/images/logo.png" alt="Snow AI CLI Logo" width="200"/>

# snow-ai

[![npm version](https://img.shields.io/npm/v/snow-ai.svg)](https://www.npmjs.com/package/snow-ai)
[![npm downloads](https://img.shields.io/npm/dm/snow-ai.svg)](https://www.npmjs.com/package/snow-ai)
[![license](https://img.shields.io/npm/l/snow-ai.svg)](https://github.com/MayDay-wpf/snow-cli/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/snow-ai.svg)](https://nodejs.org/)

[English](README.md) | **中文**

**QQ 群**: 910298558

_在终端中进行 Agentic 编程_

</div>

## 感谢开发者

<a href="https://github.com/MayDay-wpf/snow-cli/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MayDay-wpf/snow-cli" />
</a>

## 感谢赞助商

- [UUCode](https://www.uucode.org)

---

![alt text](docs/images/image_zh.png)

## 文档目录

- [安装指南](docs/usage/zh/01.安装指南.md) - 系统要求、安装(更新、卸载)步骤、IDE 扩展安装
- [首次配置](docs/usage/zh/02.首次配置.md) - API 配置、模型选择、基础设置
- [启动参数说明](docs/usage/zh/19.启动参数说明.md) - 命令行参数详解、快速启动模式、无头模式、异步任务、开发者模式

### 高级配置

- [代理和浏览器设置](docs/usage/zh/03.代理和浏览器设置.md) - 网络代理配置、浏览器使用设置
- [代码库设置](docs/usage/zh/04.代码库设置.md) - 代码库集成、搜索配置
- [子代理设置](docs/usage/zh/05.子代理设置.md) - 子代理管理、自定义子代理配置
- [敏感命令配置](docs/usage/zh/06.敏感命令配置.md) - 敏感命令保护、自定义命令规则
- [Hooks 配置](docs/usage/zh/07.Hooks配置.md) - 工作流程自动化、Hook 类型说明、实用配置示例
- [主题设置](docs/usage/zh/08.主题设置.md) - 界面主题配置、自定义配色、简洁模式
- [第三方中转配置](docs/usage/zh/16.第三方中转配置.md) - Claude Code 中转、Codex 中转、自定义请求头配置

### 功能指南

- [指令面板说明](docs/usage/zh/09.指令面板说明.md) - 所有可用指令的详细说明、使用技巧、快捷键参考
- [命令注入模式](docs/usage/zh/10.命令注入模式.md) - 消息中直接执行命令、语法说明、安全机制、使用场景
- [漏洞猎人模式](docs/usage/zh/11.漏洞猎人模式.md) - 专业安全分析、漏洞检测、验证脚本、详细报告
- [无头模式](docs/usage/zh/12.无头模式.md) - 命令行快速对话、会话管理、脚本集成、第三方工具集成
- [快捷键指南](docs/usage/zh/13.快捷键指南.md) - 所有快捷键说明、编辑操作、导航控制、回滚功能
- [MCP 配置](docs/usage/zh/14.MCP配置.md) - MCP 服务管理、配置外部服务、启用/禁用服务、故障排除
- [异步任务管理](docs/usage/zh/15.异步任务管理.md) - 后台任务创建、任务管理界面、敏感命令审批、任务转会话
- [Skills 指令详细说明](docs/usage/zh/18.Skills指令详细说明.md) - 技能创建、使用方法、Claude Code Skills 兼容性、工具限制
- [LSP 配置与用法](docs/usage/zh/19.LSP配置.md) - LSP 配置文件、语言服务器安装、ACE 工具用法(跳转/大纲)
- [SSE 服务模式](docs/usage/zh/20.SSE服务模式.md) - SSE 服务器启动、API 端点说明、工具确认流程、权限配置、YOLO 模式、客户端集成示例

---

## 开发指南

### 环境要求

- **Node.js >= 16.x** (需要 ES2020 特性支持)
- npm >= 8.3.0

检查你的 Node.js 版本：

```bash
node --version
```

如果版本低于 16.x，请先升级：

```bash
# 使用 nvm (推荐)
nvm install 16
nvm use 16

# 或从官网下载
# https://nodejs.org/
```

### 源码构建

```bash
git clone https://github.com/MayDay-wpf/snow-cli.git
cd snow-cli
npm install
npm run link   # 构建并全局链接 snow
# 之后删除链接: npm run unlink
```

### IDE 扩展开发

#### VSCode 扩展

- 扩展源码位于 `VSIX/` 目录
- 下载发布版: [mufasa.snow-cli](https://marketplace.visualstudio.com/items?itemName=mufasa.snow-cli)

#### JetBrains 插件

- 插件源码位于 `Jetbrains/` 目录
- 下载发布版: [JetBrains 插件](https://plugins.jetbrains.com/plugin/28715-snow-cli/edit)

### 项目结构

```
.snow/                      # 用户配置目录
├── log/                    # 运行日志(本地，可删除)
├── profiles/               # 配置文件
├── sessions/               # 对话记录
├── snapshots/              # 文件快照
├── todos/                  # TODO 列表
├── tasks/                  # 异步任务
├── task-logs/              # 异步任务日志
├── history/                # 命令历史
├── commands/               # 自定义命令
├── hooks/                  # 工作流钩子
├── sse-daemons/            # SSE 守护进程
├── sse-logs/               # SSE 服务日志
├── usage/                  # 使用统计
├── active-profile.json     # 当前活动配置
├── config.json             # API 配置
├── custom-headers.json     # 自定义请求头
├── mcp-config.json         # MCP 配置
├── lsp-config.json         # LSP 配置
├── proxy-config.json       # 代理设置
├── codebase.json           # 代码库索引设置
├── sub-agents.json         # 子代理配置
├── sensitive-commands.json # 敏感命令规则
├── theme.json              # 主题设置
├── language.json           # 语言设置
├── history.json            # 历史设置
└── system-prompt.json      # 自定义系统提示词
```

---

## QQ交流群

![alt text](docs/images/qq_group_qr.jpg)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=MayDay-wpf/snow-cli&type=Date)](https://star-history.com/#MayDay-wpf/snow-cli&Date)
