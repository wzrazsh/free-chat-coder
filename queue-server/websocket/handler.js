// /workspace/queue-server/websocket/handler.js
const WebSocket = require('ws');
const queueManager = require('../queue/manager');
const customHandler = require('../custom-handler');

// Keep track of connected extension clients
let extensionClients = new Set();
// Keep track of web console clients
let webClients = new Set();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    let clientType = 'unknown';

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Handle registration
        if (data.type === 'register') {
          clientType = data.clientType;
          if (clientType === 'extension') {
            extensionClients.add(ws);
            console.log('[WS] Extension registered');
            // Try to assign pending task if any
            assignNextTask();
          } else if (clientType === 'web') {
            webClients.add(ws);
            console.log('[WS] Web client registered');
          }
        }
        
        // Handle ping/pong
        else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }

        // Handle task updates from extension
        else if (data.type === 'task_update') {
          console.log(`[WS] Task update received for ${data.taskId}: ${data.status}`);
          const { taskId, status, result, error } = data;
          
          let task = queueManager.getTask(taskId);
          if (!task) return;

          // Agent 层核心：如果任务状态是 completed，且存在 processResult，交给它处理多轮动作
          if (status === 'completed' && customHandler && typeof customHandler.processResult === 'function') {
            const wsClients = {
              extension: extensionClients.values().next().value,
              web: Array.from(webClients)
            };
            
            customHandler.processResult(task, result, wsClients).then(processRes => {
              if (processRes.status === 'processing') {
                // 还有下一轮，继续发送 prompt
                queueManager.updateTask(taskId, { status: 'processing' });
                
                // 将下一轮反馈发给扩展
                if (wsClients.extension && wsClients.extension.readyState === WebSocket.OPEN) {
                  wsClients.extension.send(JSON.stringify({
                    type: 'task_assigned',
                    task: { ...task, prompt: processRes.nextPrompt }
                  }));
                }
                
                broadcastToWeb({
                  type: 'task_update',
                  task: queueManager.getTask(taskId)
                });
              } else {
                // 真正结束
                finishTaskUpdate(taskId, processRes.status, processRes.result || processRes.result, processRes.error);
              }
            }).catch(err => {
              finishTaskUpdate(taskId, 'failed', null, err.message);
            });
          } else {
            finishTaskUpdate(taskId, status, result, error);
          }
        }
        
        // 处理扩展动作执行的回调 (比如 new_session, screenshot)
        else if (data.type === 'action_result') {
          // TODO: 将来支持更复杂的扩展内动作反馈
          console.log(`[WS] Extension action result received for task ${data.taskId}`);
        }
        
        // 处理扩展自动发起的进化请求
        else if (data.type === 'auto_evolve') {
          console.log(`[WS] Auto-evolve request received: ${data.errorType}`);
          
          const prompt = `[自动进化任务]
系统检测到以下问题需要修复：
- 错误类型: ${data.errorType}
- 错误信息: ${data.errorMessage}
- 发生位置: ${data.location || 'Unknown'}
- 当前代码: ${data.currentCode || 'Unknown'}

请分析问题原因并提供修复后的完整代码。使用 evolve_extension 动作来应用修改。`;

          // 自动创建一个新任务放到队列头部
          const task = queueManager.addTask(prompt, {
            autoEvolve: true,
            skipSystemInstruction: false,
            maxRounds: 5
          });
          
          broadcastToWeb({ type: 'task_update', task });
          assignNextTask();
        }
      } catch (err) {
        console.error('[WS] Error parsing message:', err);
      }
    });

    function finishTaskUpdate(taskId, status, result, error) {
      const updatedTask = queueManager.updateTask(taskId, { status, result, error });
      if (updatedTask) {
        // Broadcast update to web clients
        broadcastToWeb({
          type: 'task_update',
          task: updatedTask
        });

        // If task is completed or failed, we can try to assign the next one
        if (status === 'completed' || status === 'failed') {
          assignNextTask();
        }
      }
    }

    ws.on('close', () => {
      console.log(`[WS] Client disconnected (${clientType})`);
      if (clientType === 'extension') {
        extensionClients.delete(ws);
      } else if (clientType === 'web') {
        webClients.delete(ws);
      }
    });
  });
}

// Push next pending task to an available extension client
function assignNextTask() {
  if (extensionClients.size === 0) {
    return;
  }

  // Currently just pick the first available extension client
  const client = extensionClients.values().next().value;
  if (client && client.readyState === WebSocket.OPEN) {
    const nextTask = queueManager.getNextPendingTask();
    if (nextTask) {
      // Update status to processing
      queueManager.updateTask(nextTask.id, { status: 'processing' });
      
      // Apply custom evolutionary logic to the prompt
      let processedPrompt = nextTask.prompt;
      try {
        if (customHandler && typeof customHandler.processTask === 'function') {
          processedPrompt = customHandler.processTask(nextTask);
        }
      } catch (err) {
        console.error('[WS] Error in custom-handler:', err);
      }
      
      // Send task to extension
      client.send(JSON.stringify({
        type: 'task_assigned',
        task: { ...nextTask, prompt: processedPrompt }
      }));

      // Broadcast update to web clients
      broadcastToWeb({
        type: 'task_update',
        task: queueManager.getTask(nextTask.id)
      });
      
      console.log(`[WS] Assigned task ${nextTask.id} to extension`);
    }
  }
}

// Expose broadcast to web clients so HTTP API can use it
function broadcastToWeb(message) {
  const msgStr = JSON.stringify(message);
  for (const client of webClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }
}

function broadcastToExtensions(message) {
  const msgStr = JSON.stringify(message);
  for (const client of extensionClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msgStr);
    }
  }
}

// Expose trigger to check queue when new tasks arrive
function triggerAssign() {
  assignNextTask();
}

module.exports = setupWebSocket;
module.exports.broadcastToWeb = broadcastToWeb;
module.exports.broadcastToExtensions = broadcastToExtensions;
module.exports.triggerAssign = triggerAssign;
