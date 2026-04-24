const HOST_NAME = "com.trae.freechatcoder.host";
let port = null;
let workbench = null;

function reportTestDomError() {
  chrome.runtime.sendMessage({
    type: 'content_script_error',
    errorType: 'dom_selector_not_found',
    details: { selector: 'test-button-selector', context: 'popup test', url: 'https://chat.deepseek.com/' }
  }, () => {
    console.log('Error sent');
    alert('Diagnostic error recorded. Check extension status or server logs.');
  });
}

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'status') {
        const errorEl = document.getElementById('error');
        const hintEl = document.getElementById('setup-hint');
        if (
          errorEl.textContent.startsWith('Native Host') ||
          errorEl.textContent.startsWith('Connection Error')
        ) {
          errorEl.textContent = '';
          hintEl.style.display = 'none';
        }
        workbench?.setHostConnected(true);
        workbench?.setHostError('');
        workbench?.setStatus({
          queueAlive: msg.queueServerRunning,
          queuePort: msg.queueServerPort,
          webAlive: msg.webConsoleRunning
        });
        refreshBootstrapStatus();
      } else if (msg.type === 'error') {
        document.getElementById('error').textContent = msg.message;
        workbench?.setHostError(msg.message);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      let message = 'Native Host Disconnected';
      if (err) {
        message = `Native Host Disconnected: ${err.message}`;
        document.getElementById('error').textContent = message;
        document.getElementById('setup-hint').style.display = 'block';
      }
      workbench?.setHostConnected(false);
      workbench?.setHostError(message);
      workbench?.setStatus({
        queueAlive: false,
        queuePort: null,
        webAlive: false
      });
      port = null;
    });
  } catch (err) {
    document.getElementById('error').textContent = `Connection Error: ${err.message}`;
    document.getElementById('setup-hint').style.display = 'block';
    workbench?.setHostConnected(false);
    workbench?.setHostError(`Connection Error: ${err.message}`);
  }
}

function applyBootstrapStatus(status) {
  workbench?.setBootstrapStatus(status);

  if (!status) {
    return;
  }

  const errorEl = document.getElementById('error');
  const hintEl = document.getElementById('setup-hint');

  if (status.state === 'error' || status.state === 'warning') {
    const prefix = status.state === 'error' ? '自动拉起失败' : '自动拉起告警';
    errorEl.textContent = `${prefix}: ${status.message || '未知错误'}`;
    hintEl.style.display = 'block';
    return;
  }

  if (status.state === 'ok' && errorEl.textContent.startsWith('自动拉起')) {
    errorEl.textContent = '';
    hintEl.style.display = 'none';
  }
}

function refreshBootstrapStatus(force = false) {
  chrome.runtime.sendMessage({
    type: force ? 'refresh_service_bootstrap_status' : 'get_service_bootstrap_status'
  }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }

    applyBootstrapStatus(response?.status || null);
  });
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'heartbeat_status') {
    workbench?.setStatus({
      queueAlive: msg.queueAlive,
      queuePort: msg.queueServerPort,
      webAlive: msg.webAlive
    });
  } else if (msg.type === 'service_bootstrap_status') {
    applyBootstrapStatus(msg.status);  }
});

document.getElementById('install-native-host').addEventListener('click', async () => {
  const btn = document.getElementById('install-native-host');
  const resultEl = document.getElementById('install-result');

  btn.disabled = true;
  btn.textContent = 'Installing...';
  resultEl.textContent = '';
  resultEl.style.color = '#6b7280';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'install_native_host' });

    if (response.success) {
      resultEl.textContent = 'Installation successful! Reconnecting...';
      resultEl.style.color = '#10a37f';
      btn.textContent = 'Installed';
      btn.disabled = true;

      // 延迟后重新连接 Native Host
      setTimeout(() => {
        connectHost();
        sendCommand('status');
      }, 1500);
    } else {
      resultEl.textContent = `Installation failed: ${response.error}`;
      resultEl.style.color = '#ef4444';
      btn.textContent = 'Install Native Host';
      btn.disabled = false;
    }
  } catch (err) {
    resultEl.textContent = `Installation failed: ${err.message}`;
    resultEl.style.color = '#ef4444';
    btn.textContent = 'Install Native Host';
    btn.disabled = false;
  }
});

// 初始化
workbench = serviceWorkbench.createServiceWorkbench({
  root: 'service-workbench',
  onCommand: (command) => sendCommand(command),
  onOpenWeb: () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
  },
  onOpenDeepSeek: () => {
    chrome.tabs.create({ url: 'https://chat.deepseek.com' });
  },
  onTestDomError: reportTestDomError,
  onRefresh: () => {
    sendCommand('status');
    refreshBootstrapStatus(true);
  }
});
workbench.load().catch((error) => {
  console.warn('[Popup] Failed to load service workbench:', error.message || error);
});
window.addEventListener('unload', () => {
  workbench?.destroy();
});
connectHost();
refreshBootstrapStatus(true);
if (port) {
  sendCommand('status');
  setInterval(() => {
    if (port) sendCommand('status');
  }, 2000);
}
