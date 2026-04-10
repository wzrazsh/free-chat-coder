const WebSocket = require('ws');
const queueManager = require('../queue/manager');
const customHandler = require('../custom-handler');
const codeWriter = require('../evolution/code-writer');

let extensionClients = new Set();
let webClients = new Set();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    let clientType = 'unknown';

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'register') {
          clientType = data.clientType;
          if (clientType === 'extension') {
            extensionClients.add(ws);
            console.log('[WS] Extension registered');
            assignNextTask();
          } else if (clientType === 'web') {
            webClients.add(ws);
            console.log('[WS] Web client registered');
          }
        }
        
        else if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }

        else if (data.type === 'task_update') {
          console.log(`[WS] Task update received for ${data.taskId}: ${data.status}`);
          const { taskId, status, result, error } = data;
          
          let writeResult = null;

          if (status === 'completed' && result) {
            try {
              const task = queueManager.getTask(taskId);
              if (task) {
                let shouldAutoWrite = false;
                if (customHandler && typeof customHandler.processResult === 'function') {
                  const handlerResult = customHandler.processResult(task, result);
                  shouldAutoWrite = handlerResult.shouldAutoWrite;
                }

                if (shouldAutoWrite) {
                  writeResult = codeWriter.writeCodeToFiles(task, result);
                  if (writeResult.success) {
                    console.log(`[WS] Auto-wrote code to ${writeResult.filesWritten.length} file(s)`);
                  } else {
                    console.log(`[WS] Auto-write skipped: ${writeResult.reason}`);
                  }
                }
              }
            } catch (err) {
              console.error('[WS] Error in auto-write:', err);
            }
          }

          const updatedTask = queueManager.updateTask(taskId, { 
            status, 
            result, 
            error,
            ...(writeResult && writeResult.success ? { codeWriteResult: writeResult } : {})
          });

          if (updatedTask) {
            broadcastToWeb({
              type: 'task_update',
              task: updatedTask,
              ...(writeResult ? { codeWriteResult: writeResult } : {})
            });

            if (status === 'completed' || status === 'failed') {
              assignNextTask();
            }
          }
        }
      } catch (err) {
        console.error('[WS] Error parsing message:', err);
      }
    });

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

function assignNextTask() {
  if (extensionClients.size === 0) {
    return;
  }

  const client = extensionClients.values().next().value;
  if (client && client.readyState === WebSocket.OPEN) {
    const nextTask = queueManager.getNextPendingTask();
    if (nextTask) {
      queueManager.updateTask(nextTask.id, { status: 'processing' });
      
      let processedPrompt = nextTask.prompt;
      try {
        if (customHandler && typeof customHandler.processTask === 'function') {
          processedPrompt = customHandler.processTask(nextTask);
        }
      } catch (err) {
        console.error('[WS] Error in custom-handler:', err);
      }
      
      client.send(JSON.stringify({
        type: 'task_assigned',
        task: { ...nextTask, prompt: processedPrompt }
      }));

      broadcastToWeb({
        type: 'task_update',
        task: queueManager.getTask(nextTask.id)
      });
      
      console.log(`[WS] Assigned task ${nextTask.id} to extension`);
    }
  }
}

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

function triggerAssign() {
  assignNextTask();
}

module.exports = setupWebSocket;
module.exports.broadcastToWeb = broadcastToWeb;
module.exports.broadcastToExtensions = broadcastToExtensions;
module.exports.triggerAssign = triggerAssign;
