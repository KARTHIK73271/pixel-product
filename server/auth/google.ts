/**
 * Google Sign-In — OAuth 2.0 Authorization Code flow with PKCE + OpenID Connect.
 *
 *   browser ──GET /api/auth/google/start──▶ API  (creates state, nonce, PKCE verifier; stores them
 *                                               server-side; binds `state` to the browser in an
 *                                               httpOnly cookie) ──302──▶ accounts.google.com
 *   Google ──302 /api/auth/google/callback?code&state──▶ API  (checks the state cookie, consumes the
 *                                               transaction once, exchanges the code with the client
 *                                               secret + verifier, verifies the ID token signature
 *                                               and claims, matches a pre-registered user, creates
 *                                               the normal session) ──302──▶ role dashboard
 *
 * The client secret never leaves the server, Google tokens are discarded after verification
 * (only the stable `sub` is stored), and the role always comes from our database.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Origin of the web app, used for the post-login redirect (defaults to the redirect URI's origin). */
  appUrl: string;
  allowedDomains: string[];
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuers: string[];
}

/** Read lazily so the environment (and tests) can change it without re-importing modules. */
export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    appUrl: (process.env.APP_URL?.trim() || new URL(redirectUri).origin).replace(/\/$/, ''),
    allowedDomains: (process.env.GOOGLE_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
    // Overridable only so automated tests can run against a local fake identity provider.
    authUrl: process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
    jwksUrl: process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: process.env.GOOGLE_ISSUER ? [process.env.GOOGLE_ISSUER] : ['https://accounts.google.com', 'accounts.google.com'],
  };
}

const b64url = (buf: Buffer) => buf.toString('base64url');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function newAuthorization(cfg: GoogleConfig) {
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const codeVerifier = b64url(randomBytes(48)); // 64 chars, within RFC 7636's 43–128
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
  const url = new URL(cfg.authUrl);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    access_type: 'online',
    include_granted_scopes: 'false',
    ...(cfg.allowedDomains.length === 1 ? { hd: cfg.allowedDomains[0] } : {}),
  }).toString();
  return { state, nonce, codeVerifier, url: url.toString() };
}

export class OAuthError extends Error {
  constructor(
    public reason: 'exchange_failed' | 'invalid_token' | 'unverified_email' | 'domain',
    message: string,
  ) {
    super(message);
  }
}

export async function exchangeCode(cfg: GoogleConfig, code: string, codeVerifier: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new OAuthError('exchange_failed', `Token endpoint unreachable: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.id_token) {
    throw new OAuthError('exchange_failed', `Token exchange failed: ${body.error ?? res.status} ${body.error_description ?? ''}`.trim());
  }
  return body.id_token;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
  hostedDomain: string | null;
}

/** Verifies signature (Google JWKS, RS256), issuer, audience, expiry, nonce and email verification. */
export async function verifyIdToken(cfg: GoogleConfig, idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
  if (!jwksCache.has(cfg.jwksUrl)) jwksCache.set(cfg.jwksUrl, createRemoteJWKSet(new URL(cfg.jwksUrl)));
  let payload: JWTPayload & { email?: string; email_verified?: boolean | string; nonce?: string; name?: string; hd?: string };
  try {
    ({ payload } = await jwtVerify(idToken, jwksCache.get(cfg.jwksUrl)!, {
      issuer: cfg.issuers,
      audience: cfg.clientId,
      algorithms: ['RS256'],
      clockTolerance: 30,
    }));
  } catch (err) {
    throw new OAuthError('invalid_token', `ID token rejected: ${(err as Error).message}`);
  }
  if (!payload.nonce || payload.nonce !== expectedNonce) throw new OAuthError('invalid_token', 'ID token nonce mismatch');
  if (!payload.sub || !payload.email) throw new OAuthError('invalid_token', 'ID token is missing sub/email');
  if (payload.email_verified !== true && payload.email_verified !== 'true') {
    throw new OAuthError('unverified_email', 'Google reports this email address as unverified');
  }
  const email = payload.email.toLowerCase();
  if (cfg.allowedDomains.length) {
    const domain = (payload.hd ?? email.split('@')[1] ?? '').toLowerCase();
    if (!cfg.allowedDomains.includes(domain)) throw new OAuthError('domain', `Domain ${domain} is not allowed`);
  }
  return { sub: payload.sub, email, name: payload.name ?? null, hostedDomain: payload.hd ?? null };
}

/** Only same-app relative paths are accepted as post-login destinations (no open redirects). */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/api') || value.startsWith('/login')) return null;
  if (/[\r\n]/.test(value)) return null;
  return value;
}
