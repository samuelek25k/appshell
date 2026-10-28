import { allowsIacReceive } from '@appshell/contracts';

/**
 * @param {{
 *   apps: () => Map<string, import('./registry.js').InstalledApp>,
 *   running: Map<string, { view: Electron.WebContentsView }>,
 *   open: (appId: string) => boolean,
 * }} deps
 */
export function createIac({ apps, running, open }) {
  /** @type {Map<string, Set<string>>} */
  const subscriptions = new Map();

  return {
    /**
     * @param {string} targetId
     * @param {string} fromId
     */
    canReceive(targetId, fromId) {
      const target = apps().get(targetId);
      if (!target) return false;
      return allowsIacReceive(target.manifest, fromId);
    },

    /**
     * @param {string} fromId
     * @param {string} toId
     * @param {string} action
     * @param {unknown} payload
     * @param {boolean | undefined} launchIfNeeded
     */
    async send(fromId, toId, action, payload, launchIfNeeded) {
      let entry = running.get(toId);
      if (!entry && launchIfNeeded) {
        if (open(toId)) entry = running.get(toId);
      }
      if (!entry) return { delivered: false, targetRunning: false };
      entry.view.webContents.send('appshell:event', 'iac.message', { from: fromId, action, payload, timestamp: Date.now() });
      return { delivered: true, targetRunning: true };
    },

    /**
     * @param {string} fromId
     * @param {string} channel
     * @param {unknown} data
     */
    publish(fromId, channel, data) {
      const subscribers = subscriptions.get(channel);
      if (!subscribers || subscribers.size === 0) return { subscribersCount: 0 };
      let count = 0;
      const timestamp = Date.now();
      for (const subId of subscribers) {
        if (subId === fromId) continue;
        const target = apps().get(subId);
        if (!target || !allowsIacReceive(target.manifest, fromId)) continue;
        const entry = running.get(subId);
        if (entry) {
          entry.view.webContents.send('appshell:event', 'iac.broadcast', { channel, from: fromId, data, timestamp });
          count++;
        }
      }
      return { subscribersCount: count };
    },

    /**
     * @param {string} appId
     * @param {string} channel
     */
    subscribe(appId, channel) {
      let set = subscriptions.get(channel);
      if (!set) {
        set = new Set();
        subscriptions.set(channel, set);
      }
      set.add(appId);
      return true;
    },

    /**
     * @param {string} appId
     * @param {string} channel
     */
    unsubscribe(appId, channel) {
      const set = subscriptions.get(channel);
      if (set) {
        set.delete(appId);
        if (set.size === 0) subscriptions.delete(channel);
      }
      return true;
    },

    /** @param {string} appId */
    forget(appId) {
      for (const [channel, set] of subscriptions.entries()) {
        set.delete(appId);
        if (set.size === 0) subscriptions.delete(channel);
      }
    },
  };
}
