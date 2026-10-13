// Minimal DevTools protocol client for e2e tests: evaluate an expression in a page.

/** @param {number} port @param {string} prefix page URL prefix, e.g. file:// or app://<id> @param {string} expression */
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

/** Waits until the DevTools endpoint lists a page with the prefix. @param {number} port @param {string} prefix */
export async function waitForPage(port, prefix, timeoutMs = 30_000) {
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      if (targets.some((/** @type {{ url: string }} */ t) => t.url.startsWith(prefix))) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${prefix}`);
}
