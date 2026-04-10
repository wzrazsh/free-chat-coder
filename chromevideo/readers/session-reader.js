window.SessionReader = {
  /**
   * 读取会话列表
   */
  readSessionList(params = {}) {
    const { includeDates = true } = params;
    
    // DeepSeek 会话列表里的链接通常带有 /a/chat/s/ 前缀
    const sessionLinks = document.querySelectorAll('a[href*="/a/chat/s/"]');
    const sessions = [];
    
    sessionLinks.forEach(link => {
      const href = link.getAttribute('href');
      const id = href.split('/').pop();
      const titleEl = link.querySelector('.truncate') || link; // 假设会话名被 truncate 截断
      const title = titleEl.innerText || titleEl.textContent;
      
      let dateGroup = "未知";
      if (includeDates) {
        // 通常时间分组(如"今天","昨天")是在 a 标签的前面的某个分组标题里
        // 简单实现: 往上找直到碰到一个包含明显文本的 div，这里可能不准，先占位
        let prev = link.previousElementSibling;
        while (prev && prev.tagName !== 'DIV') {
          prev = prev.previousElementSibling;
        }
        if (prev && prev.textContent) {
          dateGroup = prev.textContent.trim();
        }
      }

      const isActive = link.classList.contains('active') || link.style.backgroundColor !== ''; // 通过样式或类判断

      sessions.push({
        id,
        title: title.trim(),
        href,
        dateGroup,
        isActive
      });
    });

    return {
      success: true,
      data: {
        sessions,
        totalCount: sessions.length
      }
    };
  }
};
