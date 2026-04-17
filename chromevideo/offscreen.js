// /workspace/chromevideo/offscreen.js

// 自动进化监控模块已在 offscreen.html 中通过 <script> 标签加载
console.log('[Offscreen] Auto-evolve monitor should be loaded via HTML');

let ws;
const WS_URL = 'ws://localhost:8082';
let reconnectInterval;

// 状态追踪变量
let currentTaskId = null;           // 当前正在执行的任务 ID
let lastHeartbeatTime = null;       // 最后一次发送心跳的时间戳
const startTime = Date.now();       // offscreen 启动时间

function connect() {
  console.log('[Offscreen] Attempting to connect to WS...');
  ws = new WebSocket(WS_URL);

  // 监控WebSocket连接错误
  if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.monitorWebSocket) {
    autoEvolveMonitor.monitorWebSocket(ws);
  }

  ws.onopen = () => {
    console.log('[Offscreen] Connected to Queue-Server');
    ws.send(JSON.stringify({ type: 'register', clientType: 'extension' }));
    
    // Heartbeat
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        lastHeartbeatTime = Date.now();   // 记录心跳发送时间
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
      
      // Forward task_assigned to Service Worker
      if (msg.type === 'task_assigned') {
        currentTaskId = msg.task.id;   // 记录当前任务 ID
        chrome.runtime.sendMessage(msg);
      }
    } catch (e) {
      console.error('[Offscreen] Error parsing ws message:', e);
    }
  };
  
  ws.onclose = () => {
    console.log('[Offscreen] WS connection closed, reconnecting in 5s...');
    currentTaskId = null;   // 连接断开时清除任务 ID
    setTimeout(connect, 5000);
  };

  ws.onerror = (err) => {
    console.error('[Offscreen] WS error:', err);
    ws.close();
  };
}

connect();

// Receive messages from Service Worker (like task updates) and forward to server
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'task_update' || msg.type === 'auto_evolve') {
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
      wsReadyState: ws ? ws.readyState : -1,   // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
      wsUrl: WS_URL,
      lastHeartbeat: lastHeartbeatTime,
      isTaskRunning: !!currentTaskId,
      currentTaskId: currentTaskId || null,
      uptime: Date.now() - startTime,
      // 如果 autoEvolveMonitor 存在，获取其统计信息
      errorStats: (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.getStats) 
                  ? autoEvolveMonitor.getStats() 
                  : null
    };
    sendResponse(status);
    return true;
  }
});
