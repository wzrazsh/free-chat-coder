function getHeader(headers, headerName) {
  if (!headers || !headerName) {
    return '';
  }

  const match = Object.keys(headers).find((key) => key.toLowerCase() === headerName.toLowerCase());
  if (!match) {
    return '';
  }

  const value = headers[match];
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return typeof value === 'string' ? value : String(value || '');
}

function safeJsonParse(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function getValueAtPath(root, pathExpression) {
  if (!root || !pathExpression) {
    return undefined;
  }

  const segments = String(pathExpression).split('.');
  let cursor = root;

  for (const segment of segments) {
    if (cursor == null) {
      return undefined;
    }

    if (Array.isArray(cursor)) {
      if (!/^\d+$/.test(segment)) {
        return undefined;
      }

      cursor = cursor[Number(segment)];
      continue;
    }

    if (typeof cursor !== 'object' || !(segment in cursor)) {
      return undefined;
    }

    cursor = cursor[segment];
  }

  return cursor;
}

function normalizeTextValue(value, depth = 0) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (depth >= 4) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeTextValue(entry, depth + 1))
      .filter(Boolean)
      .join('');
  }

  if (typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text;
    }

    if (typeof value.content === 'string') {
      return value.content;
    }

    if (Array.isArray(value.content)) {
      return normalizeTextValue(value.content, depth + 1);
    }

    if (typeof value.message === 'string') {
      return value.message;
    }

    if (value.message && typeof value.message === 'object') {
      return normalizeTextValue(value.message, depth + 1);
    }

    if (Array.isArray(value.parts)) {
      return normalizeTextValue(value.parts, depth + 1);
    }
  }

  return '';
}

function pickFirstText(root, candidatePaths) {
  for (const pathExpression of candidatePaths) {
    const value = getValueAtPath(root, pathExpression);
    const normalized = normalizeTextValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

function pickFirstScalar(root, candidatePaths) {
  for (const pathExpression of candidatePaths) {
    const value = getValueAtPath(root, pathExpression);
    if (value == null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

const DELTA_TEXT_PATHS = [
  'delta',
  'delta.content',
  'data.delta',
  'data.delta.content',
  'choices.0.delta',
  'choices.0.delta.content'
];

const TEXT_PATHS = [
  ...DELTA_TEXT_PATHS,
  'text',
  'content',
  'message',
  'message.content',
  'answer',
  'response',
  'output_text',
  'data.text',
  'data.content',
  'data.message',
  'data.message.content',
  'data.answer',
  'data.response',
  'data.output_text',
  'choices.0.text',
  'choices.0.content',
  'choices.0.message.content',
  'result.text',
  'result.content'
];

const SESSION_ID_PATHS = [
  'session_id',
  'sessionId',
  'conversation_id',
  'conversationId',
  'data.session_id',
  'data.sessionId',
  'data.conversation_id',
  'data.conversationId',
  'result.session_id',
  'result.conversation_id'
];

const PARENT_MESSAGE_ID_PATHS = [
  'parent_message_id',
  'parentMessageId',
  'parent_id',
  'parentId',
  'data.parent_message_id',
  'data.parentMessageId',
  'data.parent_id',
  'data.parentId',
  'result.parent_message_id'
];

const MESSAGE_ID_PATHS = [
  'message_id',
  'messageId',
  'data.message_id',
  'data.messageId',
  'result.message_id',
  'result.messageId'
];

const REQUEST_ID_PATHS = [
  'request_id',
  'requestId',
  'trace_id',
  'traceId',
  'data.request_id',
  'data.requestId',
  'meta.request_id',
  'meta.requestId'
];

function extractMetadata(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      sessionId: null,
      parentMessageId: null,
      messageId: null,
      requestId: null
    };
  }

  return {
    sessionId: pickFirstScalar(payload, SESSION_ID_PATHS),
    parentMessageId: pickFirstScalar(payload, PARENT_MESSAGE_ID_PATHS),
    messageId: pickFirstScalar(payload, MESSAGE_ID_PATHS),
    requestId: pickFirstScalar(payload, REQUEST_ID_PATHS)
  };
}

function mergeMetadata(target, patch) {
  if (patch.sessionId && !target.sessionId) {
    target.sessionId = patch.sessionId;
  }

  if (patch.parentMessageId && !target.parentMessageId) {
    target.parentMessageId = patch.parentMessageId;
  }

  if (patch.messageId && !target.messageId) {
    target.messageId = patch.messageId;
  }

  if (patch.requestId && !target.requestId) {
    target.requestId = patch.requestId;
  }
}

function parseEventStream(body) {
  if (!body) {
    return [];
  }

  return String(body)
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      let event = 'message';
      const dataLines = [];
      const lines = chunk.split(/\r?\n/);

      for (const line of lines) {
        if (!line) {
          continue;
        }

        if (line.startsWith(':')) {
          continue;
        }

        if (line.startsWith('event:')) {
          event = line.slice('event:'.length).trim() || event;
          continue;
        }

        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trim());
          continue;
        }

        dataLines.push(line.trim());
      }

      const data = dataLines.join('\n').trim();
      return {
        event,
        data,
        json: safeJsonParse(data)
      };
    });
}

function parseEventStreamResponse(body) {
  const events = parseEventStream(body);
  const metadata = {
    sessionId: null,
    parentMessageId: null,
    messageId: null,
    requestId: null
  };
  let streamedText = '';
  let finalText = '';

  for (const event of events) {
    if (!event.data || event.data === '[DONE]') {
      continue;
    }

    if (!event.json) {
      streamedText += event.data;
      continue;
    }

    mergeMetadata(metadata, extractMetadata(event.json));

    const deltaText = pickFirstText(event.json, DELTA_TEXT_PATHS);
    if (deltaText) {
      streamedText += deltaText;
    }

    const eventText = pickFirstText(event.json, TEXT_PATHS);
    if (eventText && eventText.length >= finalText.length) {
      finalText = eventText;
    }
  }

  return {
    ...metadata,
    mode: 'event-stream',
    text: finalText.length >= streamedText.length ? finalText : streamedText
  };
}

function parseJsonResponse(body) {
  const payload = safeJsonParse(body);
  if (!payload) {
    return null;
  }

  return {
    ...extractMetadata(payload),
    mode: 'json',
    text: pickFirstText(payload, TEXT_PATHS)
  };
}

function parseChatResponse(response = {}) {
  const body = typeof response.body === 'string'
    ? response.body
    : Buffer.isBuffer(response.body)
      ? response.body.toString('utf8')
      : '';
  const contentType = getHeader(response.headers, 'content-type').toLowerCase();
  const looksLikeEventStream = contentType.includes('text/event-stream') || /^\s*data:/m.test(body);

  if (looksLikeEventStream) {
    return parseEventStreamResponse(body);
  }

  if (contentType.includes('json') || /^\s*[\[{]/.test(body)) {
    const parsedJson = parseJsonResponse(body);
    if (parsedJson) {
      return parsedJson;
    }
  }

  return {
    sessionId: null,
    parentMessageId: null,
    messageId: null,
    requestId: null,
    mode: 'text',
    text: body
  };
}

module.exports = {
  parseChatResponse,
  parseEventStream
};
