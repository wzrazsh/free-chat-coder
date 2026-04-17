/**
 * Side Panel 控制脚本 v2
 * 主视图：聊天日志 + 输入框
 * 设置视图：服务启停 + DeepSeek Agent + 自动进化
 */
const HOST_NAME = "com.trae.freechatcoder.host";
let port = null;
let statusInterval = null;
let autoScrollEnabled = true;
let pendingConfirms = [];
let confirmPollInterval = null;
const respondingConfirmIds = new Set();
let extensionConversations = [];
let activeConversationId = null;

// 自动进化状态
let autoEvolveState = {
  active: false,
  sessionId: null,
  direction: '',
  deepseekTabId: null,
  progress: 0
};

function updateQueuePortLabel(portNumber) {
  const portTag = document.getElementById('queue-port-tag');
  if (!portTag) {
    return;
  }

  portTag.textContent = portNumber ? `:${portNumber}` : ':8080+';
}

async function getQueueServerTarget(force = false) {
  const target = await queueConfig.discoverQueueServer({ force });
  updateQueuePortLabel(target.port);
  return target;
}

async function queueFetch(path, init) {
  const target = await getQueueServerTarget();
  const url = `${target.httpUrl}${path}`;

  try {
    return await fetch(url, init);
  } catch (error) {
    queueConfig.clearQueueServerCache();
    const retryTarget = await getQueueServerTarget(true);
    return fetch(`${retryTarget.httpUrl}${path}`, init);
  }
}

// ══════════════════════════════════════════
//  视图切换
// ══════════════════════════════════════════

function showMainView() {
  document.getElementById('main-view').classList.remove('hidden');
  document.getElementById('settings-view').classList.add('hidden');
}

function showSettingsView() {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('settings-view').classList.remove('hidden');
}

document.getElementById('btn-settings').addEventListener('click', showSettingsView);
document.getElementById('btn-back').addEventListener('click', showMainView);

// ══════════════════════════════════════════
//  日志区域
// ══════════════════════════════════════════

const logArea = document.getElementById('log-area');
const welcomeHint = document.getElementById('welcome-hint');
const approvalStrip = document.getElementById('approval-strip');
const approvalCount = document.getElementById('approval-count');
const approvalList = document.getElementById('approval-list');
const approvalEmpty = document.getElementById('approval-empty');
const conversationList = document.getElementById('conversation-list');
const conversationEmpty = document.getElementById('conversation-empty');
const conversationStripMeta = document.getElementById('conversation-strip-meta');

function formatConfirmParams(params) {
  if (!params) return '';
  try {
    return JSON.stringify(params, null, 2);
  } catch (err) {
    return String(params);
  }
}

function renderPendingConfirms() {
  approvalCount.textContent = String(pendingConfirms.length);

  if (pendingConfirms.length === 0) {
    approvalStrip.classList.remove('visible');
    approvalList.innerHTML = '';
    approvalEmpty.style.display = 'block';
    return;
  }

  approvalStrip.classList.add('visible');
  approvalEmpty.style.display = 'none';
  approvalList.innerHTML = pendingConfirms.map((confirm) => {
    const paramsText = formatConfirmParams(confirm.params);
    const createdAt = confirm.createdAt || confirm.timestamp;
    const isResponding = respondingConfirmIds.has(confirm.confirmId);

    return `
      <div class="approval-card" data-confirm-id="${escapeHtml(confirm.confirmId)}">
        <div class="approval-card-head">
          <h4>${escapeHtml(confirm.action || 'Unknown action')}</h4>
          <span class="approval-risk">${escapeHtml((confirm.riskLevel || 'unknown').toUpperCase())}</span>
        </div>
        <div class="approval-meta">
          <span>Task: ${escapeHtml(confirm.taskId || '-')}</span>
          <span>Created: ${escapeHtml(createdAt ? new Date(createdAt).toLocaleString() : '-')}</span>
        </div>
        ${paramsText ? `<div class="approval-params">${escapeHtml(paramsText)}</div>` : ''}
        <div class="approval-actions">
          <button class="btn btn-stop" data-confirm-id="${escapeHtml(confirm.confirmId)}" data-approved="false" ${isResponding ? 'disabled' : ''}>Reject</button>
          <button class="btn btn-start" data-confirm-id="${escapeHtml(confirm.confirmId)}" data-approved="true" ${isResponding ? 'disabled' : ''}>${isResponding ? 'Submitting...' : 'Approve'}</button>
        </div>
      </div>
    `;
  }).join('');
}

async function fetchPendingConfirms() {
  try {
    const response = await queueFetch('/tasks/confirms');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    pendingConfirms = Array.isArray(data.confirms) ? data.confirms : [];
    renderPendingConfirms();
  } catch (err) {
    console.warn('[SidePanel] Failed to fetch confirms:', err.message || err);
    pendingConfirms = [];
    renderPendingConfirms();
  }
}

async function respondConfirm(confirmId, approved) {
  respondingConfirmIds.add(confirmId);
  renderPendingConfirms();

  try {
    const response = await queueFetch(`/tasks/confirms/${confirmId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    pendingConfirms = pendingConfirms.filter((confirm) => confirm.confirmId !== confirmId);
    addLogMessage('system', approved ? `✅ 已批准 ${confirmId}` : `⛔ 已拒绝 ${confirmId}`);
  } catch (err) {
    addLogMessage('system', `❌ 审批提交失败: ${err.message || err}`);
  } finally {
    respondingConfirmIds.delete(confirmId);
    renderPendingConfirms();
  }
}

approvalList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-confirm-id]');
  if (!button) {
    return;
  }

  const { confirmId, approved } = button.dataset;
  if (!confirmId) {
    return;
  }

  respondConfirm(confirmId, approved === 'true');
});

function formatConversationTime(value) {
  if (!value) {
    return '未同步';
  }

  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
}

function renderConversationList() {
  conversationStripMeta.textContent = `${extensionConversations.length} 个会话`;

  if (extensionConversations.length === 0) {
    conversationList.innerHTML = '';
    conversationEmpty.style.display = 'block';
    return;
  }

  conversationEmpty.style.display = 'none';
  conversationList.innerHTML = extensionConversations.map((conversation) => {
    const activeClass = conversation.id === activeConversationId ? ' active' : '';
    const title = escapeHtml(conversation.title || '未命名会话');
    const preview = escapeHtml(conversation.lastMessagePreview || conversation.deepseekSessionId || '等待首条消息');
    const updatedAt = escapeHtml(formatConversationTime(conversation.updatedAt));

    return `
      <button class="conversation-chip${activeClass}" data-conversation-id="${escapeHtml(conversation.id)}">
        <div class="conversation-chip-title">${title}</div>
        <div class="conversation-chip-meta">${preview}</div>
        <div class="conversation-chip-meta">${updatedAt}</div>
      </button>
    `;
  }).join('');
}

async function fetchExtensionConversations(preferredConversationId = null) {
  try {
    const response = await queueFetch('/conversations?origin=extension&limit=50');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    extensionConversations = Array.isArray(data.conversations) ? data.conversations : [];

    if (preferredConversationId) {
      activeConversationId = preferredConversationId;
    } else if (!activeConversationId && extensionConversations.length > 0) {
      activeConversationId = extensionConversations[0].id;
    } else if (activeConversationId && !extensionConversations.some((conversation) => conversation.id === activeConversationId)) {
      activeConversationId = extensionConversations[0]?.id || null;
    }

    renderConversationList();
    return extensionConversations;
  } catch (error) {
    console.warn('[SidePanel] Failed to fetch conversations:', error.message || error);
    extensionConversations = [];
    activeConversationId = null;
    renderConversationList();
    return [];
  }
}

function resetLogArea() {
  logArea.innerHTML = '';
}

async function loadConversationMessages(conversationId) {
  if (!conversationId) {
    resetLogArea();
    addLogMessage('system', '当前没有激活的扩展会话');
    return;
  }

  try {
    const response = await queueFetch(`/conversations/${conversationId}/messages`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];
    resetLogArea();

    if (messages.length === 0) {
      addLogMessage('system', '会话已创建，等待第一条消息');
      return;
    }

    messages.forEach((message) => {
      if (message.role === 'user') {
        addLogMessage('user', message.content);
      } else if (message.role === 'assistant') {
        addLogMessage('ai', {
          content: message.content,
          thinkContent: message.metadata?.thinkContent || ''
        });
      } else {
        addLogMessage('system', message.content);
      }
    });
  } catch (error) {
    addLogMessage('system', `❌ 读取会话失败: ${error.message || error}`);
  }
}

async function activateConversationFromUi(conversationId) {
  if (!conversationId) {
    return;
  }

  activeConversationId = conversationId;
  renderConversationList();
  showTyping();

  chrome.runtime.sendMessage({ type: 'activate_conversation', conversationId }, async (response) => {
    hideTyping();

    if (chrome.runtime.lastError) {
      addLogMessage('system', `❌ 切换会话失败: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (!response || response.success === false) {
      addLogMessage('system', `❌ 切换会话失败: ${response?.error || '未知错误'}`);
      return;
    }

    await fetchExtensionConversations(conversationId);
    await loadConversationMessages(conversationId);
  });
}

function createNewConversationFromUi() {
  showTyping();
  chrome.runtime.sendMessage({ type: 'start_extension_conversation' }, async (response) => {
    hideTyping();

    if (chrome.runtime.lastError) {
      addLogMessage('system', `❌ 新建会话失败: ${chrome.runtime.lastError.message}`);
      return;
    }

    if (!response || response.success === false) {
      addLogMessage('system', `❌ 新建会话失败: ${response?.error || '未知错误'}`);
      return;
    }

    activeConversationId = response.conversation?.id || null;
    await fetchExtensionConversations(activeConversationId);
    await loadConversationMessages(activeConversationId);
  });
}

conversationList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-conversation-id]');
  if (!button) {
    return;
  }

  activateConversationFromUi(button.dataset.conversationId);
});

document.getElementById('create-conversation').addEventListener('click', createNewConversationFromUi);

/**
 * 添加消息到日志区域
 * @param {'user'|'ai'|'system'|'task'} type
 * @param {string|{content?: string, thinkContent?: string}} text
 * @param {object} [opts] - { failed: boolean, label: string }
 */
function addLogMessage(type, text, opts = {}) {
  // 隐藏欢迎提示
  if (welcomeHint) welcomeHint.style.display = 'none';

  const div = document.createElement('div');

  if (type === 'user') {
    div.className = 'msg msg-user';
    div.textContent = text;
  } else if (type === 'ai') {
    div.className = 'msg msg-ai';
    div.innerHTML = renderAiMessage(text);
  } else if (type === 'system') {
    div.className = 'msg msg-system';
    div.textContent = text;
  } else if (type === 'task') {
    div.className = 'msg msg-task' + (opts.failed ? ' failed' : '');
    const label = document.createElement('div');
    label.className = 'task-label';
    label.innerHTML = '<span class="dot"></span>' + (opts.label || 'Task Result');
    div.appendChild(label);
    const content = document.createElement('div');
    content.innerHTML = renderMarkdown(text);
    div.appendChild(content);
  }

  logArea.appendChild(div);

  if (autoScrollEnabled) {
    requestAnimationFrame(() => {
      logArea.scrollTop = logArea.scrollHeight;
    });
  }
}

function renderAiMessage(payload) {
  const message = typeof payload === 'string'
    ? { content: payload, thinkContent: '' }
    : {
        content: payload?.content || '',
        thinkContent: payload?.thinkContent || ''
      };

  const sections = [];
  if (message.thinkContent.trim()) {
    sections.push(
      '<details class="ai-thought"><summary><span>思考过程</span><span class="ai-section-hint">默认折叠</span></summary><div class="ai-section-body">' +
      renderMarkdown(message.thinkContent) +
      '</div></details>'
    );
  }

  sections.push(
    '<section class="ai-answer"><div class="ai-section-title">最终回复</div><div class="ai-section-body">' +
    renderMarkdown(message.content) +
    '</div></section>'
  );

  return sections.join('');
}

/**
 * 显示/移除打字指示器
 */
let typingEl = null;
function showTyping() {
  if (typingEl) return;
  if (welcomeHint) welcomeHint.style.display = 'none';
  typingEl = document.createElement('div');
  typingEl.className = 'typing-indicator';
  typingEl.innerHTML = '<span></span><span></span><span></span>';
  logArea.appendChild(typingEl);
  if (autoScrollEnabled) {
    requestAnimationFrame(() => { logArea.scrollTop = logArea.scrollHeight; });
  }
}
function hideTyping() {
  if (typingEl) {
    typingEl.remove();
    typingEl = null;
  }
}

/**
 * 简易 Markdown 渲染（代码块 + 换行）
 */
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // 代码块 ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    return '<pre><code>' + code.trim() + '</code></pre>';
  });
  // 行内代码 `...`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗体 **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 换行
  html = html.replace(/\n/g, '<br>');
  return html;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 检测用户滚动，暂停/恢复自动滚动
logArea.addEventListener('scroll', () => {
  const atBottom = logArea.scrollHeight - logArea.scrollTop - logArea.clientHeight < 40;
  autoScrollEnabled = atBottom;
});

// ══════════════════════════════════════════
//  聊天发送
// ══════════════════════════════════════════

const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('btn-send');
let isSending = false;

function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isSending) return;

  isSending = true;
  sendBtn.disabled = true;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 显示用户消息
  addLogMessage('user', text);
  showTyping();

  // 发送给 background.js
  chrome.runtime.sendMessage(
    { type: 'sidepanel_chat', prompt: text, conversationId: activeConversationId },
    (response) => {
      if (chrome.runtime.lastError) {
        hideTyping();
        isSending = false;
        sendBtn.disabled = false;
        addLogMessage('system', '❌ 发送失败: ' + chrome.runtime.lastError.message);
        return;
      }

      if (!response || response.accepted !== true) {
        hideTyping();
        isSending = false;
        sendBtn.disabled = false;
        addLogMessage('system', '❌ ' + (response?.error || '发送失败'));
      }
    }
  );
}

sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// 自动调节输入框高度
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// ══════════════════════════════════════════
//  连接状态
// ══════════════════════════════════════════

function updateConnectionUI(connected) {
  const dot = document.getElementById('conn-dot');
  const text = document.getElementById('conn-text');
  if (connected) {
    dot.className = 'conn-dot online';
    text.textContent = 'Connected';
  } else {
    dot.className = 'conn-dot offline';
    text.textContent = 'Disconnected';
  }
}

// ══════════════════════════════════════════
//  进化状态
// ══════════════════════════════════════════

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

function saveEvolveState() {
  chrome.storage.local.set({ autoEvolveState });
}

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
    stopBtn.style.display = 'inline-flex';
    linkBtn.style.display = 'inline-flex';
    statusDiv.className = 'evolve-status active';
    statusText.textContent = '🟢 进化中... (进度: ' + autoEvolveState.progress + '%)';
    sessionDiv.style.display = 'flex';
    sessionInfo.textContent = autoEvolveState.sessionId || '新会话';
    directionInput.disabled = true;
  } else {
    startBtn.style.display = 'inline-flex';
    stopBtn.style.display = 'none';
    linkBtn.style.display = 'none';
    statusDiv.className = 'evolve-status';
    statusText.textContent = autoEvolveState.sessionId
      ? '⏸ 已暂停，可继续进化'
      : '点击"开始进化"启动主动进化模式';
    sessionDiv.style.display = autoEvolveState.sessionId ? 'flex' : 'none';
    sessionInfo.textContent = autoEvolveState.sessionId || '';
    directionInput.disabled = false;
    if (autoEvolveState.direction) {
      directionInput.value = autoEvolveState.direction;
    }
  }
}

async function startAutoEvolve() {
  const direction = document.getElementById('evolve-direction').value.trim();
  if (!direction) {
    alert('请输入进化方向');
    return;
  }

  const sessionId = 'evolve-' + Date.now().toString(36);

  const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
  let deepseekTabId;
  if (tabs.length > 0) {
    deepseekTabId = tabs[0].id;
    await chrome.tabs.update(deepseekTabId, { active: true });
  } else {
    const newTab = await chrome.tabs.create({ url: "https://chat.deepseek.com/", active: true });
    deepseekTabId = newTab.id;
    await new Promise((resolve) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === deepseekTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(resolve, 2000);
        }
      });
    });
  }

  autoEvolveState = {
    active: true,
    sessionId: sessionId,
    direction: direction,
    deepseekTabId: deepseekTabId,
    progress: 0
  };

  saveEvolveState();
  updateEvolveUI();

  addLogMessage('system', '🔮 自动进化已启动: ' + direction);

  chrome.runtime.sendMessage({
    type: 'start_auto_evolve',
    sessionId: sessionId,
    direction: direction,
    deepseekTabId: deepseekTabId
  });
}

function stopAutoEvolve() {
  autoEvolveState.active = false;
  saveEvolveState();
  updateEvolveUI();
  addLogMessage('system', '⏸ 自动进化已停止');
  chrome.runtime.sendMessage({ type: 'stop_auto_evolve' });
}

function updateEvolveProgress(progress) {
  autoEvolveState.progress = progress;
  saveEvolveState();
  updateEvolveUI();
}

// ══════════════════════════════════════════
//  Native Host 通信
// ══════════════════════════════════════════

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'status') {
        updateStatus('queue', msg.queueServerRunning);
        updateStatus('web', msg.webConsoleRunning);
        updateQueuePortLabel(msg.queueServerPort);
        document.getElementById('error').textContent = '';
        document.getElementById('setup-hint').style.display = 'none';
        updateConnectionUI(true);
      } else if (msg.type === 'error') {
        document.getElementById('error').textContent = msg.message;
        addLogMessage('system', '⚠️ Host 错误: ' + msg.message);
      } else if (msg.type === 'evolve_progress') {
        updateEvolveProgress(msg.progress);
      } else if (msg.type === 'heartbeat_status') {
        updateStatus('queue', msg.queueAlive);
        updateStatus('web', msg.webAlive);
        updateQueuePortLabel(msg.queueServerPort);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) {
        document.getElementById('error').textContent = 'Native Host 断开: ' + err.message;
        document.getElementById('setup-hint').style.display = 'block';
        addLogMessage('system', '🔴 Native Host 断开连接');
      }
      updateQueuePortLabel(null);
      updateStatus('queue', false, 'Disconnected');
      updateStatus('web', false, 'Disconnected');
      updateConnectionUI(false);
      port = null;
    });
  } catch (err) {
    document.getElementById('error').textContent = 'Connection Error: ' + err.message;
    document.getElementById('setup-hint').style.display = 'block';
    updateConnectionUI(false);
  }
}

function updateStatus(server, isRunning, customText) {
  const textEl = document.getElementById('status-' + server);
  const dotEl = document.getElementById('dot-' + server);
  if (!textEl || !dotEl) return;

  if (customText) {
    textEl.textContent = customText;
    dotEl.className = 'dot';
  } else {
    textEl.textContent = isRunning ? 'Running' : 'Stopped';
    dotEl.className = 'dot ' + (isRunning ? 'running' : 'stopped');
  }
}

function sendCommand(command) {
  if (!port) connectHost();
  if (port) {
    try {
      port.postMessage({ command });
    } catch (err) {
      console.error(err);
    }
  }
}

// ══════════════════════════════════════════
//  监听 background 消息（任务更新、聊天回复）
// ══════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'chat_reply') {
    hideTyping();
    isSending = false;
    sendBtn.disabled = false;
    if (msg.error) {
      addLogMessage('system', '❌ ' + msg.error);
    } else {
      activeConversationId = msg.conversationId || activeConversationId;
      fetchExtensionConversations(activeConversationId)
        .then(() => loadConversationMessages(activeConversationId))
        .catch((error) => addLogMessage('system', '❌ 会话刷新失败: ' + (error.message || error)));
    }
  }
  else if (msg.type === 'task_update') {
    // Queue Server 任务结果
    if (msg.status === 'completed') {
      addLogMessage('task', msg.result, { label: '✅ 任务完成', failed: false });
    } else if (msg.status === 'failed') {
      addLogMessage('task', msg.error || '未知错误', { label: '❌ 任务失败', failed: true });
    }
  }
  else if (msg.type === 'confirm_request') {
    const existingIndex = pendingConfirms.findIndex((confirm) => confirm.confirmId === msg.confirmId);
    if (existingIndex === -1) {
      pendingConfirms.unshift(msg);
    } else {
      pendingConfirms[existingIndex] = msg;
    }
    renderPendingConfirms();
  }
  else if (msg.type === 'confirm_resolved') {
    pendingConfirms = pendingConfirms.filter((confirm) => confirm.confirmId !== msg.confirmId);
    renderPendingConfirms();
  }
  else if (msg.type === 'heartbeat_status') {
    updateStatus('queue', msg.queueAlive);
    updateStatus('web', msg.webAlive);
    updateQueuePortLabel(msg.queueServerPort);
  }
  else if (msg.type === 'evolve_progress') {
    updateEvolveProgress(msg.progress);
  }
});

// ══════════════════════════════════════════
//  设置视图事件绑定
// ══════════════════════════════════════════

document.getElementById('start-queue').addEventListener('click', () => {
  sendCommand('start_queue');
  addLogMessage('system', '▶ 启动 Queue Server...');
});
document.getElementById('stop-queue').addEventListener('click', () => {
  sendCommand('stop_queue');
  addLogMessage('system', '■ 停止 Queue Server...');
});
document.getElementById('start-web').addEventListener('click', () => {
  sendCommand('start_web');
  addLogMessage('system', '▶ 启动 Web Console...');
});
document.getElementById('stop-web').addEventListener('click', () => {
  sendCommand('stop_web');
  addLogMessage('system', '■ 停止 Web Console...');
});
document.getElementById('link-web').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:5173' });
});
document.getElementById('link-deepseek').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chat.deepseek.com' });
});
document.getElementById('test-error').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'content_script_error',
    errorType: 'dom_selector_not_found',
    details: { selector: 'test-button-selector', context: 'sidepanel test', url: 'https://chat.deepseek.com/' }
  }, () => {
    addLogMessage('system', '⚠️ 模拟 DOM 错误已记录');
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

// ══════════════════════════════════════════
//  初始化
// ══════════════════════════════════════════

connectHost();
fetchPendingConfirms();
loadEvolveState().then(() => {
  fetchExtensionConversations().then(() => {
    if (activeConversationId) {
      loadConversationMessages(activeConversationId);
    }
  });

  if (port) {
    sendCommand('status');
    // 侧边栏常驻：每 3 秒轮询状态
    statusInterval = setInterval(() => {
      if (port) sendCommand('status');
    }, 3000);
  }

  confirmPollInterval = setInterval(() => {
    fetchPendingConfirms();
  }, 5000);

  // 恢复进化会话
  if (autoEvolveState.active && autoEvolveState.direction) {
    chrome.runtime.sendMessage({
      type: 'resume_auto_evolve',
      sessionId: autoEvolveState.sessionId,
      direction: autoEvolveState.direction,
      deepseekTabId: autoEvolveState.deepseekTabId
    }, (response) => {
      if (!response || !response.success) {
        autoEvolveState.active = false;
        saveEvolveState();
        updateEvolveUI();
      }
    });
  }
});

// 侧边栏关闭时清理
window.addEventListener('unload', () => {
  if (statusInterval) clearInterval(statusInterval);
  if (confirmPollInterval) clearInterval(confirmPollInterval);
});
