window.ScreenshotController = {
  async requestViewportCapture() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'capture_screenshot', target: 'viewport' }, (resp) => {
        resolve(resp);
      });
    });
  },

  async cropToElement(dataUrl, element) {
    const rect = element.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    const img = new Image();
    img.src = dataUrl;
    await new Promise((r, rej) => {
      img.onload = r;
      img.onerror = rej;
    });

    const sx = Math.max(0, Math.floor(rect.left * ratio));
    const sy = Math.max(0, Math.floor(rect.top * ratio));
    const sw = Math.max(1, Math.floor(rect.width * ratio));
    const sh = Math.max(1, Math.floor(rect.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/png');
  },

  async captureScreenshot(params = {}) {
    const { target = 'viewport', elementSelector, uploadToChat = false, returnBase64 = true } = params;
    if (target !== 'viewport' && target !== 'element') {
      return { success: false, error: 'NotSupported' };
    }

    const resp = await this.requestViewportCapture();
    if (!resp || !resp.success) {
      return { success: false, error: resp?.error || 'CaptureFailed' };
    }

    let dataUrl = resp.dataUrl;
    if (target === 'element') {
      const el = elementSelector ? document.querySelector(elementSelector) : null;
      if (!el) return { success: false, error: 'ElementNotFound' };
      dataUrl = await this.cropToElement(dataUrl, el);
    }

    if (uploadToChat) {
      const filename = 'screenshot.png';
      const mimeType = 'image/png';
      const uploadRes = await window.UploadController.uploadAttachment({
        type: 'image',
        data: dataUrl,
        filename,
        mimeType
      });
      if (!uploadRes?.success) {
        return { success: false, error: uploadRes?.error || 'UploadFailed' };
      }
    }

    return { success: true, data: { base64: returnBase64 ? dataUrl : null } };
  }
};

