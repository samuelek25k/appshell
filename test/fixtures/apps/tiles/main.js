import { launcher, storage } from '/__appshell/sdk.js';

const apps = await launcher.apps();
await launcher.setTheme({ colors: { brand: '#112233' } });
let rejected = '';
try { await launcher.setTheme({ colors: { brand: 'red' } }); } catch (error) { rejected = String(error); }
const opened = await launcher.open('tiles');
await storage.set('report', { apps: apps.map((a) => a.id), rejected, opened });
document.getElementById('open').addEventListener('click', () => launcher.open('victim'));
