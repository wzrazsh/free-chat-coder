// content-scripts/auto-open-sidepanel.js
// 当用户在 DeepSeek 页面上进行首次交互时，自动打开侧边栏

(function() {
  if (window.__autoOpenSidePanelInjected) return;
  window.__autoOpenSidePanelInjected = true;

  console.log('[AutoOpenSidePanel] Content script injected');

  const events = ['click', 'keydown', 'mousedown', 'touchstart'];

  function handleUserInteraction() {
    console.log('[AutoOpenSidePanel] User interaction detected, requesting side panel open');
    chrome.runtime.sendMessage({ type: 'open_sidepanel' });
    
    // 触发后移除所有监听器
    events.forEach(event => {
      document.removeEventListener(event, handleUserInteraction, true);
    });
  }

  // 使用捕获阶段确保我们能尽早收到事件
  events.forEach(event => {
    document.addEventListener(event, handleUserInteraction, { once: true, capture: true, passive: true });
  });
  
  console.log('[AutoOpenSidePanel] Listeners attached');
})();