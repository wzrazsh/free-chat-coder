// /workspace/chromevideo/background.js
const HOST_NAME = "com.trae.freechatcoder.host";

// ── Side Panel：点击扩展图标时打开侧边栏 ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[SW] Failed to set sidePanel behavior:', err));

// 导入自动进化监控模块
try {
  importScripts('auto-evolve-monitor.js');
  importScripts('utils/queue-config.js');
  console.log('[SW] Auto-evolve monitor loaded');
} catch (error) {
  console.error('[SW] Failed to load auto-evolve monitor:', error);
}

// 维护当前任务 ID
let currentBackgroundTaskId = null;
const MANAGED_CONVERSATION_STATE_KEY = 'managedConversationState';

function createRequestId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getQueueServerTarget(force = false) {
  return queueConfig.discoverQueueServer({ force });
}

async function fetchJson(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response.status === 204 ? null : response.json();
}

async function fetchQueueJson(path, options = {}) {
  const buildUrl = (target) => `${target.httpUrl}${path}`;
  let target = await getQueueServerTarget();

  try {
    return await fetchJson(buildUrl(target), options);
  } catch (error) {
    if (error instanceof TypeError) {
      queueConfig.clearQueueServerCache();
      target = await getQueueServerTarget(true);
      return fetchJson(buildUrl(target), options);
    }

    throw error;
  }
}

async function getManagedConversationState() {
  const data = await chrome.storage.local.get([MANAGED_CONVERSATION_STATE_KEY]);
  return data[MANAGED_CONVERSATION_STATE_KEY] || { activeConversationId: null };
}

async function setManagedConversationState(nextState) {
  await chrome.storage.local.set({
    [MANAGED_CONVERSATION_STATE_KEY]: nextState
  });
}

async function ensureDeepSeekTab(preferredTabId = null) {
  if (preferredTabId) {
    try {
      await chrome.tabs.sendMessage(preferredTabId, { action: 'ping' });
      return preferredTabId;
    } catch (error) {
      console.log('[SW] Preferred DeepSeek tab unavailable, falling back to query');
    }
  }

  const tabs = await chrome.tabs.query({ url: 'https://chat.deepseek.com/*' });
  if (tabs.length > 0) {
    const targetTabId = tabs[0].id;
    await chrome.tabs.update(targetTabId, { active: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return targetTabId;
  }

  const newTab = await chrome.tabs.create({ url: 'https://chat.deepseek.com/', active: true });
  const targetTabId = newTab.id;
  await new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === targetTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 3000);
      }
    });
  });

  return targetTabId;
}

async function sendActionToTab(tabId, action, params = {}) {
  return chrome.tabs.sendMessage(tabId, {
    action,
    params,
    ...(typeof params.prompt === 'string' ? { prompt: params.prompt } : {})
  });
}

async function createConversationRecord(payload) {
  const response = await fetchQueueJson('/conversations', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return response.conversation;
}

async function getConversationRecord(conversationId) {
  const response = await fetchQueueJson(`/conversations/${conversationId}`);
  return response.conversation;
}

async function syncConversationWithServer(conversationId, tabId, metadata = {}) {
  const [chatContent, pageState, modelState, sessionList, modeProfile] = await Promise.all([
    sendActionToTab(tabId, 'readChatContent', {
      includeUserMessages: true,
      includeAiMessages: true,
      startIndex: 0,
      count: -1
    }),
    sendActionToTab(tabId, 'readPageState', {}),
    sendActionToTab(tabId, 'readModelState', {}),
    sendActionToTab(tabId, 'readSessionList', { includeDates: true }),
    sendActionToTab(tabId, 'readModeProfile', {})
  ]);

  if (!chatContent || chatContent.success === false) {
    throw new Error(chatContent?.error || 'Failed to read chat content');
  }

  const syncPayload = {
    deepseekSessionId: pageState?.data?.currentSessionId || chatContent?.data?.sessionId || chatContent?.sessionId || null,
    title: chatContent?.data?.sessionTitle || chatContent?.sessionTitle || 'DeepSeek 会话',
    modeProfile: modeProfile?.data?.profile || 'expert',
    pageState: pageState?.data || null,
    modelState: modelState?.data || null,
    sessionList: sessionList?.data?.sessions || [],
    messages: chatContent?.data?.messages || chatContent?.messages || [],
    metadata
  };

  return fetchQueueJson(`/conversations/${conversationId}/sync`, {
    method: 'POST',
    body: JSON.stringify(syncPayload)
  });
}

async function createManagedConversation(tabId) {
  const createSessionResult = await sendActionToTab(tabId, 'createSession', {});
  if (!createSessionResult || createSessionResult.success === false) {
    throw new Error(createSessionResult?.error || 'Failed to create DeepSeek session');
  }

  await sendActionToTab(tabId, 'setModeProfile', { profile: 'expert' });

  const conversation = await createConversationRecord({
    deepseekSessionId: createSessionResult?.data?.sessionId || null,
    origin: 'extension',
    modeProfile: 'expert',
    title: createSessionResult?.data?.title || '扩展会话',
    metadata: {
      createdBy: 'sidepanel',
      initialHref: createSessionResult?.data?.href || null
    }
  });

  await setManagedConversationState({ activeConversationId: conversation.id });
  return conversation;
}

async function ensureManagedConversation(tabId, requestedConversationId = null) {
  let conversation = null;
  const managedState = await getManagedConversationState();
  const conversationId = requestedConversationId || managedState.activeConversationId;

  if (conversationId) {
    try {
      conversation = await getConversationRecord(conversationId);
      if (conversation?.deepseekSessionId) {
        await sendActionToTab(tabId, 'switchSession', { sessionId: conversation.deepseekSessionId });
      }
    } catch (error) {
      console.warn('[SW] Failed to restore managed conversation:', error.message);
    }
  }

  if (!conversation) {
    conversation = await createManagedConversation(tabId);
  }

  await setManagedConversationState({ activeConversationId: conversation.id });
  return conversation;
}

async function activateConversation(conversationId) {
  const tabId = await ensureDeepSeekTab();
  const conversation = await getConversationRecord(conversationId);
  if (!conversation) {
    throw new Error(`ConversationNotFound: ${conversationId}`);
  }

  if (conversation.deepseekSessionId) {
    const switchResult = await sendActionToTab(tabId, 'switchSession', { sessionId: conversation.deepseekSessionId });
    if (!switchResult || switchResult.success === false) {
      throw new Error(switchResult?.error || 'Failed to switch DeepSeek session');
    }
  }

  const syncResult = await syncConversationWithServer(conversationId, tabId, {
    activatedBy: 'sidepanel'
  });
  await setManagedConversationState({ activeConversationId: conversationId });
  return syncResult;
}

async function executeBrowserActionRequest(message) {
  const requestId = message.requestId || createRequestId('browser');

  try {
    const tabId = await ensureDeepSeekTab();
    const result = await sendActionToTab(tabId, message.action, message.params || {});

    chrome.runtime.sendMessage({
      type: 'browser_action_result_local',
      requestId,
      taskId: message.taskId,
      conversationId: message.conversationId || null,
      success: result?.success !== false,
      result
    }).catch(() => {});
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'browser_action_result_local',
      requestId,
      taskId: message.taskId,
      conversationId: message.conversationId || null,
      success: false,
      error: error.message || String(error)
    }).catch(() => {});
  }
}

// ==================== 主动进化控制器 ====================
class AutoEvolveController {
  constructor() {
    this.active = false;
    this.sessionId = null;
    this.direction = '';
    this.deepseekTabId = null;
    this.pollInterval = null;
    this.lastCheckedMessageCount = 0;
    this.POLL_INTERVAL_MS = 10000; // 每10秒检查一次
  }

  /**
   * 启动主动进化
   */
  async start(sessionId, direction, deepseekTabId) {
    if (this.active) {
      console.log('[AEC] Already active');
      return { success: false, message: 'Already active' };
    }

    this.active = true;
    this.sessionId = sessionId;
    this.direction = direction;
    this.deepseekTabId = deepseekTabId;

    console.log('[AEC] Starting proactive evolution:', { sessionId, direction });

    // 发送初始提示到 DeepSeek
    await this.sendInitialPrompt();

    // 开始轮询
    this.startPolling();

    return { success: true };
  }

  /**
   * 发送初始提示到 DeepSeek
   */
  async sendInitialPrompt() {
    const prompt = `你是 SOLO Coder 的 AI 进化助手。

目标：${this.direction}

工作模式：
1. 持续分析扩展代码和服务代码
2. 识别可优化的地方（性能、架构、用户体验）
3. 生成具体的代码修改建议
4. 当检测到进化指令时，我会创建一个进化任务

请先分析当前的代码库，给出第一个优化建议。`;

    try {
      await chrome.tabs.sendMessage(this.deepseekTabId, {
        action: 'submitPrompt',
        prompt: prompt
      });
      console.log('[AEC] Initial prompt sent');
    } catch (err) {
      console.error('[AEC] Failed to send initial prompt:', err);
    }
  }

  /**
   * 开始轮询 DeepSeek 对话
   */
  startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(async () => {
      if (!this.active) return;

      try {
        // 获取 DeepSeek 标签页的最新消息
        const messages = await this.getDeepseekMessages();

        // 分析是否有新的进化指令
        const evolutionCommand = this.extractEvolutionCommand(messages);

        if (evolutionCommand) {
          console.log('[AEC] Found evolution command:', evolutionCommand);
          await this.triggerEvolution(evolutionCommand);
        }

        // 更新进度
        this.updateProgress(messages.length);

      } catch (err) {
        console.error('[AEC] Polling error:', err);
      }
    }, this.POLL_INTERVAL_MS);

    console.log('[AEC] Polling started');
  }

  /**
   * 停止轮询
   */
  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[AEC] Polling stopped');
  }

  /**
   * 从 DeepSeek 对话中提取进化指令
   */
  extractEvolutionCommand(messages) {
    // 查找包含进化指令的消息
    for (const msg of messages) {
      const content = msg.content || '';

      // 检测进化指令模式
      if (content.includes('[EVOLVE]') ||
          content.includes('进化指令') ||
          content.includes('evolve:') ||
          content.includes('优化代码：') ||
          content.includes('修改建议：')) {

        // 提取指令内容
        const commandMatch = content.match(/\[EVOLVE\]([\s\S]*?)(?=\n\n|$)/i) ||
                           content.match(/进化指令[：:]\s*([\s\S]*?)(?=\n\n|$)/i) ||
                           content.match(/evolve:[ \t]*([\s\S]*?)(?=\n\n|$)/i);

        if (commandMatch) {
          return commandMatch[1].trim();
        }

        // 如果直接包含代码修改建议，提取整个消息
        if (content.includes('```') || content.includes('文件：') || content.includes('修改：')) {
          return content;
        }
      }
    }

    return null;
  }

  /**
   * 获取 DeepSeek 对话消息
   */
  async getDeepseekMessages() {
    try {
      const response = await chrome.tabs.sendMessage(this.deepseekTabId, {
        action: 'getConversation'
      });

      if (response && response.messages) {
        return response.messages;
      }
    } catch (err) {
      console.log('[AEC] Could not get messages (page may not be ready)');
    }
    return [];
  }

  /**
   * 触发进化执行
   */
  async triggerEvolution(command) {
    console.log('[AEC] Triggering evolution with command:', command.substring(0, 100));

    // 构造进化任务
    const task = {
      prompt: `[主动进化] ${command}\n\n会话: ${this.sessionId}\n方向: ${this.direction}`,
      options: {
        autoEvolve: true,
        evolutionSource: 'proactive',
        sessionId: this.sessionId,
        direction: this.direction
      }
    };

    // 发送到 queue-server
    try {
      await fetchQueueJson('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task)
      });

      console.log('[AEC] Evolution task created');
      this.updateProgress(this.lastCheckedMessageCount + 1, '任务已创建');
    } catch (err) {
      console.error('[AEC] Failed to create task:', err);
    }
  }

  /**
   * 更新进度
   */
  updateProgress(messageCount, status) {
    this.lastCheckedMessageCount = messageCount;

    const progress = status ? 50 : Math.min(messageCount * 10, 90);

    // 通过消息通知 popup
    chrome.runtime.sendMessage({ type: 'evolve_progress', progress }).catch(() => {
      // Popup 可能未打开，忽略错误
    });

    // 保存进度
    chrome.storage.local.set({
      autoEvolveState: {
        active: this.active,
        sessionId: this.sessionId,
        direction: this.direction,
        deepseekTabId: this.deepseekTabId,
        progress: progress
      }
    });
  }

  /**
   * 停止主动进化
   */
  stop() {
    this.stopPolling();
    this.active = false;
    this.sessionId = null;
    console.log('[AEC] Stopped');
  }

  /**
   * 恢复进化会话
   */
  async resume(sessionId, direction, deepseekTabId) {
    // 检查 DeepSeek 标签页是否还在
    try {
      await chrome.tabs.sendMessage(deepseekTabId, { action: 'ping' });
    } catch (err) {
      console.log('[AEC] DeepSeek tab no longer available');
      return { success: false, message: 'Tab closed' };
    }

    return await this.start(sessionId, direction, deepseekTabId);
  }
}

// 创建全局控制器实例
const autoEvolveController = new AutoEvolveController();

// ==================== 心跳检测系统 ====================
const HEARTBEAT_ALARM_NAME = 'solo-coder-service-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 0.5; // 30 秒
const WEB_CONSOLE_PORT = 5173;
const SERVICE_BOOTSTRAP_STATUS_KEY = 'serviceBootstrapStatus';
const BACKGROUND_RUNTIME_REENTRY_MS = 15000;
let lastHeartbeatStatus = { queue: false, queuePort: null, web: false };
let lastServiceBootstrapStatus = null;
let serviceBootstrapPromise = null;
let lastBackgroundRuntimeAt = 0;
let backgroundRuntimePromise = null;

/**
 * 发布最新服务状态，供 popup / sidepanel 立即刷新。
 */
function publishHeartbeatStatus(queueAlive, queueServerPort, webAlive, force = false) {
  const statusChanged =
    force ||
    lastHeartbeatStatus.queue !== queueAlive ||
    lastHeartbeatStatus.web !== webAlive ||
    lastHeartbeatStatus.queuePort !== queueServerPort;

  if (!statusChanged) {
    return;
  }

  console.log('[Heartbeat] Status changed - queue:', queueAlive, 'port:', queueServerPort, 'web:', webAlive);
  lastHeartbeatStatus = { queue: queueAlive, queuePort: queueServerPort, web: webAlive };

  chrome.runtime.sendMessage({
    type: 'heartbeat_status',
    queueAlive,
    queueServerPort,
    webAlive
  }).catch(() => {});
}

async function setServiceBootstrapStatus(status) {
  lastServiceBootstrapStatus = status;
  await chrome.storage.local.set({
    [SERVICE_BOOTSTRAP_STATUS_KEY]: status
  });

  chrome.runtime.sendMessage({
    type: 'service_bootstrap_status',
    status
  }).catch(() => {});
}

async function getServiceBootstrapStatus() {
  if (lastServiceBootstrapStatus) {
    return lastServiceBootstrapStatus;
  }

  const data = await chrome.storage.local.get([SERVICE_BOOTSTRAP_STATUS_KEY]);
  lastServiceBootstrapStatus = data[SERVICE_BOOTSTRAP_STATUS_KEY] || null;
  return lastServiceBootstrapStatus;
}

/**
 * 通过长连接触发 Native Host，保证浏览器启动场景下后台有足够时间完成启动命令。
 */
async function sendNativeHostCommand(command, timeoutMs = 7000) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    let nativePort = null;
    let lastMessage = null;

    const finish = (result) => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (nativePort) {
        try {
          nativePort.disconnect();
        } catch (error) {
          // Ignore disconnect races.
        }
      }

      resolve(result);
    };

    try {
      nativePort = chrome.runtime.connectNative(HOST_NAME);
    } catch (error) {
      console.log('[Heartbeat] Failed to connect to native host:', error.message || error);
      resolve({
        ok: false,
        error: error.message || String(error)
      });
      return;
    }

    timeoutId = setTimeout(() => {
      finish({
        ok: false,
        error: `Timeout waiting for native host response to ${command}`
      });
    }, timeoutMs);

    nativePort.onMessage.addListener((message) => {
      lastMessage = message;

      if (message?.type === 'error') {
        finish({
          ok: false,
          error: message.message || `Native host returned an error for ${command}`,
          response: message
        });
        return;
      }

      if (message?.type === 'status') {
        finish({
          ok: true,
          response: message
        });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const runtimeError = chrome.runtime.lastError;

      if (runtimeError) {
        finish({
          ok: false,
          error: runtimeError.message,
          response: lastMessage
        });
        return;
      }

      if (lastMessage) {
        finish({
          ok: true,
          response: lastMessage
        });
        return;
      }

      finish({
        ok: false,
        error: `Native host disconnected before responding to ${command}`
      });
    });

    try {
      nativePort.postMessage({ command });
    } catch (error) {
      console.log('[Heartbeat] Failed to send native host command:', error.message || error);
      finish({
        ok: false,
        error: error.message || String(error)
      });
    }
  });
}

/**
 * 检测端口是否在监听 (使用 fetch)
 */
async function checkPort(port) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
      method: 'HEAD'
    });
    clearTimeout(timeoutId);
    return response.ok || response.status < 500;
  } catch (err) {
    return false;
  }
}

async function checkQueueServer() {
  try {
    const target = await getQueueServerTarget(true);
    return {
      alive: true,
      port: target.port
    };
  } catch (error) {
    queueConfig.clearQueueServerCache();
    return {
      alive: false,
      port: null
    };
  }
}

function getBootstrapCommandLabel(command) {
  if (command === 'start_queue') {
    return 'Queue Server';
  }

  if (command === 'start_web') {
    return 'Web Console';
  }

  return command;
}

/**
 * 确保定时心跳通过 alarms API 重新唤醒 MV3 service worker。
 */
async function ensureHeartbeatAlarm() {
  const existingAlarm = await chrome.alarms.get(HEARTBEAT_ALARM_NAME);
  if (existingAlarm) {
    return;
  }

  await chrome.alarms.create(HEARTBEAT_ALARM_NAME, {
    delayInMinutes: HEARTBEAT_PERIOD_MINUTES,
    periodInMinutes: HEARTBEAT_PERIOD_MINUTES
  });

  console.log('[Heartbeat] Alarm scheduled');
}

/**
 * 浏览器启动后立即尝试自愈本地服务，并把结果保存到 storage 里供 UI 诊断。
 */
async function ensureLocalServices(reason = 'heartbeat') {
  if (serviceBootstrapPromise) {
    return serviceBootstrapPromise;
  }

  serviceBootstrapPromise = (async () => {
    console.log('[Heartbeat] Checking services for reason:', reason);

    const attemptedCommands = [];
    const commandResults = [];

    try {
      const [queueStatusBefore, webAliveBefore] = await Promise.all([
        checkQueueServer(),
        checkPort(WEB_CONSOLE_PORT)
      ]);

      let queueAlive = queueStatusBefore.alive;
      let queueServerPort = queueStatusBefore.port;
      let webAlive = webAliveBefore;

      publishHeartbeatStatus(queueAlive, queueServerPort, webAlive);

      if (!queueAlive) {
        attemptedCommands.push('start_queue');
        console.log('[Heartbeat] Queue Server not responding, attempting start...');
        const result = await sendNativeHostCommand('start_queue');
        commandResults.push({
          command: 'start_queue',
          ok: result.ok,
          error: result.error || null
        });
      }

      if (!webAlive) {
        attemptedCommands.push('start_web');
        console.log('[Heartbeat] Web Console not responding, attempting start...');
        const result = await sendNativeHostCommand('start_web');
        commandResults.push({
          command: 'start_web',
          ok: result.ok,
          error: result.error || null
        });
      }

      const [queueStatusAfter, webAliveAfter] = await Promise.all([
        checkQueueServer(),
        checkPort(WEB_CONSOLE_PORT)
      ]);

      queueAlive = queueStatusAfter.alive;
      queueServerPort = queueStatusAfter.port;
      webAlive = webAliveAfter;

      publishHeartbeatStatus(queueAlive, queueServerPort, webAlive);

      const startedServices = [];
      if (!queueStatusBefore.alive && queueAlive) {
        startedServices.push('Queue Server');
      }
      if (!webAliveBefore && webAlive) {
        startedServices.push('Web Console');
      }

      const failedServices = [];
      if (!queueAlive) {
        failedServices.push('Queue Server');
      }
      if (!webAlive) {
        failedServices.push('Web Console');
      }

      const failedCommands = commandResults.filter((item) => !item.ok);

      let state = 'ok';
      let message = startedServices.length > 0
        ? `Auto-start recovered ${startedServices.join(' and ')}.`
        : 'Queue Server and Web Console are running.';

      if (failedServices.length > 0) {
        state = failedCommands.length > 0 ? 'error' : 'warning';
        message = failedCommands.length > 0
          ? failedCommands.map((item) => `${getBootstrapCommandLabel(item.command)}: ${item.error || 'unknown error'}`).join(' | ')
          : `${failedServices.join(' and ')} still not responding after the auto-start check.`;
      }

      const status = {
        state,
        reason,
        message,
        queueAlive,
        queueServerPort,
        webAlive,
        attemptedCommands,
        commandResults,
        checkedAt: new Date().toISOString()
      };

      await setServiceBootstrapStatus(status);
      return status;
    } catch (error) {
      console.error('[Heartbeat] Check error:', error);

      const status = {
        state: 'error',
        reason,
        message: error.message || String(error),
        queueAlive: false,
        queueServerPort: null,
        webAlive: false,
        attemptedCommands,
        commandResults,
        checkedAt: new Date().toISOString()
      };

      await setServiceBootstrapStatus(status);
      return status;
    } finally {
      serviceBootstrapPromise = null;
    }
  })();

  return serviceBootstrapPromise;
}

// Ensure Offscreen document exists
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING'],
        justification: 'Maintain WebSocket connection to local server'
      });
      console.log('Offscreen document created successfully.');
    } catch (err) {
      console.error('Failed to create offscreen document:', err);
    }
  }
}

async function initializeBackgroundRuntime(reason) {
  console.log('[SW] Initializing background runtime:', reason);
  await ensureOffscreen();
  await ensureHeartbeatAlarm();
  await ensureLocalServices(reason);
}

function scheduleBackgroundRuntimeInitialization(reason, options = {}) {
  const force = options.force === true;
  const now = Date.now();

  if (backgroundRuntimePromise) {
    return backgroundRuntimePromise;
  }

  if (!force && now - lastBackgroundRuntimeAt < BACKGROUND_RUNTIME_REENTRY_MS) {
    console.log('[SW] Skipping background runtime init due to cooldown:', reason);
    return Promise.resolve(null);
  }

  backgroundRuntimePromise = initializeBackgroundRuntime(reason)
    .catch((error) => {
      console.error('[SW] Background runtime init failed:', reason, error);
      return null;
    })
    .finally(() => {
      lastBackgroundRuntimeAt = Date.now();
      backgroundRuntimePromise = null;
    });

  return backgroundRuntimePromise;
}

chrome.runtime.onStartup.addListener(() => {
  void scheduleBackgroundRuntimeInitialization('startup', { force: true });
});

chrome.runtime.onInstalled.addListener((details) => {
  void scheduleBackgroundRuntimeInitialization(`installed:${details?.reason || 'unknown'}`, { force: true });
});

// Some Chromium startup paths do not eagerly wake the MV3 worker until a browser
// window or tab event arrives, so keep a lightweight bootstrap trigger here too.
chrome.windows.onCreated.addListener((window) => {
  if (window.type && window.type !== 'normal') {
    return;
  }

  void scheduleBackgroundRuntimeInitialization('window-created');
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab) {
    return;
  }

  if (typeof tab.url === 'string' && tab.url.startsWith('chrome-extension://')) {
    return;
  }

  void scheduleBackgroundRuntimeInitialization('tab-created');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM_NAME) {
    return;
  }

  void scheduleBackgroundRuntimeInitialization(`alarm:${alarm.name}`, { force: true });
});

void ensureHeartbeatAlarm().catch((error) => {
  console.error('[Heartbeat] Failed to schedule alarm:', error);
});

// Receive messages from Offscreen or Content Scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg._relaySource === 'background') {
    return false;
  }

  if (msg.type === 'task_assigned') {
    console.log('[SW] Task assigned:', msg.task);
    executeDeepSeekTask(msg.task);
    sendResponse({ received: true });
  } else if (msg.type === 'reload_extension') {
    console.log('[SW] Reloading extension by server request...');
    chrome.runtime.reload();
  } else if (msg.type === 'auto_evolve') {
    console.log('[SW] Auto-evolve request received:', msg.errorType);
    forwardAutoEvolveRequest(msg);
    sendResponse({ received: true });
  } else if (msg.type === 'content_script_error') {
    console.log('[SW] Content script error received:', msg.errorType);
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordError) {
      autoEvolveMonitor.recordError(msg.errorType, msg.details);
    }
    sendResponse({ received: true });
  } else if (msg.type === 'confirm_request' || msg.type === 'confirm_resolved') {
    chrome.runtime.sendMessage({
      ...msg,
      _relaySource: 'background'
    }).catch(() => {});
    sendResponse({ received: true });
  } else if (msg.type === 'execute_action' || msg.type === 'browser_action') {
    executeBrowserActionRequest(msg);
    sendResponse({ received: true, requestId: msg.requestId || null });
  }
  // 主动进化控制消息
  else if (msg.type === 'start_auto_evolve') {
    autoEvolveController.start(msg.sessionId, msg.direction, msg.deepseekTabId)
      .then((result) => sendResponse(result));
    return true; // 异步响应
  }
  else if (msg.type === 'stop_auto_evolve') {
    autoEvolveController.stop();
    sendResponse({ success: true });
  }
  else if (msg.type === 'resume_auto_evolve') {
    autoEvolveController.resume(msg.sessionId, msg.direction, msg.deepseekTabId)
      .then((result) => sendResponse(result));
    return true; // 异步响应
  }
  else if (msg.type === 'start_extension_conversation') {
    ensureDeepSeekTab()
      .then(async (tabId) => {
        const conversation = await createManagedConversation(tabId);
        const syncResult = await syncConversationWithServer(conversation.id, tabId, {
          createdBy: 'sidepanel_button'
        });
        return syncResult.conversation;
      })
      .then((conversation) => sendResponse({ success: true, conversation }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  else if (msg.type === 'activate_conversation') {
    activateConversation(msg.conversationId)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  // ── Side Panel 聊天消息 ──
  else if (msg.type === 'sidepanel_chat') {
    const requestId = createRequestId('chat');
    processSidepanelChat({
      requestId,
      prompt: msg.prompt,
      conversationId: msg.conversationId || null
    });
    sendResponse({ accepted: true, requestId, conversationId: msg.conversationId || null });
    return false;
  }
  else if (msg.type === 'get_service_bootstrap_status') {
    getServiceBootstrapStatus()
      .then((status) => sendResponse({ status }))
      .catch((error) => sendResponse({
        status: null,
        error: error.message || String(error)
      }));
    return true;
  }
  else if (msg.type === 'refresh_service_bootstrap_status') {
    ensureLocalServices('manual-refresh')
      .then((status) => sendResponse({ status }))
      .catch((error) => sendResponse({
        status: null,
        error: error.message || String(error)
      }));
    return true;
  }
  // 状态查询接口
  else if (msg.type === 'get_extension_status') {
    Promise.all([
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'get_extension_status' }, (offscreenStatus) => {
          resolve(offscreenStatus || null);
        });
      }),
      getServiceBootstrapStatus()
    ]).then(([offscreenStatus, bootstrapStatus]) => {
      const status = {
        background: {
          currentTaskId: currentBackgroundTaskId,
          isTaskRunning: !!currentBackgroundTaskId,
          offscreenReady: !!offscreenStatus,
          serviceBootstrap: bootstrapStatus,
          autoEvolve: {
            active: autoEvolveController.active,
            sessionId: autoEvolveController.sessionId
          }
        },
        offscreen: offscreenStatus || { error: 'Offscreen not responding' }
      };
      sendResponse(status);
    }).catch((error) => {
      sendResponse({
        background: {
          currentTaskId: currentBackgroundTaskId,
          isTaskRunning: !!currentBackgroundTaskId,
          offscreenReady: false,
          serviceBootstrap: null,
          autoEvolve: {
            active: autoEvolveController.active,
            sessionId: autoEvolveController.sessionId
          }
        },
        offscreen: { error: error.message || String(error) }
      });
    });
    return true; // 异步响应
  }
  else if (msg.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }
  return false;
});

// Function to handle the actual task
async function executeDeepSeekTask(task) {
  const taskStartTime = Date.now();
  currentBackgroundTaskId = task.id; // 记录当前任务 ID

  // 辅助函数：清除任务 ID 并上报更新
  const finishTask = (status, result, error) => {
    currentBackgroundTaskId = null;
    chrome.runtime.sendMessage({
      type: 'task_update',
      taskId: task.id,
      status: status,
      result: result,
      error: error
    });
  };

  try {
    // 记录任务开始（性能监控）
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.monitorTaskPerformance) {
      autoEvolveMonitor.monitorTaskPerformance(task.id, taskStartTime);
    }

    // 1. Check if DeepSeek tab is open
    const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
    let targetTabId;

    if (tabs.length === 0) {
      const newTab = await chrome.tabs.create({ url: "https://chat.deepseek.com/", active: true });
      targetTabId = newTab.id;
      
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === targetTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 3000);
          }
        });
      });
    } else {
      targetTabId = tabs[0].id;
      await chrome.tabs.update(targetTabId, { active: true });
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 2. Send task to content script
    chrome.tabs.sendMessage(targetTabId, {
      action: 'submitPrompt',
      prompt: task.prompt
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[SW] Content script error:', chrome.runtime.lastError);
        if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordContentScriptError) {
          autoEvolveMonitor.recordContentScriptError(chrome.runtime.lastError.message, {
            taskId: task.id,
            tabId: targetTabId,
            prompt: task.prompt?.substring(0, 100)
          });
        }
        finishTask('failed', null, chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('[SW] Task completed successfully:', task.id);
        finishTask('completed', response.reply, null);
      } else {
        console.error('[SW] Task failed in content script:', response);
        if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordTaskExecutionError) {
          autoEvolveMonitor.recordTaskExecutionError(task.id, response?.error || 'Unknown error', {
            prompt: task.prompt?.substring(0, 100),
            duration: Date.now() - taskStartTime,
            response: response
          });
        }
        finishTask('failed', null, response ? response.error : 'Unknown error');
      }
    });
  } catch (err) {
    console.error('[SW] Error executing task:', err);
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordTaskExecutionError) {
      autoEvolveMonitor.recordTaskExecutionError(task.id, err.toString(), {
        prompt: task.prompt?.substring(0, 100),
        duration: Date.now() - taskStartTime
      });
    }
    finishTask('failed', null, err.toString());
  }
}

/**
 * 转发自动进化请求到offscreen文档
 */
async function forwardAutoEvolveRequest(evolutionRequest) {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage(evolutionRequest)
      .then(() => console.log('[SW] Auto-evolve request forwarded to offscreen'))
      .catch(error => console.error('[SW] Failed to forward auto-evolve request:', error));
  } catch (error) {
    console.error('[SW] Error in forwardAutoEvolveRequest:', error);
  }
}

// ═══════════════════════════════════════════════════
//  Side Panel 聊天消息处理
// ═══════════════════════════════════════════════════

async function processSidepanelChat({ requestId, prompt, conversationId }) {
  try {
    const targetTabId = await ensureDeepSeekTab();
    const conversation = await ensureManagedConversation(targetTabId, conversationId);

    await sendActionToTab(targetTabId, 'setModeProfile', { profile: 'expert' });

    const response = await sendActionToTab(targetTabId, 'submitPrompt', {
      prompt,
      waitForReply: true,
      typingSpeed: 'human'
    });

    if (!response || response.success === false) {
      throw new Error(response?.error || 'Failed to submit prompt');
    }

    const syncResult = await syncConversationWithServer(conversation.id, targetTabId, {
      requestId,
      source: 'sidepanel_chat',
      submittedPrompt: prompt
    });

    await setManagedConversationState({ activeConversationId: conversation.id });
    chrome.runtime.sendMessage({
      type: 'chat_reply',
      requestId,
      conversationId: conversation.id,
      reply: response.reply,
      conversation: syncResult.conversation
    }).catch(() => {});
  } catch (error) {
    console.error('[SW] Sidepanel chat exception:', error);
    chrome.runtime.sendMessage({
      type: 'chat_reply',
      requestId,
      conversationId: conversationId || null,
      error: error.message || String(error)
    }).catch(() => {});
  }
}
