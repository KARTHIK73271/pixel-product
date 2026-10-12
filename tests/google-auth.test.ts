import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFakeGoogle, type FakeGoogle, type TokenOverride } from '../server/testing/fake-google';
import { ADMIN, createTestEnv, login, PRIYA, STUDENT, type TestEnv } from './helpers';

const APP = 'http://app.test';
let env: TestEnv;
let fake: FakeGoogle;
const savedEnv = { ...process.env };

beforeAll(async () => {
  fake = await startFakeGoogle({
    clientId: 'test-client.apps.googleusercontent.com',
    clientSecret: 'test-secret',
    accounts: [],
  });
  Object.assign(process.env, fake.env, { GOOGLE_REDIRECT_URI: `${APP}/api/auth/google/callback`, APP_URL: APP });
  env = await createTestEnv();
});

afterAll(async () => {
  await fake.close();
  process.env = savedEnv;
});

afterEach(() => {
  delete process.env.GOOGLE_ALLOWED_DOMAINS;
});

/** Drives the whole browser flow: start → (Google consent) → callback, keeping cookies in one agent. */
async function googleSignIn(email: string, opts: { sub?: string; verified?: boolean; returnTo?: string; token?: TokenOverride; extraStartQuery?: string } = {}) {
  const agent = request.agent(env.app);
  const qs = new URLSearchParams();
  if (opts.returnTo) qs.set('returnTo', opts.returnTo);
  const start = await agent.get(`/api/auth/google/start?${qs}${opts.extraStartQuery ?? ''}`);
  expect(start.status).toBe(303);
  const authUrl = new URL(start.headers.location);
  const approve = new URL(`${fake.url}/authorize/approve`);
  approve.search = authUrl.search;
  approve.searchParams.set('email', email);
  if (opts.sub) approve.searchParams.set('sub', opts.sub);
  if (opts.verified !== undefined) approve.searchParams.set('verified', String(opts.verified));
  if (opts.token) fake.setNextToken(opts.token);
  const consent = await fetch(approve, { redirect: 'manual' });
  const back = new URL(consent.headers.get('location')!);
  const callback = await agent.get(back.pathname + back.search);
  return { agent, start, authUrl, back, callback, location: String(callback.headers.location ?? '') };
}

const sessionCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('ses_sid=') && !c.startsWith('ses_sid=;'));

describe('Google sign-in: configuration & redirect', () => {
  it('advertises Google as available only when configured', async () => {
    expect((await request(env.app).get('/api/auth/providers')).body).toEqual({ password: true, google: true });
    const id = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(env.app).get('/api/auth/providers')).body.google).toBe(false);
    const r = await request(env.app).get('/api/auth/google/start');
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/login?oauth_error=not_configured');
    process.env.GOOGLE_CLIENT_ID = id;
  });

  it('redirects to Google with PKCE, state and nonce, and binds state to the browser', async () => {
    const r = await request(env.app).get('/api/auth/google/start');
    const url = new URL(r.headers.location);
    expect(url.origin + url.pathname).toBe(`${fake.url}/authorize`);
    const p = url.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('scope')).toBe('openid email profile');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get('state')!.length).toBeGreaterThanOrEqual(43);
    expect(p.get('nonce')!.length).toBeGreaterThanOrEqual(43);
    expect(p.get('redirect_uri')).toBe(`${APP}/api/auth/google/callback`);
    expect(r.headers.location).not.toContain('test-secret'); // the client secret never reaches the browser
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/oauth_state=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth\/google/);
  });
});

describe('Google sign-in: role-based landing (role always from the database)', () => {
  it.each([
    [ADMIN, 'ADMIN', '/dashboard'],
    [PRIYA, 'INCHARGE', '/duties'],
    [STUDENT, 'STUDENT', '/my'],
  ])('%s lands on their own dashboard', async (email, role, path) => {
    const { agent, callback, location } = await googleSignIn(email);
    expect(callback.status).toBe(303);
    expect(location).toBe(`${APP}${path}`);
    expect(sessionCookie(callback)).toBeTruthy();
    const me = await agent.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ email, role });
  });

  it('ignores any role the client tries to supply', async () => {
    const { agent, location } = await googleSignIn(STUDENT, { extraStartQuery: '&role=ADMIN' });
    expect(location).toBe(`${APP}/my`);
    expect((await agent.get('/api/auth/me')).body.user.role).toBe('STUDENT');
    expect((await agent.get('/api/dashboard/admin')).status).toBe(403);
    expect((await agent.get('/api/exams')).status).toBe(403);
  });

  it('honours safe return paths and refuses open redirects', async () => {
    expect((await googleSignIn(ADMIN, { returnTo: '/rooms?q=A-101' })).location).toBe(`${APP}/rooms?q=A-101`);
    for (const evil of ['//evil.example', 'https://evil.example', '/\\evil.example', '/api/auth/logout']) {
      expect((await googleSignIn(ADMIN, { returnTo: evil })).location).toBe(`${APP}/dashboard`);
    }
  });

  it('records the Google sign-in in the audit trail and supports logout', async () => {
    const { agent } = await googleSignIn(PRIYA);
    const admin = await login(env.app, ADMIN);
    const events = (await admin.get('/api/audit?action=USER_SIGNED_IN&pageSize=50')).body.items;
    expect(events.some((e: { summary: string; actorName: string }) => e.summary === 'Signed in with Google' && e.actorName === 'Dr. Priya Raman')).toBe(true);
    const out = await agent.post('/api/auth/logout').set('X-Requested-With', 'exam-app');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user).toBeNull();
    expect((await agent.get('/api/duties')).status).toBe(401);
  });

  it('redirects an already signed-in user straight to their dashboard', async () => {
    const { agent } = await googleSignIn(PRIYA);
    const again = await agent.get('/api/auth/google/start');
    expect(again.headers.location).toBe(`${APP}/duties`);
  });
});

describe('Google sign-in: only authorized, pre-registered users', () => {
  it('rejects an unregistered Google account with a clear reason and no session', async () => {
    const { callback, location } = await googleSignIn('stranger@gmail.com');
    expect(location).toBe(`${APP}/login?oauth_error=not_registered&email=stranger%40gmail.com`);
    expect(sessionCookie(callback)).toBeUndefined();
    const admin = await login(env.app, ADMIN);
    const audit = (await admin.get('/api/audit?action=SIGN_IN_REJECTED')).body.items;
    expect(audit[0].summary).toMatch(/stranger@gmail.com/);
  });

  it('rejects disabled accounts', async () => {
    const admin = await login(env.app, ADMIN);
    const users = (await admin.get('/api/users')).body as { id: string; email: string }[];
    const sanjay = users.find((u) => u.email === 'sanjay.verma@exam.local')!;
    expect((await admin.patch(`/api/users/${sanjay.id}`, { isActive: false })).status).toBe(200);
    expect((await googleSignIn('sanjay.verma@exam.local')).location).toBe(`${APP}/login?oauth_error=disabled`);
  });

  it('binds the account to the first Google identity; a different Google account with the same email is refused until unlinked', async () => {
    const email = 'arjun.mehta@exam.local';
    expect((await googleSignIn(email, { sub: 'google-sub-original' })).location).toBe(`${APP}/duties`);
    expect((await googleSignIn(email, { sub: 'google-sub-original' })).location).toBe(`${APP}/duties`);
    expect((await googleSignIn(email, { sub: 'google-sub-impostor' })).location).toBe(`${APP}/login?oauth_error=identity_mismatch`);

    const admin = await login(env.app, ADMIN);
    const staff = (await admin.get('/api/users')).body as { id: string; email: string; googleLinked: boolean }[];
    const arjun = staff.find((u) => u.email === email)!;
    expect(arjun.googleLinked).toBe(true);
    expect((await admin.post(`/api/users/${arjun.id}/unlink-google`)).status).toBe(200);
    expect((await googleSignIn(email, { sub: 'google-sub-new' })).location).toBe(`${APP}/duties`);
    // non-admins cannot unlink
    const priya = await login(env.app, PRIYA);
    expect((await priya.post(`/api/users/${arjun.id}/unlink-google`)).status).toBe(403);
  });

  it('restricts sign-in to allowed Google Workspace domains when configured', async () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = 'university.edu';
    const r = await googleSignIn(ADMIN);
    expect(r.authUrl.searchParams.get('hd')).toBe('university.edu');
    expect(r.location).toBe(`${APP}/login?oauth_error=domain`);
  });

  it('supports Google-only staff accounts and pre-registered students', async () => {
    const admin = await login(env.app, ADMIN);
    const created = await admin.post('/api/users', { email: 'meera.iyer@university.edu', fullName: 'Dr. Meera Iyer', role: 'INCHARGE', password: '' });
    expect(created.status).toBe(201);
    // no password exists, so password sign-in is impossible …
    const pw = await request(env.app).post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email: 'meera.iyer@university.edu', password: 'anything-123' });
    expect(pw.status).toBe(401);
    // … but Google sign-in works and lands on the in-charge dashboard
    expect((await googleSignIn('meera.iyer@university.edu')).location).toBe(`${APP}/duties`);

    const meta = (await admin.get('/api/meta')).body;
    const cse = meta.departments.find((d: { code: string }) => d.code === 'CSE');
    const student = await admin.post('/api/students', {
      rollNo: '23CSE099',
      fullName: 'Nila Shankar',
      email: 'nila.shankar@student.university.edu',
      departmentId: cse.id,
      year: 3,
      section: 'A',
      isActive: true,
    });
    expect(student.status).toBe(201);
    expect((await googleSignIn('nila.shankar@student.university.edu')).location).toMatch(/oauth_error=not_registered/);
    expect((await admin.post(`/api/students/${student.body.id}/login`)).status).toBe(201);
    expect((await admin.post(`/api/students/${student.body.id}/login`)).body.error.code).toBe('ALREADY_ENABLED');
    const { agent, location } = await googleSignIn('nila.shankar@student.university.edu');
    expect(location).toBe(`${APP}/my`);
    const portal = (await agent.get('/api/student/portal')).body;
    expect(portal.profile.rollNo).toBe('23CSE099');
  });
});

describe('Google sign-in: protocol attacks and failures', () => {
  it('maps a cancelled consent screen to a friendly message', async () => {
    const agent = request.agent(env.app);
    const start = await agent.get('/api/auth/google/start');
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const r = await agent.get(`/api/auth/google/callback?error=access_denied&state=${state}`);
    expect(r.headers.location).toBe(`${APP}/login?oauth_error=cancelled`);
  });

  it('rejects a callback whose state is not bound to this browser (login CSRF)', async () => {
    const victim = request.agent(env.app);
    const { back } = await googleSignIn(ADMIN).catch(() => ({ back: null as never }));
    // replay the attacker's callback URL in a different browser (no matching state cookie)
    const r = await victim.get(back.pathname + back.search);
    expect(r.headers.location).toBe(`${APP}/login?oauth_error=state`);
    expect(sessionCookie(r)).toBeUndefined();
  });

  it('consumes each authorization exactly once (no replay)', async () => {
    const { agent, back } = await googleSignIn(ADMIN);
    const replay = await agent.get(back.pathname + back.search);
    expect(replay.headers.location).toBe(`${APP}/login?oauth_error=state`);
  });

  it('expires abandoned authorizations', async () => {
    const agent = request.agent(env.app);
    const start = await agent.get('/api/auth/google/start');
    await env.db.system((q) => q.query(`update oauth_transactions set expires_at = now() - interval '1 minute'`));
    const authUrl = new URL(start.headers.location);
    const approve = new URL(`${fake.url}/authorize/approve`);
    approve.search = authUrl.search;
    approve.searchParams.set('email', ADMIN);
    const back = new URL((await fetch(approve, { redirect: 'manual' })).headers.get('location')!);
    expect((await agent.get(back.pathname + back.search)).headers.location).toBe(`${APP}/login?oauth_error=state`);
  });

  it.each<[string, TokenOverride]>([
    ['a forged signature', { foreignKey: true }],
    ['the wrong audience', { claims: { aud: 'someone-else.apps.googleusercontent.com' } }],
    ['the wrong issuer', { claims: { iss: 'https://evil.example' } }],
    ['an expired token', { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
    ['a mismatched nonce', { claims: { nonce: 'replayed-nonce' } }],
  ])('rejects an ID token with %s', async (_label, token) => {
    const r = await googleSignIn(ADMIN, { token });
    expect(r.location).toBe(`${APP}/login?oauth_error=failed`);
    expect(sessionCookie(r.callback)).toBeUndefined();
  });

  it('rejects Google accounts whose email is not verified', async () => {
    const r = await googleSignIn(ADMIN, { verified: false });
    expect(r.location).toBe(`${APP}/login?oauth_error=unverified_email`);
  });

  it('never accepts a tampered authorization code', async () => {
    const agent = request.agent(env.app);
    const start = await agent.get('/api/auth/google/start');
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const r = await agent.get(`/api/auth/google/callback?code=made-up-code&state=${state}`);
    expect(r.headers.location).toBe(`${APP}/login?oauth_error=failed`);
  });
});
