window.ScreenshotController = {
  /**
   * 截图当前页面或元素
   */
  async captureScreenshot(params) {
    const { target = 'viewport', elementSelector, uploadToChat = true, returnBase64 = true } = params;
    
    // 1. 发送消息给 background 请求 captureVisibleTab
    const dataUrl = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.dataUrl);
        }
      });
    });

    if (!dataUrl) {
      throw new Error('CaptureFailed: Background script failed to capture tab');
    }

    let finalDataUrl = dataUrl;

    // 2. 如果是裁剪元素，需要通过 canvas 处理
    if (target === 'element' && elementSelector) {
      const el = document.querySelector(elementSelector);
      if (el) {
        const rect = el.getBoundingClientRect();
        finalDataUrl = await this._cropImage(dataUrl, rect);
      } else {
        throw new Error(`ElementNotFound: Could not find element with selector ${elementSelector}`);
      }
    }

    // 3. 是否上传到当前对话
    if (uploadToChat && window.UploadController) {
      await window.UploadController.uploadAttachment({
        type: 'image',
        data: finalDataUrl,
        filename: `screenshot_${Date.now()}.png`,
        mimeType: 'image/png'
      });
    }

    return {
      success: true,
      message: 'Screenshot captured successfully',
      data: returnBase64 ? finalDataUrl : undefined
    };
  },

  /**
   * 裁剪 base64 图片
   */
  _cropImage(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = rect.width;
        canvas.height = rect.height;
        const ctx = canvas.getContext('2d');
        
        // 注意：这里需要处理设备的 pixel ratio
        const scale = window.devicePixelRatio || 1;
        
        ctx.drawImage(
          img,
          rect.left * scale,
          rect.top * scale,
          rect.width * scale,
          rect.height * scale,
          0,
          0,
          rect.width,
          rect.height
        );
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image for cropping'));
      img.src = dataUrl;
    });
  }
};