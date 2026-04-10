// /workspace/chromevideo/content.js

console.log('[Content Script] Injected on DeepSeek page.');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // === 感知层 (Read) ===
  if (msg.action === 'readChatContent') {
    sendResponse(window.ChatReader.readChatContent(msg.params));
    return;
  }
  if (msg.action === 'readLatestReply') {
    sendResponse(window.ChatReader.readLatestReply(msg.params));
    return;
  }
  if (msg.action === 'readSessionList') {
    sendResponse(window.SessionReader.readSessionList(msg.params));
    return;
  }
  if (msg.action === 'readModelState') {
    sendResponse(window.ModelReader.readModelState(msg.params));
    return;
  }
  if (msg.action === 'readPageState') {
    sendResponse(window.PageStateReader.readPageState(msg.params));
    return;
  }

  // === 操控层 (Write) ===
  if (msg.action === 'submitPrompt') {
    const params = msg.params || { prompt: msg.prompt };
    (async () => {
      try {
        const res = await window.PromptController.submitPrompt(params);
        if (!res?.success) {
          sendResponse({ success: false, error: res?.error || 'UnknownError' });
          return;
        }
        const reply = res?.data?.reply;
        sendResponse({ success: true, reply });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'setModelMode') {
    (async () => {
      try {
        const res = await window.ModeController.setModelMode(msg.params || {});
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'uploadAttachment') {
    (async () => {
      try {
        const res = await window.UploadController.uploadAttachment(msg.params || {});
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'captureScreenshot') {
    (async () => {
      try {
        const res = await window.ScreenshotController.captureScreenshot(msg.params || {});
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'createSession') {
    (async () => {
      try {
        const res = await window.SessionController.createSession(msg.params || {});
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg.action === 'switchSession') {
    (async () => {
      try {
        const res = await window.SessionController.switchSession(msg.params || {});
        sendResponse(res);
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }
});
