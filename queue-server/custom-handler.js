// /workspace/queue-server/custom-handler.js
/**
 * Custom Handler
 * This file is automatically reloaded by the evolution endpoint.
 * You can implement custom logic here before sending prompt to DeepSeek
 * or after receiving the reply.
 */

function processTask(task) {
  // Currently a passthrough, can be evolved
  return task;
}

module.exports = {
  processTask
};
