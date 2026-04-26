console.log('[Content Script] Injected on DeepSeek page.');

window.ModeController = {
  _findElementByText(root, text) {
    const walker = document.createTreeWalker(
      root || document, 
      NodeFilter.SHOW_TEXT, 
      null, 
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent && node.textContent.includes(text)) {
        const el = node.parentElement;
        if (el) return el;
      }
    }
    return null;
  },

  _toggleState(element) {
    if (!element) return false;
    if (element.tagName === 'INPUT' && element.type === 'radio') {
      return element.checked;
    }
    const isSelected = (el) => {
      return el.classList.contains('ds-toggle-button--selected') ||
        el.classList.contains('active') ||
        el.classList.contains('selected') ||
        el.getAttribute('aria-checked') === 'true' ||
        el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('data-state') === 'active';
    };
    return isSelected(element);
  },

  _findModeButton(label) {
    return this._findElementByText(null, label);
  },

  readModeProfile() {
    const expertButton = this._findModeButton('专家模式');
    const quickButton = this._findModeButton('快速模式');
    let profile = 'unknown';
    if (expertButton && this._toggleState(expertButton)) {
      profile = 'expert';
    } else if (quickButton && this._toggleState(quickButton)) {
      profile = 'quick';
    }
    return { success: true, data: { profile, hasExpertToggle: !!expertButton, hasQuickToggle: !!quickButton } };
  },

  setModeProfile(params = {}) {
    const profile = params.profile || 'expert';
    const targetLabel = profile === 'quick' ? '快速模式' : '专家模式';
    const targetButton = this._findModeButton(targetLabel);
    if (targetButton) {
      if (!this._toggleState(targetButton)) {
        targetButton.click();
      }
      return { success: true, data: { profile, switchedBy: 'native_profile_toggle' } };
    }
    const fallback = profile === 'expert'
      ? this.setModelMode({ deepThink: true, search: true })
      : this.setModelMode({ deepThink: false, search: false });
    return { success: fallback.success, data: { profile, switchedBy: 'deepthink_search_fallback', fallback: fallback.data || null }, error: fallback.error };
  },

  setModelMode(params = {}) {
    const { deepThink, search } = params;
    return { success: true, data: { modelMode: deepThink ? 'deepThink' : 'quick', searchEnabled: !!search } };
  }
};

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
