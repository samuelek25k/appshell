import { BrowserWindow } from 'electron';

/**
 * @param {{
 *   title: string,
 *   icon: string | undefined,
 *   preload: string,
 *   layout: () => void,
 *   log: (message: string) => void,
 *   onClosed: () => void,
 * }} options
 */
export function createHostWindow({ title, icon, preload, layout, log, onClosed }) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title,
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);
  win.on('closed', onClosed);
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => { if (e.level === 'error') log(`host ui: ${e.message}`); });
  win.webContents.on('preload-error', (_e, file, error) => log(`host preload ${file}: ${error.message}`));
  return win;
}
