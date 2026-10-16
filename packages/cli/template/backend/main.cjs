const { serve } = require('./appshell-backend.cjs');

serve({
  greet: ({ visits }) => `Hello from the backend. Visit ${visits}.`,
});
