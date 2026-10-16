const [port, prefix, expression] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => t.url.startsWith(prefix));
if (!target) throw new Error(`no page starts with ${prefix}: ${targets.map((t) => t.url).join(', ')}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
ws.addEventListener('message', (m) => {
  const { result } = JSON.parse(String(m.data));
  console.log(JSON.stringify(result?.exceptionDetails?.exception?.description ?? result?.result?.value));
  ws.close();
});
