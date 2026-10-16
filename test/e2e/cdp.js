import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {string} userData */
export function accountRoot(userData) {
  try {
    const state = JSON.parse(readFileSync(join(userData, 'accounts.json'), 'utf8'));
    return join(userData, 'accounts', state.accounts.find((/** @type {{ id: string }} */ a) => a.id === state.activeId).dir);
  } catch {
    return join(userData, 'accounts', 'pending');
  }
}

/**
 * @param {number} port
 * @param {string} prefix
 * @param {string} expression
 */
export async function evaluate(port, prefix, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((/** @type {{ url: string }} */ t) => t.url.startsWith(prefix));
  if (!target) throw new Error(`no page starts with ${prefix}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const reply = await new Promise((resolve) => { ws.onmessage = (m) => resolve(JSON.parse(String(m.data))); });
  ws.close();
  const { result } = /** @type {any} */ (reply);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed');
  return result.result.value;
}

/**
 * @param {number} port
 * @param {string} prefix
 * @param {string} ready
 */
export async function waitForPage(port, prefix, ready = "document.readyState === 'complete'", timeoutMs = 30_000) {
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    try {
      if (await evaluate(port, prefix, ready)) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${prefix}`);
}
