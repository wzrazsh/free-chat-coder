window.UploadController = {
  base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },

  async uploadAttachment(params = {}) {
    const { data, filename = 'attachment', mimeType = 'application/octet-stream' } = params;
    if (!data) return { success: false, error: 'MissingData' };

    const input = document.querySelector('input[type="file"]');
    if (!input) return { success: false, error: 'FileInputNotFound' };

    const b64 = data.includes(',') ? data.split(',')[1] : data;
    const bytes = this.base64ToBytes(b64);
    const file = new File([bytes], filename, { type: mimeType });

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, result: { filename, mimeType, size: file.size } };
  }
};

