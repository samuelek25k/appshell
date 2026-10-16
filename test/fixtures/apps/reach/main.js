import { network, storage } from '/__appshell/sdk.js';

const { target, other } = await (await fetch('config.json')).json();
const reach = async (url) => { try { return (await (await fetch(url)).text()).slice(0, 20); } catch { return 'blocked'; } };

const before = await reach(target);
const grant = await network.requestEndpoint(target);
const after = await reach(target);
const sibling = await reach(other);
let outside = 'asked';
try { await network.requestEndpoint('http://example.com'); } catch (error) { outside = String(error); }
const listed = await network.endpoints();
await storage.set('report', { before, grant, after, sibling, outside, listed });
document.getElementById('again').addEventListener('click', async () => storage.set('again', await reach(target)));
