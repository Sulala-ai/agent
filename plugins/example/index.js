/**
 * Example plugin — implements onFileEvent and onTask.
 * Copy to your own plugin and customize.
 */
export default {
  async onStart() {
    console.log('[example-plugin] Started');
  },

  onFileEvent(payload) {
    if (payload.event === 'add' && payload.path.endsWith('.md')) {
      console.log('[example-plugin] New markdown file:', payload.path);
    }
  },

  async onTask(task) {
    if (task.type === 'heartbeat') {
      console.log('[example-plugin] Heartbeat', task.payload?.ts);
      return true; // handled
    }
    return false;
  },

  async onStop() {
    console.log('[example-plugin] Stopped');
  },
};
