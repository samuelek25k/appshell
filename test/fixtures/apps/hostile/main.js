// Tries to escape its sandbox. Each check records "blocked" or "ESCAPED: <detail>".
import { call, storage, backend } from '/__appshell/sdk.js';

const results = {};
const check = async (name, attempt) => {
  try { results[name] = (await attempt()) ?? 'blocked'; } catch (e) { results[name] = `ERROR: ${e?.message ?? e}`; }
};
const denied = (code) => async (promise) => {
  try { await promise; return 'ESCAPED: call succeeded'; } catch (e) { return String(e.message).startsWith(code) ? 'blocked' : `ESCAPED: ${e.message}`; }
};
const fails = async (promise) => {
  try { await promise; return 'ESCAPED: request succeeded'; } catch { return 'blocked'; }
};

await new Promise((r) => setTimeout(r, 1500)); // let the victim app store its data first

await check('noNodeGlobals', () =>
  [typeof require, typeof process, typeof module, typeof Buffer].every((t) => t === 'undefined') ? 'blocked' : 'ESCAPED: Node globals present');
await check('noElectronIpc', () => ('ipcRenderer' in window || 'electron' in window ? 'ESCAPED: IPC exposed' : 'blocked'));
await check('crossAppFetch', () => fails(fetch('app://victim/main.js')));
await check('undeclaredNetwork', () => fails(fetch('https://example.com/')));
await check('windowOpen', () => (window.open('https://example.com/') === null ? 'blocked' : 'ESCAPED: window opened'));
await check('otherAppStorage', async () => ((await storage.get('token')) === null ? 'blocked' : 'ESCAPED: read victim token'));
await check('undeclaredSecret', () => denied('CAPABILITY_DENIED')(call('secrets.get', { name: 'victim-key' })));
await check('undeclaredNotification', () => denied('CAPABILITY_DENIED')(call('notifications.show', { title: 'x' })));
await check('spoofWidget', () => denied('CAPABILITY_DENIED')(call('widgets.update', { id: 'status', descriptor: { blocks: [] } })));
await check('undeclaredIdentity', () => denied('CAPABILITY_DENIED')(call('identity.token', { audience: 'app:victim' })));
await check('hostMethod', () => denied('UNKNOWN_METHOD')(call('host:open', {})));
await check('prototypeMethod', () => denied('UNKNOWN_METHOD')(call('toString', {})));
await check('notificationPermission', async () => ((await Notification.requestPermission()) === 'granted' ? 'ESCAPED: granted' : 'blocked'));
await check('camera', () => fails(navigator.mediaDevices.getUserMedia({ video: true })));

const stays = async (go) => { go(); await new Promise((r) => setTimeout(r, 700)); return 'blocked'; }; // a successful escape unloads the page, so no report
await check('navigateAway', () => stays(() => { location.href = 'https://example.com/'; }));
await check('navigateToOtherApp', () => stays(() => { location.href = 'app://victim/index.html'; }));

const fromBackend = await backend.call('attack').catch((e) => ({ backendCall: `ERROR: ${e.message}` }));
Object.assign(results, fromBackend);

await storage.set('report', results);
