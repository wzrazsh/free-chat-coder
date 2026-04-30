#!/usr/bin/env node
// queue-server/mcp-server.js
// MCP Server for free-chat-coder
// Exposes Chrome extension functionality via Model Context Protocol

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const http = require('http');

// Create MCP server instance
const server = new McpServer({
  name: 'free-chat-coder-mcp',
  version: '1.0.0'
});

// Helper: Call Queue Server API
async function callQueueAPI(path, options = {}) {
  const { discoverQueueServer } = require('../shared/queue-server');
  const target = await discoverQueueServer();

  return new Promise((resolve, reject) => {
    const urlObj = new URL(target.httpUrl + path);
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: options.timeout || 5000
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`API call failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`API call timeout after ${reqOptions.timeout}ms`));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

// Helper: Poll task until completion
async function pollTask(taskId, timeoutMs = 60000) {
  const start = Date.now();
  const pollInterval = 1000; // 1 second

  while (Date.now() - start < timeoutMs) {
    try {
      const task = await callQueueAPI(`/tasks/${taskId}`);
      if (task.status === 'completed' || task.status === 'failed') {
        return task;
      }
    } catch (error) {
      console.error('[MCP Server] Poll error:', error.message);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Task ${taskId} timeout after ${timeoutMs}ms`);
}

// Register Tool 1: submit_prompt
server.tool(
  'submit_prompt',
  {
    prompt: z.string().describe('The prompt to submit to DeepSeek'),
    provider: z.string().optional().describe('Provider: extension-dom or deepseek-web'),
    conversationId: z.string().optional().describe('Optional conversation ID')
  },
  async ({ prompt, provider, conversationId }) => {
    const task = await callQueueAPI('/tasks', {
      method: 'POST',
      body: {
        prompt,
        options: {
          provider: provider || 'extension-dom',
          conversationId: conversationId || null
        }
      }
    });

    console.error(`[MCP Server] Task created: ${task.id}, waiting...`);
    const result = await pollTask(task.id);

    return {
      content: [{
        type: 'text',
        text: result.result || result.error || 'No reply'
      }]
    };
  }
);

// Register Tool 2: get_task_status
server.tool(
  'get_task_status',
  {
    taskId: z.string().describe('The task ID to query')
  },
  async ({ taskId }) => {
    const task = await callQueueAPI(`/tasks/${taskId}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(task, null, 2)
      }]
    };
  }
);

// Register Tool 3: list_conversations
server.tool(
  'list_conversations',
  {},
  async () => {
    const data = await callQueueAPI('/conversations');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }]
    };
  }
);

// Register Tool 4: get_conversation
server.tool(
  'get_conversation',
  {
    conversationId: z.string().describe('The conversation ID to retrieve')
  },
  async ({ conversationId }) => {
    const [conv, msgs] = await Promise.all([
      callQueueAPI(`/conversations/${conversationId}`),
      callQueueAPI(`/conversations/${conversationId}/messages`)
    ]);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ conversation: conv, messages: msgs }, null, 2)
      }]
    };
  }
);

// Start MCP Server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP Server] Server running on stdio');
  } catch (error) {
    console.error('[MCP Server] Failed to start:', error);
    process.exit(1);
  }
}

main();
