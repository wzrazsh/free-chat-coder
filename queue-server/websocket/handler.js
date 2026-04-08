// /workspace/queue-server/websocket/handler.js
const WebSocket = require('ws');
const queueManager = require('../queue/manager');

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
      
      // Send task to extension
      client.send(JSON.stringify({
        type: 'task_assigned',
        task: nextTask
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

// Expose trigger to check queue when new tasks arrive
function triggerAssign() {
  assignNextTask();
}

module.exports = setupWebSocket;
module.exports.broadcastToWeb = broadcastToWeb;
module.exports.triggerAssign = triggerAssign;
