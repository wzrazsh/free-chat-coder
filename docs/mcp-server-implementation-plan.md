# MCP Server Implementation Plan

## Overview

将 Chrome 扩展功能封装成 MCP (Model Context Protocol) 服务器，使 AI 模型能够通过标准协议调用 DeepSeek 扩展功能。

## Technical Architecture

```
AI Model (Claude/GPT etc.)
    ↓ (MCP Stdio)
MCP Server (queue-server/mcp-server.js)
    ↓ (HTTP API)
Queue Server (queue-server/index.js, port 8080-8090)
    ↓ (WebSocket)
Chrome Extension (background.js)
    ↓ (Content Script)
DeepSeek Web UI
```

## Decision Log

### Communication Method
- **Chosen**: Through Queue Server HTTP API (Recommended)
- **Reason**: Avoid technical conflict between MCP Stdio and Chrome Native Messaging (both use stdin/stdout)
- **Alternative considered**: Native Messaging directly - rejected due to stdio conflict

### Transport Protocol
- **Chosen**: Stdio
- **Reason**: Standard for local CLI tools and direct AI model integration

### Deployment
- **Chosen**: integrate into queue-server/
- **Reason**: Reuse existing architecture, shared configuration and state

## File Changes Checklist

| File | Action | Description |
|------|--------|-------------|
| `queue-server/package.json` | Modify | Add `@modelcontextprotocol/sdk` and `zod` dependencies |
| `queue-server/mcp-server.js` | Create | MCP server implementation |
| `queue-server/index.js` | Modify | Optional MCP server startup |

## Implementation Steps

### Step 1: Install Dependencies ✓ (Completed)

```bash
cd queue-server
npm install @modelcontextprotocol/sdk zod
```

### Step 2: Create `queue-server/mcp-server.js`

Key implementation points:
- Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- Use `StdioServerTransport` for communication
- Implement `server.tool()` for each tool
- Use `callQueueAPI()` to communicate with Queue Server
- Implement `pollTask()` for waiting task completion

### Step 3: Modify `queue-server/package.json`

Add MCP server startup script:

```json
{
  "scripts": {
    "start:mcp": "node mcp-server.js"
  }
}
```

### Step 4: MCP Configuration (for AI models)

Create `mcp-config.json`:

```json
{
  "mcpServers": {
    "free-chat-coder": {
      "command": "node",
      "args": ["E:\\AIwork\\free-chat-coder\\queue-server\\mcp-server.js"]
    }
  }
}
```

## Available MCP Tools

| Tool Name | Function | API Call |
|-----------|----------|----------|
| `submit_prompt` | Submit prompt to DeepSeek | POST /tasks |
| `get_task_status` | Query task status | GET /tasks/:id |
| `list_conversations` | List conversations | GET /conversations |
| `get_conversation` | Get conversation details | GET /conversations/:id |

## Future Extensions (Optional)

To support more extension features (e.g., `set_mode`, `upload_file`, `take_screenshot`):

1. Add new HTTP API endpoints in Queue Server
2. Send messages to extension via WebSocket
3. MCP server calls new APIs and polls for results

## Testing Plan

1. Start Queue Server: `cd queue-server && npm run dev`
2. Start MCP Server: `node queue-server/mcp-server.js`
3. Test with MCP client (e.g., Claude Desktop) using the tools

## Technical Notes

### Stdio vs Native Messaging Conflict

Chrome Native Messaging uses stdin/stdout for communication with native hosts.
MCP Stdio transport also uses stdin/stdout for communication with AI models.
**Solution**: MCP Server communicates with Queue Server via HTTP API, avoiding direct Native Messaging.

### Queue Server Auto-Discovery

The Queue Server may run on different ports (8080-8090). Use `shared/queue-server.js` `discoverQueueServer()` to find the active port.

## References

- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Chrome Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Project AGENTS.md: Guidelines for file conventions and architecture
