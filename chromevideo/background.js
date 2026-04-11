// /workspace/chromevideo/background.js

// 导入自动进化监控模块
try {
  importScripts('auto-evolve-monitor.js');
  console.log('[SW] Auto-evolve monitor loaded');
} catch (error) {
  console.error('[SW] Failed to load auto-evolve monitor:', error);
}

// Ensure Offscreen document exists
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['DOM_SCRAPING'], // Used to maintain WebSocket connection
        justification: 'Maintain WebSocket connection to local server'
      });
      console.log('Offscreen document created successfully.');
    } catch (err) {
      console.error('Failed to create offscreen document:', err);
    }
  }
}

// Create on startup or install
chrome.runtime.onStartup.addListener(ensureOffscreen);
chrome.runtime.onInstalled.addListener(ensureOffscreen);

// Receive messages from Offscreen or Content Scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'task_assigned') {
    console.log('[SW] Task assigned:', msg.task);
    executeDeepSeekTask(msg.task);
  } else if (msg.type === 'reload_extension') {
    console.log('[SW] Reloading extension by server request...');
    chrome.runtime.reload();
  } else if (msg.type === 'auto_evolve') {
    console.log('[SW] Auto-evolve request received:', msg.errorType);
    // 转发自动进化请求到offscreen
    forwardAutoEvolveRequest(msg);
  } else if (msg.type === 'content_script_error') {
    console.log('[SW] Content script error received:', msg.errorType);
    // 记录内容脚本错误到autoEvolveMonitor
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordError) {
      autoEvolveMonitor.recordError(msg.errorType, msg.details);
    }
    sendResponse({ received: true });
  }
});

// Function to handle the actual task
async function executeDeepSeekTask(task) {
  const taskStartTime = Date.now();

  try {
    // 记录任务开始（性能监控）
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.monitorTaskPerformance) {
      autoEvolveMonitor.monitorTaskPerformance(task.id, taskStartTime);
    }

    // 1. Check if DeepSeek tab is open
    const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
    let targetTabId;

    if (tabs.length === 0) {
      // Create new tab
      const newTab = await chrome.tabs.create({ url: "https://chat.deepseek.com/", active: true });
      targetTabId = newTab.id;
      
      // Wait for page to load
      await new Promise(resolve => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === targetTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Additional wait to let internal react mount
            setTimeout(resolve, 3000);
          }
        });
      });
    } else {
      targetTabId = tabs[0].id;
      // Make the tab active just in case
      await chrome.tabs.update(targetTabId, { active: true });
      // Give it a moment if we just switched to it
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 2. Send task to content script
    chrome.tabs.sendMessage(targetTabId, {
      action: 'submitPrompt',
      prompt: task.prompt
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[SW] Content script error:', chrome.runtime.lastError);

        // 记录内容脚本错误（自动进化监控）
        if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordContentScriptError) {
          autoEvolveMonitor.recordContentScriptError(chrome.runtime.lastError.message, {
            taskId: task.id,
            tabId: targetTabId,
            prompt: task.prompt?.substring(0, 100)
          });
        }

        // Report failure back to queue
        chrome.runtime.sendMessage({
          type: 'task_update',
          taskId: task.id,
          status: 'failed',
          error: chrome.runtime.lastError.message
        });
        return;
      }

      if (response && response.success) {
        console.log('[SW] Task completed successfully:', task.id);
        chrome.runtime.sendMessage({
          type: 'task_update',
          taskId: task.id,
          status: 'completed',
          result: response.reply
        });
      } else {
        console.error('[SW] Task failed in content script:', response);

        // 记录任务执行错误（自动进化监控）
        if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordTaskExecutionError) {
          autoEvolveMonitor.recordTaskExecutionError(task.id, response?.error || 'Unknown error', {
            prompt: task.prompt?.substring(0, 100),
            duration: Date.now() - taskStartTime,
            response: response
          });
        }

        chrome.runtime.sendMessage({
          type: 'task_update',
          taskId: task.id,
          status: 'failed',
          error: response ? response.error : 'Unknown error'
        });
      }
    });

  } catch (err) {
    console.error('[SW] Error executing task:', err);

    // 记录任务执行错误（自动进化监控）
    if (typeof autoEvolveMonitor !== 'undefined' && autoEvolveMonitor.recordTaskExecutionError) {
      autoEvolveMonitor.recordTaskExecutionError(task.id, err.toString(), {
        prompt: task.prompt?.substring(0, 100),
        duration: Date.now() - taskStartTime
      });
    }

    chrome.runtime.sendMessage({
      type: 'task_update',
      taskId: task.id,
      status: 'failed',
      error: err.toString()
    });
  }
}

/**
 * 转发自动进化请求到offscreen文档
 * @param {object} evolutionRequest 进化请求
 */
async function forwardAutoEvolveRequest(evolutionRequest) {
  try {
    // 确保offscreen文档存在
    await ensureOffscreen();

    // 发送进化请求到offscreen
    chrome.runtime.sendMessage(evolutionRequest)
      .then(() => {
        console.log('[SW] Auto-evolve request forwarded to offscreen');
      })
      .catch(error => {
        console.error('[SW] Failed to forward auto-evolve request:', error);
      });
  } catch (error) {
    console.error('[SW] Error in forwardAutoEvolveRequest:', error);
  }
}
