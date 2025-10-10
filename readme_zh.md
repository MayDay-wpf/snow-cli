# snow-ai

[English](readme.md) | 中文


## 安装

```bash
$ npm install --global snow-ai
```

## 启动
```bash
$ snow
```

## 更新
```bash
$ snow --update
```

## 配置示例  `./User/.snow/config.json`
```json
{
  "snowcfg": {
    "baseUrl": "https://api.openai.com/v1",//Gemini：https://generativelanguage.googleapis.com Anthropic：https://api.anthropic.com
    "apiKey": "your-api-key",
    "requestMethod": "responses",
    "advancedModel": "gpt-5-codex",
    "basicModel": "gpt-5-codex",
    "maxContextTokens": 32000, //模型的最大上下文长度
    "maxTokens": 4096, // 模型的最大生成长度
    "anthropicBeta": false,
    "compactModel": {
      "baseUrl": "https://api.opeai.com/v1",
      "apiKey": "your-api-key",
      "modelName": "gpt-4.1-mini"
    }
  }
}
```

## 卸载
```bash
$ npm uninstall --global snow-ai
```

## 安装 VSCode 扩展

* 下载 [VSIX/snow-cli-0.2.5.vsix](https://github.com/MayDay-wpf/snow-cli/blob/main/VSIX/snow-cli-0.2.5.vsix)

* 打开 VSCode，点击 `扩展` -> `从 VSIX 安装...` -> 选择 `snow-cli-0.2.5.vsix`

## 实时预览
* **欢迎 & 设置**

![alt text](image.png)

* **智能代理**

![alt text](image-1.png)
* 对话进行中：按 ESC 停止 AI 生成

* 挂载时：双击 ESC，查看对话记录器，选择回滚，包括文件检查点

* **命令**

![alt text](image-2.png)
  - /clear —— 创建新会话

  - /resume - 恢复历史会话

  - /mcp - 检查 MCP 服务状态

  - /yolo - 无人值守模式，所有工具自动同意执行

  - /init - 初始化项目并生成 SNOW.md 描述文档

  - /ide - 连接到 VSCode，需要安装插件

  - /compact - 将上下文压缩为一句话
