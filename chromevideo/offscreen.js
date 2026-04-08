// /workspace/chromevideo/offscreen.js

let ws;
const WS_URL = 'ws://localhost:8080';
let reconnectInterval;

function connect() {
  console.log('[Offscreen] Attempting to connect to WS...');
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('[Offscreen] Connected to Queue-Server');
    ws.send(JSON.stringify({ type: 'register', clientType: 'extension' }));
    
    // Heartbeat
    if (reconnectInterval) clearInterval(reconnectInterval);
    reconnectInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
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

        console.log('[Offscreen] Received message from server:', msg);
        
        // Forward task_assigned to Service Worker
        if (msg.type === 'task_assigned') {
          chrome.runtime.sendMessage(msg);
        }
      } catch (e) {
        console.error('[Offscreen] Error parsing ws message:', e);
      }
    };
  
  ws.onclose = () => {
    console.log('[Offscreen] WS connection closed, reconnecting in 5s...');
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
  if (msg.type === 'task_update') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[Offscreen] Forwarding task update to server:', msg);
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[Offscreen] Cannot forward task update, WS disconnected');
    }
  }
});
