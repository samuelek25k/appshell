function serve(handlers) {
  process.parentPort.on('message', async ({ data }) => {
    const { id, method, params } = data ?? {};
    try {
      const fn = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
      if (typeof fn !== 'function') throw Object.assign(new Error(`unknown backend method ${method}`), { code: 'UNKNOWN_METHOD' });
      process.parentPort.postMessage({ id, result: (await fn(params ?? {})) ?? null });
    } catch (error) {
      process.parentPort.postMessage({ id, error: { code: error.code ?? 'BACKEND_ERROR', message: String(error.message ?? error) } });
    }
  });
}

module.exports = { serve };
