window.AntiDetection = {
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  async typeInstant(input, text) {
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  },

  async typeFast(input, text) {
    input.focus();
    input.value = '';
    await this.delay(this.randomInt(50, 150));

    for (let i = 0; i < text.length; i++) {
      input.value += text[i];
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await this.delay(this.randomInt(5, 18));
    }

    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    await this.delay(this.randomInt(50, 150));
  },

  async typeHuman(input, text) {
    input.focus();
    input.value = '';
    await this.delay(this.randomInt(200, 600));

    let currentIndex = 0;
    while (currentIndex < text.length) {
      const chunkSize = this.randomInt(3, 15);
      const chunk = text.substring(currentIndex, currentIndex + chunkSize);

      input.value += chunk;
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      currentIndex += chunkSize;

      await this.delay(this.randomInt(30, 120));
    }

    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    await this.delay(this.randomInt(300, 800));
  },

  async simulateTyping(input, text, speed = 'human') {
    if (speed === 'instant') return this.typeInstant(input, text);
    if (speed === 'fast') return this.typeFast(input, text);
    return this.typeHuman(input, text);
  }
};

