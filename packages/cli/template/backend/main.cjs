// Runs in a sandboxed process that can read only this app's folder.
const { serve } = require('./appshell-backend.cjs');

serve({
  greet: ({ visits }) => `Hello from the backend. Visit ${visits}.`,
});
