// /workspace/chromevideo/background.js
const HOST_NAME = "com.trae.freechatcoder.host";

// ── Side Panel：点击扩展图标时打开侧边栏 ──
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[SW] Failed to set sidePanel behavior:', err));

// ── 自动打开侧边栏 ──
// 预先为 DeepSeek 页面设置侧边栏可用状态
function setupAutoOpenSidePanel() {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'complete' && tab.url && tab.url.includes('chat.deepseek.com')) {
      chrome.sidePanel.setOptions({
        tabId: tabId,
        path: 'sidepanel.html',
        enabled: true
      }).catch((err) => {
        console.error('[SW] Failed to set side panel options:', err);
      });
    }
  });
}

// 等待 Service Worker 就绪后设置监听器
chrome.runtime.onStartup.addListener(() => {
  console.log('[SW] Browser started, setting up auto-open side panel');
  setupAutoOpenSidePanel();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[SW] Extension installed/updated, setting up auto-open side panel');
  setupAutoOpenSidePanel();
});

// 立即设置监听器（对于常规加载场景）
setupAutoOpenSidePanel();

// ── Keep-Alive Alarm：防止 MV3 Service Worker 休眠 ──
// MV3 SW 在闲置 30 秒后会休眠，导致 "Receiving end does not exist" 错误
const KEEP_ALIVE_ALARM_NAME = 'solo-coder-keep-alive';
const KEEP_ALIVE_INTERVAL_MINUTES = 0.4; // 24 秒 (< 30 秒休眠阈值)

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEP_ALIVE_ALARM_NAME, {
    periodInMinutes: KEEP_ALIVE_INTERVAL_MINUTES
  });
  console.log('[SW] Keep-alive alarm created');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM_NAME) {
    // 轻量级操作，保持 SW 活跃
    console.log('[SW] Keep-alive ping at', new Date().toISOString());
  }
});

// 导入基础配置模块
try {
  importScripts('utils/queue-config.js');
} catch (error) {
  console.error('[SW] Failed to load queue-config:', error);
}

// Auto-evolve monitor removed (Phase 1 prune)

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

async function createManagedConversation(tabId, modeProfile = 'expert') {
  const createSessionResult = await sendActionToTab(tabId, 'createSession', {});
  if (!createSessionResult || createSessionResult.success === false) {
    throw new Error(createSessionResult?.error || 'Failed to create DeepSeek session');
  }

  await sendActionToTab(tabId, 'setModeProfile', { profile: modeProfile });

  const conversation = await createConversationRecord({
    deepseekSessionId: createSessionResult?.data?.sessionId || null,
    origin: 'extension',
    modeProfile,
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

// Auto-evolve controller removed (Phase 1 prune)

const WEB_CONSOLE_PORT = 5173;
const SERVICE_BOOTSTRAP_STATUS_KEY = 'serviceBootstrapStatus';
const BACKGROUND_RUNTIME_REENTRY_MS = 15000;
let lastHeartbeatStatus = { queue: false, queuePort: null, web: false };
let lastServiceBootstrapStatus = null;
let serviceBootstrapPromise = null;
let lastBackgroundRuntimeAt = 0;
let nativeHostAvailable = null; // null=unchecked, true=available, false=unavailable
let backgroundRuntimePromise = null;

/**
 * 发布最新服务状态，供 popup / sidepanel 立即刷新。
 */
function publishHeartbeatStatus(queueAlive, queueServerPort, webAlive, nativeHostAvail, force = false) {
  const nhAvailable = nativeHostAvail !== undefined ? nativeHostAvail : nativeHostAvailable;
  const statusChanged =
    force ||
    lastHeartbeatStatus.queue !== queueAlive ||
    lastHeartbeatStatus.web !== webAlive ||
    lastHeartbeatStatus.queuePort !== queueServerPort ||
    lastHeartbeatStatus.nativeHostAvailable !== nhAvailable;

  if (!statusChanged) {
    return;
  }

  console.log('[Heartbeat] Status changed - queue:', queueAlive, 'port:', queueServerPort, 'web:', webAlive, 'nativeHost:', nhAvailable);
  lastHeartbeatStatus = { queue: queueAlive, queuePort: queueServerPort, web: webAlive, nativeHostAvailable: nhAvailable };

  chrome.runtime.sendMessage({
    type: 'heartbeat_status',
    queueAlive,
    queueServerPort,
    webAlive,
    nativeHostAvailable: nhAvailable
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
async function checkPort(port, strict = false) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`http://localhost:${port}`, {
      signal: controller.signal,
      method: 'HEAD'
    });
    clearTimeout(timeoutId);
    const portOpen = response.ok || response.status < 500;

    if (!portOpen || !strict) {
      return portOpen;
    }

    // Strict mode: verify Vite dev server by checking response body
    try {
      const getController = new AbortController();
      const getTimeout = setTimeout(() => getController.abort(), 2000);
      const getResponse = await fetch(`http://localhost:${port}`, {
        signal: getController.signal,
        method: 'GET'
      });
      clearTimeout(getTimeout);
      const text = await getResponse.text();
      return text.includes('vite') || text.includes('@vite/client') || text.includes('VITE');
    } catch {
      return false;
    }
  } catch (err) {
    return false;
  }
}

/**
 * 一次性探测 Native Host 是否可用，缓存结果供后续流程使用。
 */
async function checkNativeHostAvailable() {
  if (nativeHostAvailable !== null) {
    return nativeHostAvailable;
  }

  try {
    const port = chrome.runtime.connectNative(HOST_NAME);
    port.disconnect();
    nativeHostAvailable = true;
    console.log('[Heartbeat] Native Host is available');
  } catch (error) {
    nativeHostAvailable = false;
    console.log('[Heartbeat] Native Host not available:', error.message || error);
  }

  return nativeHostAvailable;
}

async function installNativeHost() {
  const extensionId = chrome.runtime.id;
  const target = await getQueueServerTarget(true);

  if (!target) {
    throw new Error('Queue Server is not running. Please start it first: cd queue-server && npm run dev');
  }

  const response = await fetchJson(`${target.httpUrl}/install-native-host`, {
    method: 'POST',
    body: JSON.stringify({ extensionId })
  });

  if (!response.success) {
    throw new Error(response.error || 'Installation script failed');
  }

  // Reset cache so next heartbeat re-evaluates native host availability
  nativeHostAvailable = null;

  return { success: true, installOutput: response.stdout || '' };
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
        if (nativeHostAvailable) {
          console.log('[Heartbeat] Queue Server not responding, attempting start via Native Host...');
          const result = await sendNativeHostCommand('start_queue');
          commandResults.push({
            command: 'start_queue',
            ok: result.ok,
            error: result.error || null
          });
        } else {
          console.log('[Heartbeat] Queue Server not responding, Native Host unavailable — skipping auto-start');
          commandResults.push({
            command: 'start_queue',
            ok: false,
            error: 'Native Host 未安装，请手动启动: cd queue-server && npm run dev'
          });
        }
      }

      if (!webAlive) {
        attemptedCommands.push('start_web');
        if (nativeHostAvailable) {
          console.log('[Heartbeat] Web Console not responding, attempting start via Native Host...');
          const result = await sendNativeHostCommand('start_web');
          commandResults.push({
            command: 'start_web',
            ok: result.ok,
            error: result.error || null
          });
        } else {
          console.log('[Heartbeat] Web Console not responding, Native Host unavailable — skipping auto-start');
          commandResults.push({
            command: 'start_web',
            ok: false,
            error: 'Native Host 未安装，请手动启动: cd web-console && npm run dev'
          });
        }
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
        if (failedCommands.length > 0) {
          const hasNativeHostError = failedCommands.some((item) => item.error && item.error.includes('Native Host 未安装'));
          state = hasNativeHostError ? 'warning' : 'error';
        } else {
          state = 'warning';
        }
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
        nativeHostAvailable,
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
        nativeHostAvailable,
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
  await checkNativeHostAvailable();
  await ensureLocalServices(reason);

  const status = lastHeartbeatStatus;
  publishHeartbeatStatus(status.queue, status.queuePort, status.web, undefined, true);
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
  } else if (msg.type === 'content_script_error') {
    console.log('[SW] Content script error received:', msg.errorType);
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
  else if (msg.type === 'start_extension_conversation') {
    ensureDeepSeekTab()
      .then(async (tabId) => {
        const modeProfile = msg.modeProfile || 'expert';
        const conversation = await createManagedConversation(tabId, modeProfile);
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
      conversationId: msg.conversationId || null,
      modeProfile: msg.modeProfile,
      attachments: msg.attachments
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
  else if (msg.type === 'check_native_host') {
    nativeHostAvailable = null; // Reset cache to force re-check
    checkNativeHostAvailable()
      .then((available) => {
        publishHeartbeatStatus(
          lastHeartbeatStatus.queue,
          lastHeartbeatStatus.queuePort,
          lastHeartbeatStatus.web,
          available,
          true
        );
        sendResponse({ available });
      })
      .catch((error) => sendResponse({ available: false, error: error.message }));
    return true;
  }
  else if (msg.type === 'install_native_host') {
    installNativeHost()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
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
          serviceBootstrap: bootstrapStatus
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
          serviceBootstrap: null
        },
        offscreen: { error: error.message || String(error) }
      });
    });
    return true; // 异步响应
  }
  else if (msg.type === 'upload_attachment') {
    ensureDeepSeekTab()
      .then(async (tabId) => {
        const result = await sendActionToTab(tabId, 'uploadAttachment', msg.attachment);
        return result;
      })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
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
  // ── 自动打开侧边栏（通过 content script 触发）──
  else if (msg.type === 'open_sidepanel') {
    if (sender && sender.tab && sender.tab.id) {
      const tabId = sender.tab.id;
      // 必须同步调用，否则会丢失 user gesture 导致 "may only be called in response to a user gesture"
      chrome.sidePanel.setOptions({
        tabId: tabId,
        path: 'sidepanel.html',
        enabled: true
      }).catch((err) => {
        console.error('[SW] Failed to set side panel options:', err);
      });
      
      chrome.sidePanel.open({ tabId: tabId }).then(() => {
        console.log('[SW] Side panel auto-opened via content script for tab:', tabId);
      }).catch((err) => {
        console.error('[SW] Failed to auto-open side panel:', err);
      });
    }
    sendResponse({ received: true });
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
        finishTask('failed', null, chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        console.log('[SW] Task completed successfully:', task.id);
        finishTask('completed', response.reply, null);
      } else {
        console.error('[SW] Task failed in content script:', response);
        finishTask('failed', null, response ? response.error : 'Unknown error');
      }
    });
  } catch (err) {
    console.error('[SW] Error executing task:', err);
    finishTask('failed', null, err.toString());
  }
}

// ═══════════════════════════════════════════════════
//  Side Panel 聊天消息处理
// ═══════════════════════════════════════════════════

async function processSidepanelChat({ requestId, prompt, conversationId, modeProfile, attachments }) {
  try {
    const targetTabId = await ensureDeepSeekTab();
    const conversation = await ensureManagedConversation(targetTabId, conversationId);

    await sendActionToTab(targetTabId, 'setModeProfile', { profile: modeProfile || 'expert' });

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        await sendActionToTab(targetTabId, 'uploadAttachment', {
          type: attachment.type || 'application/octet-stream',
          data: attachment.base64,
          filename: attachment.name,
          mimeType: attachment.type || 'application/octet-stream'
        });
      }
    }

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
