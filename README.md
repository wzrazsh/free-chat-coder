# free-chat-coder

## 环境依赖
本仓库需要运行一个独立的 Web IDE (基于 code-server)。为缩减仓库代码量，我们不再内置 code-server 代码，请使用以下两种方式之一来安装和运行。

### 方式 1: 全局安装
```bash
npm install -g @coder/code-server
code-server --port 8081
```

### 方式 2: 使用 npx 运行
```bash
npx @coder/code-server --port 8081
```

> **注意**: 在 `shared/config.js` 中默认配置了 Web IDE 的端口为 `8081`。如果启动端口不同，请通过环境变量 `WEB_IDE_PORT` 覆盖或直接修改配置文件。