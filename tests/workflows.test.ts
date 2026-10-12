import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, ARJUN, createTestEnv, login, PRIYA, SANJAY, userId, type Client, type TestEnv } from './helpers';

let env: TestEnv;
let admin: Client;
let priya: Client;
let arjun: Client;

const count = async (sql: string, params: unknown[] = []) =>
  (await env.db.system((q) => q.query<{ n: number }>(sql, params))).rows[0].n;

beforeAll(async () => {
  env = await createTestEnv();
  admin = await login(env.app, ADMIN);
  priya = await login(env.app, PRIYA);
  arjun = await login(env.app, ARJUN);
});

describe('room capacity', () => {
  it('rejects a seat number beyond room capacity (API and database trigger)', async () => {
    const { mathDraft } = env.seed.exams;
    const studentId = (await env.db.system((q) => q.query<{ student_id: string }>('select student_id from allocations where exam_id = $1 limit 1', [mathDraft]))).rows[0].student_id;
    const r = await admin.post(`/api/exams/${mathDraft}/allocation/seat`, { studentId, roomId: env.seed.rooms['A-102'], seatNo: 31 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('OVER_CAPACITY');

    // bypass the service: the trigger still refuses, even for an admin
    await expect(
      env.db.asUser(env.seed.adminId, (q) =>
        q.query(`update allocations set seat_no = 31 where exam_id = $1 and room_id = $2`, [mathDraft, env.seed.rooms['A-102']]),
      ),
    ).rejects.toThrow(/ERR_OVER_CAPACITY/);
  });

  it('refuses to shrink a room below the highest allocated seat', async () => {
    const roomId = env.seed.rooms['C-301'];
    const r = await admin.put(`/api/rooms/${roomId}`, { roomNo: 'C-301', block: 'Science Block C', floor: 3, capacity: 10, status: 'AVAILABLE' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('CAPACITY_IN_USE');
  });

  it('rejects booking an unavailable (maintenance) room', async () => {
    const r = await admin.put(`/api/exams/${env.seed.exams.osShortage}/rooms`, { roomIds: [env.seed.rooms['B-202'], env.seed.rooms['LH-1']] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ROOM_UNAVAILABLE');
  });
});

describe('insufficient capacity handling', () => {
  it('previews a shortage, seats what fits, and requires acknowledgement to publish', async () => {
    const { osShortage } = env.seed.exams;
    const preview = await admin.post(`/api/exams/${osShortage}/allocation/preview`, { strategy: 'BALANCED', order: 'ROLL' });
    expect(preview.status).toBe(200);
    expect(preview.body.plan.feasible).toBe(false);
    expect(preview.body.totals).toMatchObject({ eligible: 26, allocated: 24, unallocated: 2 });
    expect(preview.body.unallocatedStudents).toHaveLength(2);

    const commit = await admin.post(`/api/exams/${osShortage}/allocation/commit`, {
      strategy: 'BALANCED',
      order: 'ROLL',
      previewHash: preview.body.previewHash,
    });
    expect(commit.status).toBe(200);
    expect(await count('select count(*)::int as n from allocations where exam_id = $1', [osShortage])).toBe(24);

    // the room is now full: a manual seat for an unallocated student must be refused
    const r = await admin.post(`/api/exams/${osShortage}/allocation/seat`, {
      studentId: preview.body.unallocatedStudents[0].id,
      roomId: env.seed.rooms['B-202'],
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('OVER_CAPACITY');

    // publishing is blocked until every occupied room has an in-charge, then until the shortage is acknowledged
    let pub = await admin.post(`/api/exams/${osShortage}/publish`, {});
    expect(pub.body.error.code).toBe('MISSING_INCHARGE');
    const sanjay = await userId(env.db, SANJAY);
    expect((await admin.put(`/api/exams/${osShortage}/incharges`, { assignments: [{ roomId: env.seed.rooms['B-202'], inchargeId: sanjay }] })).status).toBe(200);
    pub = await admin.post(`/api/exams/${osShortage}/publish`, {});
    expect(pub.status).toBe(409);
    expect(pub.body.error.code).toBe('UNALLOCATED_STUDENTS');
    pub = await admin.post(`/api/exams/${osShortage}/publish`, { acknowledgeUnallocated: true });
    expect(pub.status).toBe(200);
  });

  it('rejects a stale preview after the underlying data changed', async () => {
    const { mathDraft } = env.seed.exams;
    const preview = await admin.post(`/api/exams/${mathDraft}/allocation/preview`, { strategy: 'MIN_ROOMS', order: 'ROLL' });
    expect(preview.status).toBe(200);
    expect(preview.body.plan.minRoomsRequired).toBe(1); // 40 students fit in C-301 (50 seats)
    const sid = (await env.db.system((q) => q.query<{ student_id: string }>('select student_id from exam_students where exam_id = $1 limit 1', [mathDraft]))).rows[0].student_id;
    expect((await admin.post(`/api/exams/${mathDraft}/eligible`, { mode: 'remove', studentIds: [sid] })).status).toBe(200);
    const commit = await admin.post(`/api/exams/${mathDraft}/allocation/commit`, { strategy: 'MIN_ROOMS', order: 'ROLL', previewHash: preview.body.previewHash });
    expect(commit.status).toBe(409);
    expect(commit.body.error.code).toBe('PLAN_CHANGED');
    expect((await admin.post(`/api/exams/${mathDraft}/eligible`, { mode: 'add', studentIds: [sid] })).status).toBe(200);
  });
});

describe('allocation uniqueness', () => {
  it('rejects a duplicate allocation of the same student in one examination', async () => {
    const { mathDraft } = env.seed.exams;
    await expect(
      env.db.asUser(env.seed.adminId, async (q) => {
        const a = (await q.query<{ student_id: string }>('select student_id from allocations where exam_id = $1 limit 1', [mathDraft])).rows[0];
        await q.query('insert into allocations (exam_id, student_id, room_id, seat_no) values ($1, $2, $3, 50)', [mathDraft, a.student_id, env.seed.rooms['C-301']]);
      }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'allocations_exam_student_key' });
  });

  it('rejects two students on the same seat, and moving a student never duplicates them', async () => {
    const { mathDraft } = env.seed.exams;
    const rows = (
      await env.db.system((q) =>
        q.query<{ student_id: string; room_id: string; seat_no: number }>(
          'select student_id, room_id, seat_no from allocations where exam_id = $1 order by room_id, seat_no limit 2',
          [mathDraft],
        ),
      )
    ).rows;
    const taken = await admin.post(`/api/exams/${mathDraft}/allocation/seat`, { studentId: rows[1].student_id, roomId: rows[0].room_id, seatNo: rows[0].seat_no });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/seat is already taken/i);

    const free = await admin.post(`/api/exams/${mathDraft}/allocation/seat`, { studentId: rows[1].student_id, roomId: env.seed.rooms['C-301'] });
    expect(free.status).toBe(200);
    expect(await count('select count(*)::int as n from allocations where exam_id = $1 and student_id = $2', [mathDraft, rows[1].student_id])).toBe(1);
  });

  it('handles concurrent allocation requests without duplicate students or seats', async () => {
    const { mathDraft } = env.seed.exams;
    const strategies = ['BALANCED', 'MIN_ROOMS', 'BALANCED', 'MIN_ROOMS', 'BALANCED', 'BALANCED'] as const;
    const results = await Promise.all(
      strategies.map((strategy, i) => admin.post(`/api/exams/${mathDraft}/allocation/commit`, { strategy, order: i % 2 ? 'INTERLEAVE' : 'ROLL' })),
    );
    for (const r of results) expect(r.status).toBe(200);
    const eligible = await count('select count(*)::int as n from exam_students where exam_id = $1', [mathDraft]);
    expect(await count('select count(*)::int as n from allocations where exam_id = $1', [mathDraft])).toBe(eligible);
    expect(await count('select count(distinct student_id)::int as n from allocations where exam_id = $1', [mathDraft])).toBe(eligible);
    expect(
      await count(
        'select count(*)::int as n from (select room_id, seat_no from allocations where exam_id = $1 group by 1, 2 having count(*) > 1) d',
        [mathDraft],
      ),
    ).toBe(0);
  });

  it('enforces the one-exam-per-slot policy for students and rooms', async () => {
    const meta = await admin.get('/api/meta');
    const cs302 = meta.body.courses.find((c: { code: string }) => c.code === 'CS302');
    const cse = meta.body.departments.find((d: { code: string }) => d.code === 'CSE');
    const today = (await env.db.system((q) => q.query<{ d: string }>('select exam_date as d from examinations where id = $1', [env.seed.exams.dbmsToday]))).rows[0].d;
    const created = await admin.post('/api/exams', {
      name: 'Clashing Mid-Semester — Operating Systems',
      examType: 'MIDTERM',
      courseId: cs302.id,
      departmentId: cse.id,
      year: 3,
      section: null,
      examDate: today,
      session: 'FN',
      startTime: '09:30',
      durationMinutes: 90,
      autoEnroll: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    // every CSE year-3 student already sits CS301 in this slot
    expect(created.body.enrolled).toEqual({ added: 0, skippedConflicts: 26 });
    const room = await admin.put(`/api/exams/${created.body.id}/rooms`, { roomIds: [env.seed.rooms['A-101']] });
    expect(room.status).toBe(409);
    expect(room.body.error.message).toMatch(/already booked/i);
  });

  it('rejects a duplicate active examination for the same course, type and section', async () => {
    const exam = (await admin.get(`/api/exams/${env.seed.exams.mathDraft}`)).body.exam;
    const r = await admin.post('/api/exams', {
      name: 'Another MA301 midterm',
      examType: exam.examType,
      courseId: exam.courseId,
      departmentId: null,
      year: 3,
      section: null,
      examDate: exam.examDate,
      session: 'AN',
      startTime: '14:00',
      durationMinutes: 90,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('DUPLICATE');
  });
});

describe('attendance', () => {
  it('rejects submission while students are unmarked; unmarked is never counted as absent', async () => {
    const { dbmsToday } = env.seed.exams;
    const roomId = env.seed.rooms['B-202'];
    const sheet = await arjun.get(`/api/attendance/${dbmsToday}/${roomId}`);
    expect(sheet.body.counts).toEqual({ allocated: 10, present: 5, absent: 1, unmarked: 4 });
    const r = await arjun.post(`/api/attendance/${dbmsToday}/${roomId}/submit`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INCOMPLETE');
    expect(r.body.error.message).toMatch(/4 of 10/);
  });

  it('updates dashboard metrics after attendance changes', async () => {
    const { dbmsToday } = env.seed.exams;
    const roomId = env.seed.rooms['B-202'];
    const before = (await admin.get('/api/dashboard/admin')).body.kpis;
    const sheet = await arjun.get(`/api/attendance/${dbmsToday}/${roomId}`);
    const unmarked = sheet.body.students.filter((s: { status: string | null }) => s.status === null);
    const mark = await arjun.put(`/api/attendance/${dbmsToday}/${roomId}/marks`, {
      marks: unmarked.map((s: { allocationId: string }, i: number) => ({ allocationId: s.allocationId, status: i === 0 ? 'ABSENT' : 'PRESENT' })),
    });
    expect(mark.status).toBe(200);
    expect(mark.body).toEqual({ allocated: 10, present: 8, absent: 2, unmarked: 0 });
    const mid = (await admin.get('/api/dashboard/admin')).body.kpis;
    expect(mid.attendance.marked).toBe(before.attendance.marked + unmarked.length);
    expect(mid.attendance.completion).toBeGreaterThan(before.attendance.completion);

    const submit = await arjun.post(`/api/attendance/${dbmsToday}/${roomId}/submit`);
    expect(submit.status).toBe(200);
    const after = (await admin.get('/api/dashboard/admin')).body.kpis;
    expect(after.pendingRooms).toBe(before.pendingRooms - 1);
    expect(after.attendance.finalPresent).toBe(before.attendance.finalPresent + 8);
    expect(after.attendance.finalAbsent).toBe(before.attendance.finalAbsent + 2);
  });

  it('locks finalized attendance; only an admin can reopen, with a reason, and it is audited', async () => {
    const { dbmsToday } = env.seed.exams;
    const roomId = env.seed.rooms['A-101'];
    const sheet = (await priya.get(`/api/attendance/${dbmsToday}/${roomId}`)).body;
    expect(sheet.submissionStatus).toBe('FINALIZED');
    const target = sheet.students.find((s: { status: string }) => s.status === 'ABSENT');

    const edit = await priya.put(`/api/attendance/${dbmsToday}/${roomId}/marks`, { marks: [{ allocationId: target.allocationId, status: 'PRESENT' }] });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('FINALIZED');
    expect((await admin.put(`/api/attendance/${dbmsToday}/${roomId}/marks`, { marks: [{ allocationId: target.allocationId, status: 'PRESENT' }] })).status).toBe(409);

    // even a direct SQL write by the assigned in-charge is refused by the database
    await expect(
      env.db.asUser(env.seed.incharges.priya, (q) => q.query(`update attendance_records set status = 'PRESENT' where allocation_id = $1`, [target.allocationId])),
    ).rejects.toThrow(/ERR_FINALIZED/);
    await expect(
      env.db.asUser(env.seed.incharges.priya, (q) => q.query(`delete from attendance_records where allocation_id = $1`, [target.allocationId])),
    ).rejects.toThrow(/ERR_FINALIZED/);

    expect((await priya.post(`/api/attendance/${dbmsToday}/${roomId}/reopen`, { reason: 'I would like to change a mark' })).status).toBe(403);
    expect((await admin.post(`/api/attendance/${dbmsToday}/${roomId}/reopen`, { reason: 'short' })).status).toBe(400);
    const reopen = await admin.post(`/api/attendance/${dbmsToday}/${roomId}/reopen`, { reason: 'Student signed the sheet but was marked absent' });
    expect(reopen.status).toBe(200);

    const fix = await priya.put(`/api/attendance/${dbmsToday}/${roomId}/marks`, { marks: [{ allocationId: target.allocationId, status: 'PRESENT' }] });
    expect(fix.status).toBe(200);
    expect((await priya.post(`/api/attendance/${dbmsToday}/${roomId}/submit`)).status).toBe(200);

    const audit = (await admin.get(`/api/audit?examId=${dbmsToday}&pageSize=50`)).body.items.map((e: { action: string }) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['ATTENDANCE_REOPENED', 'ATTENDANCE_CORRECTED', 'ATTENDANCE_FINALIZED']));
  });

  it('protects finalized rooms from reallocation and never destroys attendance', async () => {
    const { cnPast } = env.seed.exams;
    const marksBefore = await count('select count(*)::int as n from attendance_records where exam_id = $1', [cnPast]);
    const r = await admin.post(`/api/exams/${cnPast}/allocation/commit`, { strategy: 'MIN_ROOMS', order: 'ROLL', confirmUnpublish: true });
    expect(r.status).toBe(200);
    expect(r.body.lockedRooms).toHaveLength(2);
    expect(await count('select count(*)::int as n from attendance_records where exam_id = $1', [cnPast])).toBe(marksBefore);
    // and the exam can be published again with its seats intact
    expect((await admin.post(`/api/exams/${cnPast}/publish`, {})).status).toBe(200);
  });
});

describe('absentee reporting', () => {
  it('derives report totals from attendance records', async () => {
    const { cnPast } = env.seed.exams;
    const r = await admin.get(`/api/reports/absentees/${cnPast}`);
    expect(r.status).toBe(200);
    const present = await count(`select count(*)::int as n from attendance_records where exam_id = $1 and status = 'PRESENT'`, [cnPast]);
    const absent = await count(`select count(*)::int as n from attendance_records where exam_id = $1 and status = 'ABSENT'`, [cnPast]);
    const allocated = await count('select count(*)::int as n from allocations where exam_id = $1', [cnPast]);
    expect(r.body.totals).toEqual({ allocated, present, absent, unmarked: allocated - present - absent });
    expect(r.body.absentees).toHaveLength(absent);
    const sum = r.body.rooms.reduce((t: number, x: { absent: number }) => t + x.absent, 0);
    expect(sum).toBe(absent);
    expect(r.body.reportStatus).toBe('FINAL');
    expect(absent).toBeGreaterThan(0);
    expect(present).toBeGreaterThan(0);
  });

  it('marks a report provisional while any room is unfinalized', async () => {
    const r = await admin.get(`/api/reports/absentees/${env.seed.exams.dspToday}`);
    expect(r.body.reportStatus).toBe('PROVISIONAL');
    expect(r.body.totals.unmarked).toBe(14);
    expect(r.body.totals.absent).toBe(0); // unmarked students are not absentees
  });
});
