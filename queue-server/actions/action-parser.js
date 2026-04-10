function parseActions(replyText) {
  if (!replyText) return [];
  const actions = [];

  // 模式 1 & 2：代码块格式
  const actionBlockRegex = /(?:<ActionBlock>\s*)?```action\s*\n([\s\S]*?)```\s*(?:<\/ActionBlock>)?/g;
  let match;
  while ((match = actionBlockRegex.exec(replyText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.action) {
        actions.push(parsed);
      } else if (Array.isArray(parsed)) {
        parsed.forEach(item => { if (item.action) actions.push(item); });
      }
    } catch (e) {
      // 尝试解析为动作数组
      try {
        const arr = JSON.parse(`[${match[1].trim().replace(/}\s*{/g, '},{')}]`);
        if (Array.isArray(arr)) {
          arr.forEach(item => { if (item.action) actions.push(item); });
        }
      } catch (e2) {
        console.warn('[ActionParser] Failed to parse action block:', e2.message);
      }
    }
  }

  // 模式 3：行内格式
  const inlineRegex = /\[ACTION:(\{[^}]+\})\]/g;
  while ((match = inlineRegex.exec(replyText)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action) actions.push(parsed);
    } catch (e) {
      console.warn('[ActionParser] Failed to parse inline action:', e.message);
    }
  }

  return actions;
}

module.exports = {
  parseActions
};
