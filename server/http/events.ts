import type { NextFunction, Request, Response } from 'express';

/**
 * Server-Sent Events change feed. Messages carry only a coarse topic and a timestamp —
 * never record data — so broadcasting to every authenticated client leaks nothing; each
 * client simply refetches through the normal, authorized API.
 */
const clients = new Set<Response>();

export function eventStream(req: Request, res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`retry: 3000\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(topic: string) {
  const payload = `event: change\ndata: ${JSON.stringify({ topic, at: Date.now() })}\n\n`;
  for (const c of clients) c.write(payload);
}

/** After any successful mutating API call, notify connected clients (and the optional hook). */
export function broadcastMutations(onMutation?: () => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.path.endsWith('/preview')) {
      res.on('finish', () => {
        if (res.statusCode >= 400) return;
        onMutation?.();
        if (!req.path.startsWith('/auth')) broadcast(req.path.split('/')[1] ?? 'data');
      });
    }
    next();
  };
}
