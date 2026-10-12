/**
 * Public HTTPS link for the app (works from any laptop or phone, anywhere).
 *
 *   npm run share:public
 *
 * Serves the production build locally and opens a Cloudflare quick tunnel
 * (https://<random>.trycloudflare.com, no account needed). Safety rails:
 *   • refuses to start while any account still uses the published demo password (run `npm run demo:lock`)
 *   • demo accounts are NOT shown on the login page
 *   • session cookies are Secure (the tunnel is HTTPS end-to-end for visitors)
 * The link is random and stops working as soon as this process is stopped (Ctrl+C).
 */
import fs from 'node:fs';

process.env.NODE_ENV = 'production';
process.env.PORT ??= '8080';
process.env.COOKIE_SECURE = 'true';
process.env.DEMO_MODE = 'false';
process.env.ALLOW_DEMO_SEED = 'false';

const { verifyPassword } = await import('../auth/password');
const { openDatabase } = await import('../db/connection');
const { migrate } = await import('../db/migrate');
const { DEMO_PASSWORD } = await import('../routes/auth');

if (!fs.existsSync('dist/index.html')) {
  console.error('No production build found. Run `npm run build` (or `npx vite build`) first.');
  process.exit(1);
}

// Safety rail: never publish accounts that still use the password printed in the README.
{
  const db = await openDatabase(() => undefined);
  try {
    await migrate(db);
    const users = (await db.system((q) => q.query<{ email: string; password_hash: string }>('select email, password_hash from users where is_active'))).rows;
    const exposed: string[] = [];
    for (const u of users) if (await verifyPassword(DEMO_PASSWORD, u.password_hash)) exposed.push(u.email);
    if (exposed.length) {
      console.error(`\n  Refusing to go public: ${exposed.length} account(s) still use the demo password (e.g. ${exposed[0]}).`);
      console.error('  Run `npm run demo:lock` first — it gives each of them a new private password.\n');
      process.exit(1);
    }
  } finally {
    await db.close();
  }
}

await import('../index'); // start the app server on PORT

const { Tunnel, bin, install } = await import('cloudflared');
if (!fs.existsSync(bin)) {
  console.log('[public] downloading cloudflared (first run only)…');
  await install(bin);
}
const tunnel = Tunnel.quick(`http://localhost:${process.env.PORT}`);
tunnel.once('url', (url) => {
  console.log('\n  ✅ Public link (share this):');
  console.log(`     ${url}`);
  console.log('\n  Sign in with the private credentials in PUBLIC-ACCESS-CREDENTIALS.txt.');
  console.log('  The link stops working when you press Ctrl+C.\n');
});
tunnel.on('error', (err) => console.error('[public] tunnel error:', err.message));
tunnel.on('exit', (code) => {
  console.error(`[public] tunnel closed (code ${code}). The app is still running locally on port ${process.env.PORT}.`);
});
const stop = () => {
  tunnel.stop();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
