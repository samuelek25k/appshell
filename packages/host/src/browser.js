import electron from 'electron';
import { checkBrowserCapability } from '@appshell/contracts';
import { fail } from './services.js';

const WebContentsView = typeof electron === 'object' && electron !== null && 'WebContentsView' in electron
  ? electron.WebContentsView
  : class MockWebContentsView {
    /** @param {any} _opts */
    constructor(_opts) {}
    /** @param {any} _b */
    setBounds(_b) {}
    /** @param {any} _v */
    setVisible(_v) {}
  };

const session = typeof electron === 'object' && electron !== null && 'session' in electron
  ? electron.session
  : {
    fromPartition: (/** @type {string} */ _p) => ({
      /** @param {any} _h */
      setPermissionRequestHandler: (_h) => {},
      /** @param {any} _h */
      setPermissionCheckHandler: (_h) => {},
      /** @param {any} _h */
      setDevicePermissionHandler: (_h) => {},
      clearStorageData: async () => {},
    }),
  };

/**
 * @typedef {{
 *   developerMode?: boolean,
 *   hostLog?: (msg: string) => void,
 *   audit?: (entry: { event: string, actor?: string, target?: string, details?: Record<string, any> }) => void,
 *   onNavigated?: (appId: string, info: { url: string, title: string }) => void,
 *   viewFactory?: (appId: string, ses: any) => any,
 * }} BrowserManagerOptions
 */

/**
 * @typedef {{
 *   view: any,
 *   wc: any,
 *   currentUrl: string,
 *   title: string,
 *   loading: boolean,
 * }} BrowserSession
 */

/**
 * @param {BrowserManagerOptions} [options]
 */
export function createBrowserManager(options = {}) {
  const { developerMode = false, hostLog = () => {}, audit, onNavigated, viewFactory } = options;
  /** @type {Map<string, BrowserSession>} */
  const sessions = new Map();

  /**
   * @param {string} appId
   * @param {import('@appshell/contracts').Manifest} manifest
   * @returns {BrowserSession}
   */
  function getOrCreateSession(appId, manifest) {
    let entry = sessions.get(appId);
    if (entry) return entry;

    const ses = session.fromPartition(`persist:browser:${appId}`);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);

    const view = viewFactory
      ? viewFactory(appId, ses)
      : new WebContentsView({
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
        },
      });

    const wc = view.webContents;
    wc?.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    wc?.on?.('will-navigate', (/** @type {any} */ event, /** @type {string} */ targetUrl) => {
      try {
        const t = new URL(targetUrl);
        if (t.protocol !== 'https:' && !(developerMode && t.protocol === 'http:')) {
          event.preventDefault();
          return;
        }
        if (checkBrowserCapability(manifest, targetUrl)) {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    });

    entry = { view, wc, currentUrl: '', title: '', loading: false };
    sessions.set(appId, entry);
    return entry;
  }

  return {
    /**
     * @param {string} appId
     * @param {import('@appshell/contracts').Manifest} manifest
     * @param {string} url
     * @returns {Promise<{ url: string, title: string }>}
     */
    async navigate(appId, manifest, url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        throw fail('INVALID_PARAMS', 'invalid url');
      }
      if (parsed.protocol !== 'https:' && !(developerMode && parsed.protocol === 'http:')) {
        throw fail('CAPABILITY_DENIED', `protocol ${parsed.protocol} is not allowed for browser automation`);
      }
      const capabilityError = checkBrowserCapability(manifest, url);
      if (capabilityError) {
        throw fail('CAPABILITY_DENIED', `navigation to ${parsed.hostname} denied: ${capabilityError}`);
      }

      const entry = getOrCreateSession(appId, manifest);
      entry.loading = true;
      entry.currentUrl = url;

      if (audit) audit({ event: 'BROWSER_NAVIGATED', target: appId, details: { url } });

      if (entry.wc?.loadURL) {
        if (typeof entry.wc.once === 'function') {
          await new Promise((resolvePromise, rejectPromise) => {
            let done = false;
            const timer = setTimeout(() => {
              if (!done) {
                done = true;
                cleanup();
                entry.loading = false;
                resolvePromise(null);
              }
            }, 15000);

            const onFinish = () => {
              if (!done) {
                done = true;
                cleanup();
                entry.title = entry.wc.getTitle ? entry.wc.getTitle() : '';
                entry.currentUrl = entry.wc.getURL ? entry.wc.getURL() : url;
                entry.loading = false;
                if (onNavigated) {
                  onNavigated(appId, { url: entry.currentUrl, title: entry.title });
                }
                resolvePromise(null);
              }
            };

            /**
             * @param {any} _event
             * @param {number} errorCode
             * @param {string} errorDescription
             */
            const onFail = (_event, errorCode, errorDescription) => {
              if (!done) {
                done = true;
                cleanup();
                entry.loading = false;
                rejectPromise(fail('NETWORK_ERROR', `failed to load ${url}: ${errorDescription} (${errorCode})`));
              }
            };

            const cleanup = () => {
              clearTimeout(timer);
              entry.wc.removeListener?.('did-finish-load', onFinish);
              entry.wc.removeListener?.('did-fail-load', onFail);
            };

            entry.wc.once('did-finish-load', onFinish);
            entry.wc.once('did-fail-load', onFail);

            try {
              const p = entry.wc.loadURL(url);
              if (p && typeof p.catch === 'function') {
                p.catch((/** @type {any} */ err) => {
                  if (!done) {
                    done = true;
                    cleanup();
                    entry.loading = false;
                    rejectPromise(fail('NETWORK_ERROR', err instanceof Error ? err.message : String(err)));
                  }
                });
              }
            } catch (err) {
              cleanup();
              entry.loading = false;
              rejectPromise(fail('NETWORK_ERROR', err instanceof Error ? err.message : String(err)));
            }
          });
        } else {
          try {
            await entry.wc.loadURL(url);
          } catch (err) {
            entry.loading = false;
            throw fail('NETWORK_ERROR', err instanceof Error ? err.message : String(err));
          }
          entry.title = entry.wc.getTitle ? entry.wc.getTitle() : '';
          entry.currentUrl = entry.wc.getURL ? entry.wc.getURL() : url;
          entry.loading = false;
          if (onNavigated) {
            onNavigated(appId, { url: entry.currentUrl, title: entry.title });
          }
        }
      }

      return { url: entry.currentUrl, title: entry.title };
    },

    /**
     * @param {string} appId
     * @param {{ action: 'click' | 'type' | 'press' | 'select', selector: string, value?: string }} params
     * @returns {Promise<{ action: string, selector: string, success: boolean }>}
     */
    async act(appId, params) {
      const entry = sessions.get(appId);
      if (!entry || !entry.wc) throw fail('INVALID_STATE', 'no active browser session');
      const { action, selector, value } = params;
      if (audit) audit({ event: 'BROWSER_ACTION', target: appId, details: { action, selector } });

      let code = '';
      if (action === 'click') {
        code = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
          el.click();
          return true;
        })()`;
      } else if (action === 'type') {
        code = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
          el.focus();
          el.value = ${JSON.stringify(value ?? '')};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`;
      } else if (action === 'press') {
        code = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)}) || document.activeElement;
          if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
          const key = ${JSON.stringify(value ?? 'Enter')};
          el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
          return true;
        })()`;
      } else if (action === 'select') {
        code = `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('element not found: ' + ${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value ?? '')};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`;
      }

      try {
        const res = await entry.wc.executeJavaScript(code, true);
        return { action, selector, success: Boolean(res) };
      } catch (err) {
        throw fail('ACTION_FAILED', err instanceof Error ? err.message : String(err));
      }
    },

    /**
     * @param {string} appId
     * @param {{ selector?: string, format?: 'text' | 'html' }} [params]
     * @returns {Promise<{ value: string | null }>}
     */
    async extract(appId, params = {}) {
      const entry = sessions.get(appId);
      if (!entry || !entry.wc) throw fail('INVALID_STATE', 'no active browser session');
      const { selector, format } = params;
      const code = `(() => {
        const el = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.documentElement'};
        if (!el) return null;
        return ${format === 'html' ? 'el.outerHTML' : '(el.innerText || el.textContent || "").trim()'};
      })()`;

      try {
        const value = await entry.wc.executeJavaScript(code, true);
        return { value };
      } catch (err) {
        throw fail('EXTRACT_FAILED', err instanceof Error ? err.message : String(err));
      }
    },

    /**
     * @param {string} appId
     * @param {{ script: string }} params
     * @returns {Promise<{ result: unknown }>}
     */
    async evaluate(appId, params) {
      const entry = sessions.get(appId);
      if (!entry || !entry.wc) throw fail('INVALID_STATE', 'no active browser session');
      try {
        const result = await entry.wc.executeJavaScript(params.script, true);
        return { result };
      } catch (err) {
        throw fail('EVALUATE_FAILED', err instanceof Error ? err.message : String(err));
      }
    },

    /**
     * @param {string} appId
     * @returns {Promise<{ dataUrl: string }>}
     */
    async screenshot(appId) {
      const entry = sessions.get(appId);
      if (!entry || !entry.wc) throw fail('INVALID_STATE', 'no active browser session');
      try {
        const image = await entry.wc.capturePage();
        return { dataUrl: image.toDataURL() };
      } catch (err) {
        throw fail('SCREENSHOT_FAILED', err instanceof Error ? err.message : String(err));
      }
    },

    /**
     * @param {string} appId
     * @returns {Promise<{ active: boolean, url: string | null, title: string | null, loading: boolean }>}
     */
    async status(appId) {
      const entry = sessions.get(appId);
      if (!entry || !entry.wc) return { active: false, url: null, title: null, loading: false };
      return {
        active: true,
        url: entry.wc.getURL ? entry.wc.getURL() : entry.currentUrl,
        title: entry.wc.getTitle ? entry.wc.getTitle() : entry.title,
        loading: entry.wc.isLoading ? entry.wc.isLoading() : entry.loading,
      };
    },

    /**
     * @param {string} appId
     * @returns {Promise<{ closed: boolean }>}
     */
    async close(appId) {
      const entry = sessions.get(appId);
      if (!entry) return { closed: false };
      sessions.delete(appId);
      try {
        entry.wc?.close?.();
      } catch (err) {
        hostLog(`error closing browser session for ${appId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (audit) audit({ event: 'BROWSER_CLOSED', target: appId });
      return { closed: true };
    },

    /**
     * @returns {Promise<void>}
     */
    async closeAll() {
      for (const appId of sessions.keys()) {
        await this.close(appId);
      }
    },
  };
}
