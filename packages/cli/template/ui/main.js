// The host serves the SDK that matches it; see docs/contracts.md in the appshell repo.
import { backend, storage, widgets } from '/__appshell/sdk.js';

const visits = ((await storage.get('visits')) ?? 0) + 1;
await storage.set('visits', visits);
document.getElementById('greeting').textContent = await backend.call('greet', { visits });
await widgets.update('status', { blocks: [{ type: 'metric', label: 'Visits', value: visits }] });
