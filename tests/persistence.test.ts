import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createPgliteDatabase } from '../server/db/index';
import { acquireDataDirLock } from '../server/db/lock';
import { migrate } from '../server/db/migrate';
import { ADMIN, createTestEnv, login } from './helpers';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-persist-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('persistence', () => {
  it('keeps records across a full database restart', async () => {
    const dir = path.join(tmp, 'db');
    const env = await createTestEnv(dir);
    const admin = await login(env.app, ADMIN);
    const created = await admin.post('/api/rooms', { roomNo: 'P-101', block: 'Persistence Block', capacity: 33, status: 'AVAILABLE' });
    expect(created.status).toBe(201);
    const before = (await admin.get('/api/dashboard/admin')).body.kpis;
    await env.db.close();

    // "refresh": a brand-new process-level database handle over the same directory
    const db2 = createPgliteDatabase(dir);
    await migrate(db2);
    const app2 = createApp(db2);
    const admin2 = await login(app2, ADMIN);
    const rooms = (await admin2.get('/api/rooms')).body as { roomNo: string; capacity: number }[];
    expect(rooms.find((r) => r.roomNo === 'P-101')?.capacity).toBe(33);
    const after = (await admin2.get('/api/dashboard/admin')).body.kpis;
    expect(after.allocated).toBe(before.allocated);
    expect(after.attendance).toEqual(before.attendance);
    const audit = (await admin2.get('/api/audit?action=ROOM_CREATED')).body.items;
    expect(audit[0].summary).toMatch(/P-101/);
    await db2.close();
  });

  it('allows only one process to own an embedded database directory', async () => {
    const dir = path.join(tmp, 'locked');
    const release = await acquireDataDirLock(dir);
    await expect(acquireDataDirLock(dir, 400)).rejects.toThrow(/in use by process/);
    release();
    const again = await acquireDataDirLock(dir, 400);
    again();
  });

  it('takes over a stale lock left by a crashed process', async () => {
    const dir = path.join(tmp, 'stale');
    fs.writeFileSync(`${dir}.lock`, '999999'); // a PID that is not running
    const release = await acquireDataDirLock(dir, 400);
    expect(fs.readFileSync(`${dir}.lock`, 'utf8')).toBe(String(process.pid));
    release();
    expect(fs.existsSync(`${dir}.lock`)).toBe(false);
  });
});
