// /workspace/chromevideo/content.js

console.log('[Content Script] Injected on DeepSeek page.');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'submitPrompt') {
    const prompt = msg.prompt;
    console.log('[Content Script] Submitting prompt:', prompt);
    
    // Find the textarea
    // Note: Selector might change depending on DeepSeek's DOM structure updates
    const input = document.querySelector('textarea');
    
    if (input) {
      // Clear and fill value
      input.value = prompt;
      // Dispatch input event to trigger React binding
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Give UI a moment to respond
      setTimeout(() => {
        // Find send button (you may need to update this selector)
        // Usually deepseek uses a specific icon or SVG inside a button or div
        // We'll look for a button that is an immediate sibling or near the textarea
        const sendBtn = document.querySelector('div.ds-icon-button') || document.querySelector('button[aria-label="Send"]') || document.querySelector('textarea').nextElementSibling;
        
        if (sendBtn) {
          sendBtn.click();
          console.log('[Content Script] Clicked send button.');
          
          // Start polling for reply
          waitForReply()
            .then(reply => sendResponse({ success: true, reply }))
            .catch(err => sendResponse({ success: false, error: err.message }));
            
        } else {
          sendResponse({ success: false, error: 'Send button not found' });
        }
      }, 500);
      
      // Keep channel open for async response
      return true;
    } else {
      sendResponse({ success: false, error: 'Textarea not found on page' });
    }
  }
});

function waitForReply() {
  return new Promise((resolve, reject) => {
    console.log('[Content Script] Waiting for reply...');
    // Simplify for MVP: Just poll for new message bubbles or wait for a specific time
    // DeepSeek reply text is usually inside a div with class like "ds-markdown"
    
    // 1. Wait a bit for the user message to appear and bot to start typing
    setTimeout(() => {
      let lastText = '';
      let identicalCount = 0;
      
      const pollInterval = setInterval(() => {
        // Find the last markdown block
        const messageBlocks = document.querySelectorAll('.ds-markdown, .markdown-body');
        if (messageBlocks.length === 0) return;
        
        const lastBlock = messageBlocks[messageBlocks.length - 1];
        const currentText = lastBlock.innerText || lastBlock.textContent;
        
        if (currentText && currentText === lastText) {
          identicalCount++;
          // If text hasn't changed for 10 iterations (5 seconds), assume generation complete
          if (identicalCount >= 10) {
            clearInterval(pollInterval);
            console.log('[Content Script] Reply generation finished.');
            resolve(currentText);
          }
        } else {
          lastText = currentText;
          identicalCount = 0; // reset count if text is still changing
        }
      }, 500);
      
      // Timeout after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        reject(new Error('Timeout waiting for reply'));
      }, 120000);
      
    }, 2000);
  });
}
