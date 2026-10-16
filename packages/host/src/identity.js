import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TOKEN_TTL_SECONDS = 300;

/** @param {object | Buffer} part */
const b64url = (part) => Buffer.from(Buffer.isBuffer(part) ? part : JSON.stringify(part)).toString('base64url');

/**
 * @param {string} dir
 * @param {string} issuer
 */
export function createIdentity(dir, issuer) {
  const keyFile = join(dir, 'signing-key.pem');
  const subjectFile = join(dir, 'subject');
  if (!existsSync(keyFile)) {
    mkdirSync(dir, { recursive: true });
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(subjectFile, randomUUID(), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
  }
  const privateKey = createPrivateKey(readFileSync(keyFile));
  const publicKey = createPublicKey(privateKey);
  const subject = readFileSync(subjectFile, 'utf8').trim();
  const kid = sign(null, Buffer.from('kid'), privateKey).subarray(0, 8).toString('hex');
  const accountsFile = join(dir, 'accounts.json');

  const defaultAvatarColors = {
    google: '#ea4335',
    microsoft: '#00a4ef',
    local: '#6366f1',
  };

  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   email: string,
   *   provider: 'google' | 'microsoft' | 'local',
   *   role: string,
   *   avatarColor: string,
   *   active: boolean,
   *   createdAt: string
   * }} Account
   */

  /** @param {Account[]} accs */
  const saveAccounts = (accs) => writeFileSync(accountsFile, JSON.stringify(accs, null, 2), { mode: 0o600 });
  /** @returns {Account[]} */
  const loadAccounts = () => {
    if (existsSync(accountsFile)) {
      try { return JSON.parse(readFileSync(accountsFile, 'utf8')); } catch {}
    }
    /** @type {Account[]} */
    const initial = [
      {
        id: subject,
        name: 'Personal Account',
        email: 'user@localhost',
        provider: 'local',
        role: 'Owner',
        avatarColor: defaultAvatarColors.local,
        active: true,
        createdAt: new Date().toISOString(),
      },
    ];
    saveAccounts(initial);
    return initial;
  };

  /** @type {Account[]} */
  let accounts = loadAccounts();
  const getActive = () => accounts.find((/** @type {Account} */ a) => a.active) ?? accounts[0];

  return {
    publicJwk: () => ({ ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' }),

    listAccounts: () => [...accounts],

    getActiveAccount: () => ({ ...getActive() }),

    /** @param {string} id */
    switchAccount(id) {
      if (!accounts.some((a) => a.id === id)) throw new Error(`account not found: ${id}`);
      accounts = accounts.map((a) => ({ ...a, active: a.id === id }));
      saveAccounts(accounts);
      return { ...getActive() };
    },

    /** @param {{ name: string, email: string, role?: string, provider?: 'google' | 'microsoft' | 'local' }} data */
    addAccount({ name, email, role = 'User', provider = 'local' }) {
      const id = randomUUID();
      const color = defaultAvatarColors[provider] ?? defaultAvatarColors.local;
      const newAcc = {
        id,
        name: String(name),
        email: String(email),
        provider,
        role: String(role),
        avatarColor: color,
        active: true,
        createdAt: new Date().toISOString(),
      };
      accounts = accounts.map((a) => ({ ...a, active: false })).concat(newAcc);
      saveAccounts(accounts);
      return newAcc;
    },

    /** @param {string} id */
    removeAccount(id) {
      if (accounts.length <= 1) throw new Error('cannot remove last account');
      const wasActive = accounts.find((a) => a.id === id)?.active;
      accounts = accounts.filter((a) => a.id !== id);
      if (wasActive) accounts[0].active = true;
      saveAccounts(accounts);
      return { ...getActive() };
    },

    /** @param {string} appId */
    mint(appId, now = Math.floor(Date.now() / 1000)) {
      const current = getActive();
      const header = b64url({ alg: 'EdDSA', typ: 'JWT', kid });
      const payload = b64url({
        iss: issuer,
        sub: current.id,
        name: current.name,
        email: current.email,
        role: current.role,
        provider: current.provider ?? 'local',
        aud: `app:${appId}`,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        jti: randomUUID(),
      });
      const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey);
      return { token: `${header}.${payload}.${b64url(signature)}`, expiresAt: now + TOKEN_TTL_SECONDS };
    },
  };
}

/**
 * @param {string} token
 * @param {import('node:crypto').JsonWebKey} jwk
 * @param {string} audience
 */
export function verifyToken(token, jwk, audience, now = Math.floor(Date.now() / 1000)) {
  const [header, payload, signature] = String(token).split('.');
  if (!header || !payload || !signature) throw new Error('malformed token');
  if (JSON.parse(Buffer.from(header, 'base64url').toString()).alg !== 'EdDSA') throw new Error('unexpected algorithm');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  if (!verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (claims.aud !== audience) throw new Error(`token is for ${claims.aud}`);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('token expired');
  return claims;
}
