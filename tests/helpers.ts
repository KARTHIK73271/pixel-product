import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../server/app';
import { createPgliteDatabase, type Database } from '../server/db/index';
import { migrate } from '../server/db/migrate';
import { DEMO_PASSWORD } from '../server/routes/auth';
import { seedDatabase, type SeedResult } from '../server/seed/seed';

export interface TestEnv {
  db: Database;
  app: Express;
  seed: SeedResult;
}

/** Fresh in-memory PostgreSQL (PGlite) with migrations + the demo seed, and the real Express app. */
export async function createTestEnv(dataDir?: string): Promise<TestEnv> {
  const db = createPgliteDatabase(dataDir);
  await migrate(db);
  const seed = await seedDatabase(db);
  return { db, app: createApp(db), seed };
}

/** Authenticated HTTP client that sends the CSRF header on every request. */
export class Client {
  constructor(private agent: ReturnType<typeof request.agent>) {}
  get(url: string) {
    return this.agent.get(url).set('X-Requested-With', 'exam-app');
  }
  post(url: string, body: object = {}) {
    return this.agent.post(url).set('X-Requested-With', 'exam-app').send(body);
  }
  put(url: string, body: object = {}) {
    return this.agent.put(url).set('X-Requested-With', 'exam-app').send(body);
  }
  patch(url: string, body: object = {}) {
    return this.agent.patch(url).set('X-Requested-With', 'exam-app').send(body);
  }
  del(url: string) {
    return this.agent.delete(url).set('X-Requested-With', 'exam-app');
  }
}

export async function login(app: Express, email: string, password = DEMO_PASSWORD): Promise<Client> {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set('X-Requested-With', 'exam-app').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return new Client(agent);
}

export const ADMIN = 'admin@exam.local';
export const PRIYA = 'priya.raman@exam.local';
export const ARJUN = 'arjun.mehta@exam.local';
export const SANJAY = 'sanjay.verma@exam.local';
export const STUDENT = '23cse001@student.exam.local';
export const ECE_STUDENT = '23ece001@student.exam.local';

export async function userId(db: Database, email: string) {
  return (await db.system((q) => q.query<{ id: string }>('select id from users where email = $1', [email]))).rows[0].id;
}
