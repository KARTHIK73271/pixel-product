import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authenticate } from './auth/session';
import { config } from './config';
import type { Database } from './db/index';
import { AppError, errorHandler } from './http/errors';
import { broadcastMutations } from './http/events';
import { apiRoutes } from './routes/api';
import { authRoutes } from './routes/auth';

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  // Browsers ignore (and warn about) COOP on plain-http LAN addresses, so only send it over HTTPS.
  if (config.cookieSecure) res.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
  }
  next();
}

/**
 * CSRF defence in depth: the session cookie is SameSite=Lax, and every state-changing request
 * must carry a custom header, which cross-site forms cannot set without a CORS preflight
 * (and no CORS is enabled).
 */
function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'exam-app') return next(new AppError(403, 'CSRF', 'Missing request header.'));
  next();
}

export function createApp(db: Database, hooks: { onMutation?: () => void } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(securityHeaders);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: db.kind }));
  app.use('/api', requireCsrfHeader, authenticate(db), (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', broadcastMutations(hooks.onMutation));
  app.use('/api/auth', authRoutes(db));
  app.use('/api', apiRoutes());
  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found')));

  // Production: serve the built SPA.
  const dist = path.resolve('dist');
  if (config.isProd && fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
