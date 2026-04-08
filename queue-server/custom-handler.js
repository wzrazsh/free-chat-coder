module.exports = {
  processTask: (task) => {
    // This is the default handler.
    // It passes the prompt through without modification.
    return task.prompt;
  }
};
