# MCP 工具使用方法

## Chrome DevTools MCP 使用指南

### 打开 DeepSeek + Side Panel

1. **关闭现有 Chrome**（如果需要重新开始）
   ```bash
   taskkill /F /IM chrome.exe
   ```

2. **用 chrome-devtools-mcp 打开 DeepSeek**
   - 使用 `cwCaAk0mcp0navigate_page` 工具导航到 `https://chat.deepseek.com/`

3. **触发 Side Panel 打开**
   - 在页面上点击任意位置（空白处、按钮、输入框等）
   - auto-open-sidepanel.js 会检测到 click 事件并自动打开 Side Panel
   - 使用 `cwCaAk0mcp0click` 工具点击页面元素

### 常用 MCP 工具

- `cwCaAk0mcp0navigate_page`: 导航到 URL
- `cwCaAk0mcp0take_snapshot`: 获取页面快照
- `cwCaAk0mcp0click`: 点击元素（需要元素的 uid）
- `cwCaAk0mcp0fill`: 填写表单
- `cwCaAk0mcp0type_text`: 输入文本
- `cwCaAk0mcp0list_pages`: 列出所有打开的页面
- `cwCaAk0mcp0select_page`: 选择页面

### 注意事项

1. **MCP 连接**：如果 MCP 工具报错 "No connection found"，需要用 chrome-devtools-mcp 重新打开 Chrome
2. **Side Panel 触发**：Chrome Side Panel API 要求必须由用户交互触发，不能自动打开
3. **元素定位**：使用 `take_snapshot` 获取页面元素及其 uid，然后用 uid 进行操作