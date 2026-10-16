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
  return {
    publicJwk: () => ({ ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' }),

    getSubject: () => subject,

    /**
     * @param {string} appId
     * @param {{ sub: string, type: string, name?: string, email?: string }} [account]
     */
    mint(appId, account, now = Math.floor(Date.now() / 1000)) {
      const header = b64url({ alg: 'EdDSA', typ: 'JWT', kid });
      const payload = b64url({
        iss: issuer,
        sub: account?.sub ?? subject,
        ...(account ? { type: account.type, ...(account.name ? { name: account.name } : {}), ...(account.email ? { email: account.email } : {}) } : {}),
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
