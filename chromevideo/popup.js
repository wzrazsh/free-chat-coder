const HOST_NAME = "com.trae.freechatcoder.host";
let port = null;

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    
    port.onMessage.addListener((msg) => {
      if (msg.type === 'status') {
        updateStatus('queue', msg.queueServerRunning);
        updateStatus('web', msg.webConsoleRunning);
        document.getElementById('error').textContent = '';
        document.getElementById('setup-hint').style.display = 'none';
      } else if (msg.type === 'error') {
        document.getElementById('error').textContent = msg.message;
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) {
        document.getElementById('error').textContent = `Native Host Disconnected: ${err.message}`;
        document.getElementById('setup-hint').style.display = 'block';
      }
      updateStatus('queue', false, 'Disconnected');
      updateStatus('web', false, 'Disconnected');
      port = null;
    });
  } catch (err) {
    document.getElementById('error').textContent = `Connection Error: ${err.message}`;
    document.getElementById('setup-hint').style.display = 'block';
  }
}

function updateStatus(server, isRunning, customText) {
  const textEl = document.getElementById(`status-${server}`);
  const dotEl = document.getElementById(`dot-${server}`);
  
  if (customText) {
    textEl.textContent = customText;
    dotEl.className = 'status-dot';
  } else {
    textEl.textContent = isRunning ? 'Running' : 'Stopped';
    dotEl.className = `status-dot ${isRunning ? 'running' : 'stopped'}`;
  }
}

function sendCommand(command) {
  if (!port) {
    connectHost();
  }
  if (port) {
    try {
      port.postMessage({ command });
    } catch (err) {
      console.error(err);
    }
  }
}

document.getElementById('start-queue').addEventListener('click', () => sendCommand('start_queue'));
document.getElementById('stop-queue').addEventListener('click', () => sendCommand('stop_queue'));
document.getElementById('start-web').addEventListener('click', () => sendCommand('start_web'));
document.getElementById('stop-web').addEventListener('click', () => sendCommand('stop_web'));
document.getElementById('link-web').addEventListener('click', () => { chrome.tabs.create({ url: 'http://localhost:5173' }); });
document.getElementById('link-deepseek').addEventListener('click', () => { chrome.tabs.create({ url: 'https://chat.deepseek.com' }); });

// Check status periodically
connectHost();
if (port) {
  sendCommand('status');
  setInterval(() => {
    if (port) sendCommand('status');
  }, 2000);
}
