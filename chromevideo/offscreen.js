// /workspace/chromevideo/offscreen.js

let ws;
let reconnectInterval;
let currentWsUrl = null;

// 状态追踪变量
let currentTaskId = null;           // 当前正在执行的任务 ID
let lastHeartbeatTime = null;       // 最后一次发送心跳的时间戳
const startTime = Date.now();       // offscreen 启动时间

async function connect(forceDiscovery = false) {
  try {
    const queueTarget = await queueConfig.discoverQueueServer({ force: forceDiscovery });
    currentWsUrl = queueTarget.wsUrl;

    console.log(`[Offscreen] Attempting to connect to WS on port ${queueTarget.port}...`);
    ws = new WebSocket(queueTarget.wsUrl);

    ws.onopen = () => {
      console.log(`[Offscreen] Connected to Queue-Server on ${currentWsUrl}`);
      ws.send(JSON.stringify({ type: 'register', clientType: 'extension' }));

      if (reconnectInterval) clearInterval(reconnectInterval);
      reconnectInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          lastHeartbeatTime = Date.now();
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') return;

        if (msg.type === 'reload_extension') {
          console.log('[Offscreen] Received reload command from server, passing to background...');
          chrome.runtime.sendMessage({ type: 'reload_extension' });
          return;
        }

        if (msg.type === 'confirm_request' || msg.type === 'confirm_resolved') {
          console.log(`[Offscreen] Forwarding ${msg.type} to background...`);
          chrome.runtime.sendMessage({ ...msg, _relaySource: 'offscreen' });
          return;
        }

        if (msg.type === 'execute_action' || msg.type === 'browser_action') {
          console.log(`[Offscreen] Forwarding ${msg.type} to background...`);
          chrome.runtime.sendMessage({ ...msg, _relaySource: 'offscreen' });
          return;
        }

        console.log('[Offscreen] Received message from server:', msg);

        if (msg.type === 'task_assigned') {
          currentTaskId = msg.task.id;
          chrome.runtime.sendMessage(msg);
        }
      } catch (e) {
        console.error('[Offscreen] Error parsing ws message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Offscreen] WS connection closed, rediscovering queue server in 5s...');
      currentTaskId = null;
      currentWsUrl = null;
      queueConfig.clearQueueServerCache();
      setTimeout(() => {
        void connect(true);
      }, 5000);
    };

    ws.onerror = (err) => {
      console.error('[Offscreen] WS error:', err);
      ws.close();
    };
  } catch (error) {
    console.error('[Offscreen] Failed to discover Queue-Server:', error);
    currentWsUrl = null;
    queueConfig.clearQueueServerCache();
    setTimeout(() => {
      void connect(true);
    }, 5000);
  }
}

void connect();

// Receive messages from Service Worker (like task updates) and forward to server
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'task_update') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log(`[Offscreen] Forwarding ${msg.type} to server:`, msg);
      ws.send(JSON.stringify(msg));
      // 如果是任务完成或失败，清除当前任务 ID
      if (msg.type === 'task_update' && (msg.status === 'completed' || msg.status === 'failed')) {
        currentTaskId = null;
      }
    } else {
      console.warn(`[Offscreen] Cannot forward ${msg.type}, WS disconnected`);
    }
    sendResponse({ received: true });   // 可选，避免回调悬空
    return true;   // 异步响应
  }

  if (msg.type === 'browser_action_result_local') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'browser_action_result',
        requestId: msg.requestId,
        taskId: msg.taskId,
        conversationId: msg.conversationId || null,
        success: msg.success !== false,
        result: msg.result || null,
        error: msg.error || null
      }));
    }

    sendResponse({ received: true });
    return true;
  }
  
  // 新增：状态查询接口
  if (msg.type === 'get_extension_status') {
    const status = {
      wsReadyState: ws ? ws.readyState : -1,
      wsUrl: currentWsUrl,
      lastHeartbeat: lastHeartbeatTime,
      isTaskRunning: !!currentTaskId,
      currentTaskId: currentTaskId || null,
      uptime: Date.now() - startTime
    };
    sendResponse(status);
    return true;
  }
});
