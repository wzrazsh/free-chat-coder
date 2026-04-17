const HOST_NAME = "com.trae.freechatcoder.host";
let port = null;

// 自动进化状态
let autoEvolveState = {
  active: false,
  sessionId: null,
  direction: '',
  deepseekTabId: null,
  progress: 0
};

function updateQueueTitle(portNumber) {
  const queueTitle = document.getElementById('queue-title');
  if (!queueTitle) {
    return;
  }

  queueTitle.textContent = `Queue Server (Port ${portNumber || '8080+'})`;
}

// 加载保存的进化状态
async function loadEvolveState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['autoEvolveState'], (result) => {
      if (result.autoEvolveState) {
        autoEvolveState = result.autoEvolveState;
        updateEvolveUI();
      }
      resolve();
    });
  });
}

// 保存进化状态
function saveEvolveState() {
  chrome.storage.local.set({ autoEvolveState }, () => {
    console.log('[Popup] Evolve state saved:', autoEvolveState);
  });
}

// 更新进化 UI 状态
function updateEvolveUI() {
  const startBtn = document.getElementById('start-evolve');
  const stopBtn = document.getElementById('stop-evolve');
  const linkBtn = document.getElementById('link-evolve-tab');
  const statusText = document.getElementById('evolve-status-text');
  const statusDiv = document.getElementById('evolve-status');
  const sessionDiv = document.getElementById('evolve-session');
  const sessionInfo = document.getElementById('session-info');
  const directionInput = document.getElementById('evolve-direction');

  if (autoEvolveState.active) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';
    linkBtn.style.display = 'inline-block';
    statusDiv.className = 'evolve-status active';
    statusText.textContent = `🟢 进化中... (进度: ${autoEvolveState.progress}%)`;
    sessionDiv.style.display = 'flex';
    sessionInfo.textContent = autoEvolveState.sessionId || '新会话';
    directionInput.disabled = true;
  } else {
    startBtn.style.display = 'inline-block';
    stopBtn.style.display = 'none';
    linkBtn.style.display = 'none';
    statusDiv.className = 'evolve-status';
    statusText.textContent = autoEvolveState.sessionId ?
      '⏸ 已暂停，可继续进化' :
      '点击"开始进化"启动主动进化模式';
    sessionDiv.style.display = autoEvolveState.sessionId ? 'flex' : 'none';
    sessionInfo.textContent = autoEvolveState.sessionId || '';
    directionInput.disabled = false;

    if (autoEvolveState.direction) {
      directionInput.value = autoEvolveState.direction;
    }
  }
}

// 启动自动进化
async function startAutoEvolve() {
  const direction = document.getElementById('evolve-direction').value.trim();

  if (!direction) {
    alert('请输入进化方向');
    return;
  }

  // 生成会话 ID
  const sessionId = 'evolve-' + Date.now().toString(36);

  // 查找或创建 DeepSeek 标签页
  const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });

  let deepseekTabId;
  if (tabs.length > 0) {
    deepseekTabId = tabs[0].id;
    await chrome.tabs.update(deepseekTabId, { active: true });
  } else {
    const newTab = await chrome.tabs.create({ url: "https://chat.deepseek.com/", active: true });
    deepseekTabId = newTab.id;
    // 等待页面加载
    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === deepseekTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000);
        }
      });
    });
  }

  // 更新状态
  autoEvolveState = {
    active: true,
    sessionId: sessionId,
    direction: direction,
    deepseekTabId: deepseekTabId,
    progress: 0
  };

  // 保存状态
  saveEvolveState();
  updateEvolveUI();

  // 通知 background 启动主动进化
  chrome.runtime.sendMessage({
    type: 'start_auto_evolve',
    sessionId: sessionId,
    direction: direction,
    deepseekTabId: deepseekTabId
  }, (response) => {
    if (response && response.success) {
      console.log('[Popup] Auto evolve started successfully');
    }
  });
}

// 停止自动进化
function stopAutoEvolve() {
  autoEvolveState.active = false;
  saveEvolveState();
  updateEvolveUI();

  chrome.runtime.sendMessage({
    type: 'stop_auto_evolve'
  }, (response) => {
    console.log('[Popup] Auto evolve stopped');
  });
}

// 更新进化进度
function updateEvolveProgress(progress) {
  autoEvolveState.progress = progress;
  saveEvolveState();
  updateEvolveUI();
}

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'status') {
        updateStatus('queue', msg.queueServerRunning);
        updateStatus('web', msg.webConsoleRunning);
        updateQueueTitle(msg.queueServerPort);
        document.getElementById('error').textContent = '';
        document.getElementById('setup-hint').style.display = 'none';
      } else if (msg.type === 'error') {
        document.getElementById('error').textContent = msg.message;
      } else if (msg.type === 'evolve_progress') {
        updateEvolveProgress(msg.progress);
      } else if (msg.type === 'heartbeat_status') {
        // 心跳检测到的状态变化
        updateStatus('queue', msg.queueAlive);
        updateStatus('web', msg.webAlive);
        updateQueueTitle(msg.queueServerPort);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) {
        document.getElementById('error').textContent = `Native Host Disconnected: ${err.message}`;
        document.getElementById('setup-hint').style.display = 'block';
      }
      updateQueueTitle(null);
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

// 事件绑定
document.getElementById('start-queue').addEventListener('click', () => sendCommand('start_queue'));
document.getElementById('stop-queue').addEventListener('click', () => sendCommand('stop_queue'));
document.getElementById('start-web').addEventListener('click', () => sendCommand('start_web'));
document.getElementById('stop-web').addEventListener('click', () => sendCommand('stop_web'));
document.getElementById('link-web').addEventListener('click', () => { chrome.tabs.create({ url: 'http://localhost:5173' }); });
document.getElementById('link-deepseek').addEventListener('click', () => { chrome.tabs.create({ url: 'https://chat.deepseek.com' }); });
document.getElementById('test-error').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'content_script_error',
    errorType: 'dom_selector_not_found',
    details: { selector: 'test-button-selector', context: 'popup test', url: 'https://chat.deepseek.com/' }
  }, () => {
    console.log('Error sent');
    alert('错误已记录（注：需累计触发3次才会启动自动进化），请多点几次或查询扩展状态/服务器日志查看任务');
  });
});

// 自动进化事件
document.getElementById('start-evolve').addEventListener('click', startAutoEvolve);
document.getElementById('stop-evolve').addEventListener('click', stopAutoEvolve);
document.getElementById('link-evolve-tab').addEventListener('click', () => {
  if (autoEvolveState.deepseekTabId) {
    chrome.tabs.update(autoEvolveState.deepseekTabId, { active: true });
  }
});

// 初始化
connectHost();
loadEvolveState().then(() => {
  if (port) {
    sendCommand('status');
    setInterval(() => {
      if (port) sendCommand('status');
    }, 2000);
  }

  // 如果之前有活跃的进化会话，尝试恢复
  if (autoEvolveState.active && autoEvolveState.direction) {
    chrome.runtime.sendMessage({
      type: 'resume_auto_evolve',
      sessionId: autoEvolveState.sessionId,
      direction: autoEvolveState.direction,
      deepseekTabId: autoEvolveState.deepseekTabId
    }, (response) => {
      if (response && response.success) {
        console.log('[Popup] Auto evolve resumed');
      } else {
        // 如果恢复失败，可能需要重新开始
        autoEvolveState.active = false;
        saveEvolveState();
        updateEvolveUI();
      }
    });
  }
});
