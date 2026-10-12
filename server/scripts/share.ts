/**
 * Share the app with other laptops on the same network (Wi-Fi / hotspot / LAN).
 *
 *   npm run share            → builds the optimised app, then serves app + API on one port
 *
 * Production build (fast to load), demo accounts shown on the login page, plain-HTTP cookies
 * (there is no HTTPS on a LAN address). Intended for demos and evaluation, not public hosting.
 */
import os from 'node:os';

process.env.NODE_ENV = 'production';
process.env.PORT ??= '8080';
process.env.COOKIE_SECURE ??= 'false'; // LAN addresses are plain http
process.env.DEMO_MODE ??= 'true'; // show the demo accounts on the login page
process.env.ALLOW_DEMO_SEED ??= 'true'; // first run on a new laptop loads the demo data

const port = process.env.PORT;
await import('./setup'); // migrate + seed only if empty
await import('../index'); // start the server (serves ./dist and /api)

const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
  .map((i) => `http://${i.address}:${port}`);

console.log('\n  Smart Examination Section is being shared');
console.log(`  • On this laptop:      http://localhost:${port}`);
for (const url of lan) console.log(`  • On other devices:    ${url}`);
console.log('\n  Other laptops must be on the same Wi-Fi / hotspot. Press Ctrl+C to stop sharing.\n');
