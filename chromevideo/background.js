// /workspace/chromevideo/background.js

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
  } else if (msg.type === 'capture_screenshot') {
    const windowId = sender?.tab?.windowId;
    if (windowId === undefined) {
      sendResponse({ success: false, error: 'NoSenderTab' });
      return;
    }
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ success: true, dataUrl });
    });
    return true;
  }
});

// Function to handle the actual task
async function executeDeepSeekTask(task) {
  try {
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
      await chrome.tabs.update(targetTabId, { active: true });
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: [
          'utils/dom-helpers.js',
          'utils/anti-detection.js',
          'readers/chat-reader.js',
          'readers/session-reader.js',
          'readers/model-reader.js',
          'readers/page-state-reader.js',
          'controllers/mode-controller.js',
          'controllers/upload-controller.js',
          'controllers/screenshot-controller.js',
          'controllers/session-controller.js',
          'controllers/prompt-controller.js',
          'content.js'
        ]
      });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (injectErr) {
      console.log('[SW] Content script already injected or injection skipped:', injectErr.message);
    }

    chrome.tabs.sendMessage(targetTabId, {
      action: 'submitPrompt',
      prompt: task.prompt,
      params: { prompt: task.prompt, waitForReply: true, typingSpeed: 'human' }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[SW] Content script error:', chrome.runtime.lastError);
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
    chrome.runtime.sendMessage({
      type: 'task_update',
      taskId: task.id,
      status: 'failed',
      error: err.toString()
    });
  }
}
