/**
 * TEST-ONLY fake of Google's OAuth 2.0 / OIDC endpoints (authorize, token, JWKS).
 * Used by the Vitest suites and the Playwright E2E server so the complete sign-in flow — redirects,
 * state cookie, PKCE, code exchange, RS256 signature verification — runs without real Google
 * credentials. Never imported by the production server entry point.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

export interface FakeAccount {
  email: string;
  name: string;
  sub?: string;
  emailVerified?: boolean;
}

interface PendingCode {
  email: string;
  name: string;
  sub: string;
  emailVerified: boolean;
  nonce: string;
  redirectUri: string;
  codeChallenge: string;
  clientId: string;
}

export interface TokenOverride {
  claims?: Record<string, unknown>;
  /** Sign with a key that is NOT published in the JWKS (forged token). */
  foreignKey?: boolean;
}

const subFor = (email: string) => createHash('sha256').update(`fake-google:${email}`).digest('hex').slice(0, 21);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startFakeGoogle(opts: { port?: number; clientId: string; clientSecret: string; accounts: FakeAccount[] }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fake-key-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  const state = { nextToken: null as TokenOverride | null, accounts: opts.accounts };
  let issuer = '';

  const app = express();
  app.use(express.urlencoded({ extended: false }));

  app.get('/authorize', (req, res) => {
    const q = req.query as Record<string, string>;
    if (q.client_id !== opts.clientId) return res.status(400).send('invalid_client');
    if (q.response_type !== 'code' || q.code_challenge_method !== 'S256' || !q.code_challenge || !q.redirect_uri || !q.state || !q.nonce) {
      return res.status(400).send('invalid_request');
    }
    const params = new URLSearchParams(q);
    const cancel = `${q.redirect_uri}?${new URLSearchParams({ error: 'access_denied', state: q.state })}`;
    res.type('html').send(`<!doctype html><html><head><title>Fake Google — test only</title></head>
      <body style="font-family:system-ui;max-width:420px;margin:60px auto">
      <h1 style="font-size:20px">Choose an account</h1><p>Fake Google identity provider (automated tests only)</p>
      ${state.accounts
        .map(
          (a) =>
            `<p><a data-account="${esc(a.email)}" href="/authorize/approve?${params}&amp;email=${encodeURIComponent(a.email)}">${esc(a.name)} &lt;${esc(a.email)}&gt;</a></p>`,
        )
        .join('')}
      <p><a id="cancel" href="${esc(cancel)}">Cancel</a></p></body></html>`);
  });

  app.get('/authorize/approve', (req, res) => {
    const q = req.query as Record<string, string>;
    const account = state.accounts.find((a) => a.email === q.email) ?? { email: q.email, name: q.email };
    const code = randomBytes(24).toString('base64url');
    codes.set(code, {
      email: account.email,
      name: account.name,
      sub: q.sub ?? account.sub ?? subFor(account.email),
      emailVerified: q.verified ? q.verified === 'true' : (account.emailVerified ?? true),
      nonce: q.nonce,
      redirectUri: q.redirect_uri,
      codeChallenge: q.code_challenge,
      clientId: q.client_id,
    });
    res.redirect(302, `${q.redirect_uri}?${new URLSearchParams({ code, state: q.state })}`);
  });

  app.post('/token', async (req, res) => {
    const b = req.body as Record<string, string>;
    if (b.client_id !== opts.clientId || b.client_secret !== opts.clientSecret) return res.status(401).json({ error: 'invalid_client' });
    if (b.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
    const pending = codes.get(b.code);
    codes.delete(b.code); // single use
    if (!pending) return res.status(400).json({ error: 'invalid_grant', error_description: 'unknown or used code' });
    if (pending.redirectUri !== b.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    const challenge = createHash('sha256').update(b.code_verifier ?? '').digest('base64url');
    if (challenge !== pending.codeChallenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });

    const override = state.nextToken;
    state.nextToken = null;
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      email: pending.email,
      email_verified: pending.emailVerified,
      name: pending.name,
      nonce: pending.nonce,
      ...(override?.claims ?? {}),
    };
    const key: KeyLike = override?.foreignKey ? foreign.privateKey : privateKey;
    const idToken = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'fake-key-1', typ: 'JWT' })
      .setIssuer((override?.claims?.iss as string) ?? issuer)
      .setAudience((override?.claims?.aud as string) ?? pending.clientId)
      .setSubject(pending.sub)
      .setIssuedAt(now)
      .setExpirationTime((override?.claims?.exp as number) ?? now + 3600)
      .sign(key);
    res.json({ access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 3600, id_token: idToken, scope: 'openid email profile' });
  });

  app.get('/jwks', (_req, res) => res.json({ keys: [jwk] }));

  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(opts.port ?? 0, () => resolve(s));
  });
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  issuer = url;

  return {
    url,
    issuer,
    env: {
      GOOGLE_CLIENT_ID: opts.clientId,
      GOOGLE_CLIENT_SECRET: opts.clientSecret,
      GOOGLE_AUTH_URL: `${url}/authorize`,
      GOOGLE_TOKEN_URL: `${url}/token`,
      GOOGLE_JWKS_URL: `${url}/jwks`,
      GOOGLE_ISSUER: url,
    },
    /** Make the next issued ID token misbehave (wrong audience, expired, forged signature, …). */
    setNextToken(o: TokenOverride) {
      state.nextToken = o;
    },
    setAccounts(accounts: FakeAccount[]) {
      state.accounts = accounts;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type FakeGoogle = Awaited<ReturnType<typeof startFakeGoogle>>;
