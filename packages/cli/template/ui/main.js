import { backend, shell, storage, widgets } from '/__appshell/sdk.js';

const versions = await shell.getVersions();
if (versions.previous && versions.previous !== versions.current) {
  await storage.remove('deprecatedKey');
}

const visits = ((await storage.get('visits')) ?? 0) + 1;
await storage.set('visits', visits);
document.getElementById('greeting').textContent = await backend.call('greet', { visits });
await widgets.update('status', { blocks: [{ type: 'metric', label: 'Visits', value: visits }] });
