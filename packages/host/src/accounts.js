import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

/**
 * @typedef {{ id: string, type: 'local' | 'guest', name: string, dir: string, legacy?: boolean, pin?: { salt: string, hash: string } }} Account
 */

/** @param {string} value */
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

/**
 * @param {string} pin
 * @param {Buffer} salt
 */
const hashPin = (pin, salt) => scryptSync(pin, salt, 32);

/**
 * @param {string} dataRoot
 * @param {string} defaultName
 * @param {() => number} [now]
 */
export function createAccounts(dataRoot, defaultName, now = Date.now) {
  const file = join(dataRoot, 'accounts.json');
  const accountsDir = join(dataRoot, 'accounts');
  /** @type {Account | null} */
  let guest = null;
  /** @type {Map<string, { count: number, until: number }>} */
  const failures = new Map();

  /** @type {{ activeId: string, accounts: Account[] }} */
  let state;
  if (existsSync(file)) {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const first = /** @type {Account} */ ({ id: `local:${randomUUID()}`, type: 'local', name: clean(defaultName).slice(0, 40) || 'Me', dir: randomUUID() });
    const legacyApps = join(dataRoot, 'apps');
    if (existsSync(legacyApps)) {
      mkdirSync(join(accountsDir, first.dir), { recursive: true });
      renameSync(legacyApps, join(accountsDir, first.dir, 'apps'));
      first.legacy = true;
    }
    state = { activeId: first.id, accounts: [first] };
  }
  mkdirSync(accountsDir, { recursive: true });
  for (const name of readdirSync(accountsDir)) {
    if (name.startsWith('guest-')) rmSync(join(accountsDir, name), { recursive: true, force: true });
  }

  const save = () => writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  save();

  /** @param {string} id */
  const find = (id) => (guest?.id === id ? guest : state.accounts.find((a) => a.id === id));
  const active = () => /** @type {Account} */ (guest ?? find(state.activeId) ?? state.accounts[0]);

  /**
   * @param {string} id
   * @param {string} [pin]
   */
  function verify(id, pin) {
    const account = find(id);
    if (!account) throw new Error('unknown account');
    if (!account.pin) return;
    const record = failures.get(id);
    if (record && record.count >= MAX_FAILURES && now() < record.until) throw new Error('too many attempts, try again later');
    const given = hashPin(String(pin ?? ''), Buffer.from(account.pin.salt, 'hex'));
    if (!timingSafeEqual(given, Buffer.from(account.pin.hash, 'hex'))) {
      const count = (record && now() >= record.until ? 0 : record?.count ?? 0) + 1;
      failures.set(id, { count, until: now() + LOCKOUT_MS });
      throw new Error('wrong PIN');
    }
    failures.delete(id);
  }

  /**
   * @param {Account} account
   * @param {string} appId
   */
  const partitionOf = (account, appId) => (account.type === 'guest' ? `app:${account.dir}:${appId}` : account.legacy ? `persist:app:${appId}` : `persist:app:${account.dir}:${appId}`);

  /** @param {Account} account */
  const view = (account) => ({ id: account.id, type: account.type, name: account.name, locked: Boolean(account.pin) });

  return {
    list: () => [...state.accounts, ...(guest ? [guest] : [])].map(view),
    active,
    activeView: () => view(active()),

    /** @param {Account} account */
    root: (account) => join(accountsDir, account.dir),

    /**
     * @param {string} appId
     * @param {string} [accountId]
     */
    partition: (appId, accountId) => partitionOf((accountId && find(accountId)) || active(), appId),

    /** @param {string} appId */
    partitions: (appId) => [...state.accounts, ...(guest ? [guest] : [])].map((a) => partitionOf(a, appId)),

    roots: () => [...state.accounts, ...(guest ? [guest] : [])].map((a) => join(accountsDir, a.dir)),

    /**
     * @param {string} name
     * @param {string} [pin]
     */
    createLocal(name, pin) {
      const label = clean(name);
      if (!label || label.length > 40) throw new Error('name must be 1 to 40 characters');
      if (pin !== undefined && pin !== '' && (String(pin).length < 4 || String(pin).length > 64)) throw new Error('PIN must be 4 to 64 characters');
      if (state.accounts.length >= 16) throw new Error('too many accounts');
      /** @type {Account} */
      const account = { id: `local:${randomUUID()}`, type: 'local', name: label, dir: randomUUID() };
      if (pin) {
        const salt = randomBytes(16);
        account.pin = { salt: salt.toString('hex'), hash: hashPin(String(pin), salt).toString('hex') };
      }
      state.accounts.push(account);
      save();
      return view(account);
    },

    startGuest() {
      if (guest) return view(guest);
      const dir = `guest-${randomUUID()}`;
      guest = { id: `guest:${randomUUID()}`, type: 'guest', name: 'Guest', dir };
      mkdirSync(join(accountsDir, dir), { recursive: true });
      return view(guest);
    },

    leaveGuest() {
      if (!guest) return;
      rmSync(join(accountsDir, guest.dir), { recursive: true, force: true });
      guest = null;
    },

    /**
     * @param {string} id
     * @param {string} [pin]
     */
    switchTo(id, pin) {
      const account = find(id);
      if (!account) throw new Error('unknown account');
      verify(id, pin);
      if (account.type === 'local') {
        const leaving = guest;
        guest = null;
        if (leaving) rmSync(join(accountsDir, leaving.dir), { recursive: true, force: true });
        state.activeId = account.id;
        save();
      }
      return view(account);
    },

    verify,

    /**
     * @param {string} id
     * @param {string} [pin]
     */
    remove(id, pin) {
      const account = state.accounts.find((a) => a.id === id);
      if (!account) throw new Error('unknown account');
      if (state.accounts.length === 1) throw new Error('the last account cannot be removed');
      verify(id, pin);
      state.accounts = state.accounts.filter((a) => a.id !== id);
      if (state.activeId === id) state.activeId = state.accounts[0].id;
      save();
      rmSync(join(accountsDir, account.dir), { recursive: true, force: true });
      return account;
    },

    claims() {
      const account = active();
      return { sub: account.id, type: account.type, ...(account.type === 'guest' ? {} : { name: account.name }) };
    },
  };
}
