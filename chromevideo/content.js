console.log('[Content Script] Injected on DeepSeek page.');

function reportContentScriptError(errorType, details) {
  try {
    chrome.runtime.sendMessage({
      type: 'content_script_error',
      errorType,
      details,
      timestamp: new Date().toISOString(),
      url: window.location.href
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Content Script] Failed to report error:', chrome.runtime.lastError.message);
      }
    });
  } catch (error) {
    console.error('[Content Script] Error reporting failed:', error);
  }
}

function normalizeSubmitParams(msg) {
  const params = msg.params && typeof msg.params === 'object' ? { ...msg.params } : {};
  if (typeof msg.prompt === 'string' && !params.prompt) {
    params.prompt = msg.prompt;
  }
  if (typeof params.waitForReply !== 'boolean') {
    params.waitForReply = true;
  }
  return params;
}

function buildLegacyConversationResponse(result) {
  const data = result && result.data ? result.data : {};
  return {
    success: !!result?.success,
    sessionId: data.sessionId,
    sessionTitle: data.sessionTitle,
    totalMessages: data.totalMessages,
    lastMessageHash: data.lastMessageHash,
    messages: Array.isArray(data.messages) ? data.messages : []
  };
}

async function routeAction(msg) {
  switch (msg.action) {
    case 'submitPrompt':
      if (!window.PromptController) {
        throw new Error('PromptControllerUnavailable');
      }
      return window.PromptController.submitPrompt(normalizeSubmitParams(msg));

    case 'setModelMode':
      return window.ModeController.setModelMode(msg.params || {});

    case 'setModeProfile':
      return window.ModeController.setModeProfile(msg.params || {});

    case 'readModeProfile':
      return window.ModeController.readModeProfile();

    case 'createSession':
      return window.SessionController.createSession(msg.params || {});

    case 'switchSession':
      return window.SessionController.switchSession(msg.params || {});

    case 'readSessionList':
      return window.SessionReader.readSessionList(msg.params || {});

    case 'readChatContent':
      return window.ChatReader.readChatContent(msg.params || {});

    case 'readLatestReply':
      return window.ChatReader.readLatestReply(msg.params || {});

    case 'readModelState':
      return window.ModelReader.readModelState(msg.params || {});

    case 'readPageState':
      return window.PageStateReader.readPageState(msg.params || {});

    case 'uploadAttachment':
      return window.UploadController.uploadAttachment(msg.params || {});

    case 'captureScreenshot':
      return window.ScreenshotController.captureScreenshot(msg.params || {});

    case 'getConversation':
      return buildLegacyConversationResponse(window.ChatReader.readChatContent({
        includeUserMessages: true,
        includeAiMessages: true,
        startIndex: 0,
        count: -1
      }));

    case 'ping':
      return { success: true, timestamp: Date.now() };

    default:
      throw new Error(`UnknownAction: ${msg.action}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) {
    return false;
  }

  Promise.resolve()
    .then(() => routeAction(msg))
    .then((result) => sendResponse(result))
    .catch((error) => {
      reportContentScriptError('action_failed', {
        action: msg.action,
        message: error.message,
        stack: error.stack,
        url: window.location.href
      });
      sendResponse({ success: false, error: error.message });
    });

  return true;
});
