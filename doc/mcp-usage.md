# MCP 工具使用方法

## Chrome DevTools MCP 使用指南

### 打开 DeepSeek + Side Panel

1. **关闭现有 Chrome**（如果需要重新开始）
   ```bash
   taskkill /F /IM chrome.exe
   ```

2. **用 chrome-devtools-mcp 打开 DeepSeek**
   - 使用 `navigate_page` 工具导航到 `https://chat.deepseek.com/`

3. **触发 Side Panel 打开**
   - 在页面上点击任意位置（空白处、按钮、输入框等）
   - auto-open-sidepanel.js 会检测到 click 事件并自动打开 Side Panel
   - 使用 `click` 工具点击页面元素

### 常用 MCP 工具

- `navigate_page`: 导航到 URL
- `take_snapshot`: 获取页面快照（可查看当前模式状态）
- `click`: 点击元素（需要元素的 uid）
- `fill`: 填写表单
- `type_text`: 输入文本
- `list_pages`: 列出所有打开的页面
- `select_page`: 选择页面
- `evaluate_script`: 在页面上执行 JavaScript 代码
- `wait_for`: 等待指定文本出现
- `list_console_messages`: 查看控制台消息
- `take_screenshot`: 截图

### 快速/专家模式切换测试

#### 测试流程

1. **确认 DeepSeek 当前模式**
   - 使用 `take_snapshot` 查看页面
   - 查找 `radio "快速模式" checked` 或 `radio "专家模式" checked`

2. **切换 SOLO Coder 模式**
   - 使用 `list_pages` 找到 side panel 页面 ID
   - 使用 `select_page` 切换到 side panel
   - 点击"快速"或"专家"按钮

3. **验证 DeepSeek 是否同步**
   - 切回 DeepSeek 页面
   - 使用 `take_snapshot` 确认模式已切换

#### 模式同步问题排查

**问题**：点击 SOLO Coder 中的快速/专家按钮后，DeepSeek 页面没有同步切换

**原因**：content script (mode-controller.js) 没有被正确加载到页面

**解决方案**：在 background.js 的 `sendActionToTab` 函数中直接使用 `executeScript` 注入代码：

```javascript
async function sendActionToTab(tabId, action, params = {}) {
  if (action === 'setModeProfile') {
    const profile = params.profile || 'expert';
    const modeSwitchCode = `
      (function() {
        const targetLabel = '${profile === 'quick' ? '快速模式' : '专家模式'}';
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT, null, false);
        let targetButton = null;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.textContent && node.textContent.includes(targetLabel)) {
            targetButton = node.parentElement;
            break;
          }
        }
        if (targetButton) {
          targetButton.click();
          return { success: true };
        }
        return { success: false, error: 'Button not found' };
      })();
    `;
    try {
      const results = await chrome.tabs.executeScript(tabId, { code: modeSwitchCode });
      return results[0];
    } catch (e) {
      console.error('[ModeSwitch] Error:', e);
      return { success: false, error: e.message };
    }
  }
  // ... 其他 action 处理
}
```

### 高级操作

#### 使用 evaluate_script 执行复杂操作

当需要执行 DOM 操作时，可以使用 `evaluate_script`：

```javascript
// 测试 ModeController 是否存在
mcp_chrome-devtools_evaluate_script:
  function: () => {
    if (!window.ModeController) {
      return { error: 'ModeController not found' };
    }
    return window.ModeController.readModeProfile();
  }

// 手动切换到专家模式
mcp_chrome-devtools_evaluate_script:
  function: () => {
    const targetLabel = '专家模式';
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT, null, false);
    let targetButton = null;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent && node.textContent.includes(targetLabel)) {
        targetButton = node.parentElement;
        break;
      }
    }
    if (targetButton) {
      targetButton.click();
      return { success: true };
    }
    return { success: false, error: 'Button not found' };
  }
```

#### 使用 TreeWalker 查找元素

DeepSeek 的模式切换按钮使用自定义 radio 元素，需要用 TreeWalker 查找：

```javascript
const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT, null, false);
while (walker.nextNode()) {
  const node = walker.currentNode;
  if (node.textContent.includes('专家模式') || node.textContent.includes('快速模式')) {
    const button = node.parentElement;
    button.click();
  }
}
```

### 注意事项

1. **MCP 连接**：如果 MCP 工具报错 "No connection found"，需要用 chrome-devtools-mcp 重新打开 Chrome
2. **Side Panel 触发**：Chrome Side Panel API 要求必须由用户交互触发，不能自动打开
3. **元素定位**：使用 `take_snapshot` 获取页面元素及其 uid，然后用 uid 进行操作
4. **Content Script**：content script 可能因为页面动态加载而未执行，复杂操作建议用 `evaluate_script` 或 background.js 中的 `executeScript`
5. **模式切换验证**：切换后用 `take_snapshot` 查看 `radio "xxx" checked` 确认状态