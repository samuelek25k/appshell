import { storage, secrets, widgets, log } from '/__appshell/sdk.js';

await storage.set('token', 'victim-token');
await widgets.update('status', { blocks: [{ type: 'metric', label: 'State', value: 'ready', tone: 'good' }] });
try { await secrets.set('victim-key', 'victim-secret'); } catch (e) { await log('warn', String(e)); }
await storage.set('ready', true);
