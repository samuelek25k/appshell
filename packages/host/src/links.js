/**
 * @param {{
 *   protocol: string,
 *   open: (appId: string) => boolean,
 *   requestInstall: (appId: string) => unknown,
 *   running: Map<string, { view: Electron.WebContentsView }>,
 * }} deps
 */
export function createLinks({ protocol, open, requestInstall, running }) {
  return {
    /** @param {string[]} argv */
    from: (argv) => argv.filter((a) => a.startsWith(`${protocol}://`)),

    /** @param {string} link */
    handle(link) {
      let url;
      try { url = new URL(link); } catch { return; }
      if (url.protocol !== `${protocol}:`) return;
      const install = url.host === '_' && /^\/install\/([a-z][a-z0-9.-]{0,63})$/.exec(url.pathname);
      if (install) { requestInstall(install[1]); return; }
      if (!open(url.host)) return;
      const wc = running.get(url.host)?.view.webContents;
      const send = () => wc?.send('appshell:event', 'shell.deepLink', { path: url.pathname + url.search });
      if (wc?.isLoading()) wc.once('did-finish-load', send); else send();
    },
  };
}
