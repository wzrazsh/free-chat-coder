/**
 * Side Panel 控制脚本 v2
 * 主视图：聊天日志 + 输入框
 * 设置视图：服务启停 + DeepSeek Agent + 自动进化
 */
const HOST_NAME = "com.trae.freechatcoder.host";
let port = null;
let statusInterval = null;
let reconnectInterval = null;
let autoScrollEnabled = true;
let pendingConfirms = [];
let confirmPollInterval = null;
const respondingConfirmIds = new Set();
let extensionConversations = [];
let activeConversationId = null;
let selectedModeProfile = 'expert';
let pendingAttachments = [];
let workbench = null;

function updateQueuePortLabel(portNumber) {
  return portNumber;
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
      <div class="conversation-chip${activeClass}" data-conversation-id="${escapeHtml(conversation.id)}" role="button" tabindex="0">
        <button class="conversation-chip-delete" data-conversation-id="${escapeHtml(conversation.id)}" title="删除会话">×</button>
        <div class="conversation-chip-title">${title}</div>
        <div class="conversation-chip-meta">${preview}</div>
        <div class="conversation-chip-meta">${updatedAt}</div>
      </div>
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
  clearAttachments();
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

// 新建对话（带并发保护）
let isCreatingConversation = false;

function createNewConversationFromUi() {
  if (isCreatingConversation) {
    addLogMessage('system', '⚠️ 正在创建会话，请稍候...');
    return;
  }
  
  isCreatingConversation = true;
  resetLogArea();
  clearAttachments();
  showTyping();
  
  chrome.runtime.sendMessage(
    { type: 'start_extension_conversation', modeProfile: selectedModeProfile },
    async (response) => {
    isCreatingConversation = false;
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
    addLogMessage('system', `✅ 新建${selectedModeProfile === 'quick' ? '快速' : '专家'}模式会话成功`);
    await fetchExtensionConversations(activeConversationId);
    await loadConversationMessages(activeConversationId);
  });
}

conversationList.addEventListener('click', (event) => {
  const deleteBtn = event.target.closest('.conversation-chip-delete');
  if (deleteBtn) {
    deleteConversationFromUi(deleteBtn.dataset.conversationId);
    return;
  }

  const chip = event.target.closest('[data-conversation-id]');
  if (!chip) {
    return;
  }

  activateConversationFromUi(chip.dataset.conversationId);
});

conversationList.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    const chip = event.target.closest('[data-conversation-id]');
    if (chip) {
      event.preventDefault();
      activateConversationFromUi(chip.dataset.conversationId);
    }
  }
});

document.getElementById('create-conversation').addEventListener('click', createNewConversationFromUi);

async function deleteConversationFromUi(conversationId) {
  if (!conversationId) return;
  if (!confirm('确认移除当前会话监控？')) return;

  try {
    const response = await queueFetch(`/conversations/${conversationId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    extensionConversations = extensionConversations.filter(c => c.id !== conversationId);
    if (activeConversationId === conversationId) {
      activeConversationId = extensionConversations[0]?.id || null;
    }
    renderConversationList();
    if (activeConversationId) {
      await loadConversationMessages(activeConversationId);
    } else {
      resetLogArea();
      addLogMessage('system', '所有会话已删除');
    }
  } catch (error) {
    addLogMessage('system', `❌ 删除会话失败: ${error.message || error}`);
  }
}

// Mode selector with concurrency handling
let isModeSwitching = false;
let modeSwitchAbortController = null;

document.querySelectorAll('.mode-option').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const newMode = btn.dataset.mode;
    if (isModeSwitching || selectedModeProfile === newMode) return;
    
    isModeSwitching = true;
    modeSwitchAbortController = new AbortController();
    
    btn.classList.add('switching');
    document.querySelectorAll('.mode-option').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    
    try {
      addLogMessage('system', `🔄 切换到${newMode === 'quick' ? '快速' : '专家'}模式...`);
      
      const tabId = await getDeepSeekTabId();
      if (!tabId) {
        selectedModeProfile = newMode;
        addLogMessage('system', `✅ 已切换到${newMode === 'quick' ? '快速' : '专家'}模式`);
        return;
      }
      
      const response = await chrome.tabs.sendMessage(tabId, {
        action: 'setModeProfile',
        params: { profile: newMode }
      });
      
      if (response && response.success) {
        selectedModeProfile = newMode;
        addLogMessage('system', `✅ 已切换到${newMode === 'quick' ? '快速' : '专家'}模式`);
      } else {
        throw new Error(response?.error || '模式切换失败');
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('[ModeSwitch] Error:', error);
      btn.classList.remove('active');
      const prevBtn = document.querySelector(`.mode-option[data-mode="${selectedModeProfile}"]`);
      if (prevBtn) prevBtn.classList.add('active');
      addLogMessage('system', `❌ 模式切换失败: ${error.message || '未知错误'}`);
    } finally {
      setTimeout(() => btn.classList.remove('switching'), 300);
      isModeSwitching = false;
      modeSwitchAbortController = null;
    }
  });
});

async function getDeepSeekTabId() {
  const tabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' });
  return tabs.length > 0 ? tabs[0].id : null;
}

// File upload
document.getElementById('btn-attach')?.addEventListener('click', () => {
  document.getElementById('file-input')?.click();
});

document.getElementById('file-input')?.addEventListener('change', async (event) => {
  const files = event.target.files;
  if (!files || !files.length) return;

  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      addLogMessage('system', `❌ 文件过大: ${file.name} (最大 20MB)`);
      continue;
    }

    const currentTotal = pendingAttachments.reduce((sum, a) => sum + a.size, 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE) {
      addLogMessage('system', '❌ 附件总大小超过 50MB 限制');
      break;
    }

    try {
      const base64 = await fileToBase64(file);
      pendingAttachments.push({
        name: file.name,
        size: file.size,
        type: file.type,
        base64: base64.split(',')[1] || base64
      });
    } catch (err) {
      addLogMessage('system', `❌ 读取文件失败: ${file.name}`);
    }
  }

  event.target.value = '';
  renderAttachmentPreviews();
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderAttachmentPreviews() {
  const container = document.getElementById('attachment-preview');
  if (!container) return;
  if (pendingAttachments.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = pendingAttachments.map((att, index) => {
    const sizeStr = att.size > 1024 * 1024
      ? (att.size / (1024 * 1024)).toFixed(1) + ' MB'
      : (att.size / 1024).toFixed(1) + ' KB';
    return `
      <div class="attachment-preview-item">
        <span class="name">${escapeHtml(att.name)}</span>
        <span class="size">${sizeStr}</span>
        <button class="delete-attachment" data-index="${index}" title="移除附件">×</button>
      </div>
    `;
  }).join('');
}

function removeAttachment(index) {
  pendingAttachments.splice(index, 1);
  renderAttachmentPreviews();
}

function clearAttachments() {
  pendingAttachments = [];
  renderAttachmentPreviews();
}

// Attachment preview click delegation
document.getElementById('attachment-preview')?.addEventListener('click', (event) => {
  const deleteBtn = event.target.closest('.delete-attachment');
  if (deleteBtn) {
    removeAttachment(parseInt(deleteBtn.dataset.index, 10));
  }
});

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
  const message = {
    type: 'sidepanel_chat',
    prompt: text,
    conversationId: activeConversationId,
    modeProfile: selectedModeProfile
  };

  if (pendingAttachments.length > 0) {
    message.attachments = pendingAttachments;
  }

  chrome.runtime.sendMessage(message, (response) => {
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
  });

  // Clear attachments after send
  clearAttachments();
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
//  模式同步
// ══════════════════════════════════════════

async function syncModeProfileFromDeepSeek() {
  try {
    const tabId = await getDeepSeekTabId();
    if (!tabId) return false;
    
    const response = await chrome.tabs.sendMessage(tabId, { action: 'readModeProfile' });
    if (response && response.success && response.data && response.data.profile) {
      const profile = response.data.profile;
      if (profile !== 'unknown' && profile !== selectedModeProfile) {
        selectedModeProfile = profile;
        document.querySelectorAll('.mode-option').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.mode === profile);
        });
        console.log('[ModeSync] Synced mode from DeepSeek:', profile);
        return true;
      }
    }
  } catch (error) {
    console.log('[ModeSync] Could not sync mode:', error.message || error);
  }
  return false;
}

// ══════════════════════════════════════════
//  Native Host 通信
// ══════════════════════════════════════════

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
        updateConnectionUI(true);
      } else if (msg.type === 'error') {
        document.getElementById('error').textContent = msg.message;
        addLogMessage('system', '⚠️ Host 错误: ' + msg.message);
        workbench?.setHostError(msg.message);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      let message = 'Native Host 断开连接';
      if (err) {
        message = 'Native Host 断开: ' + err.message;
        document.getElementById('error').textContent = message;
        document.getElementById('setup-hint').style.display = 'block';
        addLogMessage('system', '🔴 Native Host 断开连接');
      }
      workbench?.setHostConnected(false);
      workbench?.setHostError(message);
      // 不重置服务状态 — 进程可能仍在运行，host 重连后会自动更新
      updateConnectionUI(false);
      port = null;
      startReconnectTimer();
    });
  } catch (err) {
    document.getElementById('error').textContent = 'Connection Error: ' + err.message;
    document.getElementById('setup-hint').style.display = 'block';
    updateConnectionUI(false);
    workbench?.setHostConnected(false);
    workbench?.setHostError('Connection Error: ' + err.message);
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
  if (!port) connectHost();
  if (port) {
    try {
      port.postMessage({ command });
    } catch (err) {
      console.error(err);
    }
  }
}

function startReconnectTimer() {
  if (reconnectInterval) return;
  reconnectInterval = setInterval(() => {
    if (port) {
      stopReconnectTimer();
      return;
    }
    connectHost();
  }, 10000);
}

function stopReconnectTimer() {
  if (reconnectInterval) {
    clearInterval(reconnectInterval);
    reconnectInterval = null;
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
    workbench?.setStatus({
      queueAlive: msg.queueAlive,
      queuePort: msg.queueServerPort,
      webAlive: msg.webAlive,
      nativeHostAvailable: msg.nativeHostAvailable
    });
  }
  else if (msg.type === 'service_bootstrap_status') {
    applyBootstrapStatus(msg.status);
  }
});

// ══════════════════════════════════════════
//  初始化
// ══════════════════════════════════════════

workbench = serviceWorkbench.createServiceWorkbench({
  root: 'service-workbench',
  onCommand: (command) => {
    sendCommand(command);
    if (command === 'start_queue') {
      addLogMessage('system', '▶ 启动 Queue Server...');
    } else if (command === 'stop_queue') {
      addLogMessage('system', '■ 停止 Queue Server...');
    } else if (command === 'start_web') {
      addLogMessage('system', '▶ 启动 Web Console...');
    } else if (command === 'stop_web') {
      addLogMessage('system', '■ 停止 Web Console...');
    }
  },
  onOpenWeb: () => {
    chrome.tabs.create({ url: 'http://localhost:5173' });
    addLogMessage('system', '🌐 打开 Web Console');
  },
  onOpenDeepSeek: () => {
    chrome.tabs.create({ url: 'https://chat.deepseek.com' });
    addLogMessage('system', '💬 打开 DeepSeek 聊天页');
  },
  onRefresh: () => {
    sendCommand('status');
    refreshBootstrapStatus(true);
    addLogMessage('system', '🔄 刷新服务诊断');
  }
});
workbench.load().catch((error) => {
  console.warn('[SidePanel] Failed to load service workbench:', error.message || error);
});
connectHost();
refreshBootstrapStatus(true);
fetchPendingConfirms();
syncModeProfileFromDeepSeek().then(() => {
  fetchExtensionConversations().then(() => {
    if (activeConversationId) {
      loadConversationMessages(activeConversationId);
    }
  });
});

if (port) {
  sendCommand('status');
}

// 侧边栏常驻：每 3 秒轮询状态（仅通过 native messaging 获取）
statusInterval = setInterval(() => {
  if (port) {
    sendCommand('status');
  }
}, 3000);

// 模式同步：定期从 DeepSeek 页面同步当前模式状态
setInterval(() => {
  syncModeProfileFromDeepSeek();
}, 5000);

confirmPollInterval = setInterval(() => {
  fetchPendingConfirms();
}, 5000);

// 侧边栏关闭时清理
window.addEventListener('unload', () => {
  workbench?.destroy();
  if (statusInterval) clearInterval(statusInterval);
  if (confirmPollInterval) clearInterval(confirmPollInterval);
  stopReconnectTimer();
});
