window.UploadController = {
  /**
   * 上传附件
   */
  async uploadAttachment(params) {
    const { type, data, filename, mimeType } = params;
    
    // 找到 input[type="file"]
    const fileInput = document.querySelector('input[type="file"]');
    if (!fileInput) {
      throw new Error('UploadInputNotFound: Could not find the file input element');
    }
    
    // 转换 base64 为 Blob
    let blob;
    try {
      const byteString = atob(data.split(',')[1] || data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      blob = new Blob([ab], { type: mimeType || 'image/png' });
    } catch (err) {
      throw new Error('Base64DecodeError: Failed to decode attachment data');
    }
    
    // 构造 File 对象并使用 DataTransfer
    const file = new File([blob], filename || 'attachment.png', { type: mimeType || 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    
    // 触发上传事件
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    console.log(`[UploadController] Uploaded attachment: ${filename}`);
    
    return { success: true, message: `Attachment ${filename} uploaded successfully` };
  }
};