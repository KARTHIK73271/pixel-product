/**
 * DEVELOPMENT-ONLY demo seed. Creates realistic reference data, then drives the real service
 * layer (as the admin / in-charge users, under Row-Level Security) to build examinations,
 * allocations, publications and attendance — so the seed exercises every constraint and trigger.
 *
 * All demo accounts share one password (see DEMO_PASSWORD). Never run against production.
 */
import type { AuthUser } from '../auth/session';
import { hashPassword } from '../auth/password';
import type { Database, Queryable } from '../db/index';
import { mapDatabaseError } from '../http/errors';
import { DEMO_PASSWORD } from '../routes/auth';
import { commitAllocation } from '../services/allocation';
import { finalizeRoom, recordMarks } from '../services/attendance';
import { changeEligible, createExam, publishExam, setExamRooms, setIncharges } from '../services/exams';
import { todayIso } from '../services/sql';

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const CSE_A = [
  'Aarav Sharma', 'Diya Patel', 'Vihaan Reddy', 'Ananya Iyer', 'Arjun Nair', 'Ishita Gupta', 'Kabir Singh',
  'Meera Krishnan', 'Rohan Das', 'Saanvi Menon', 'Aditya Rao', 'Kavya Pillai', 'Reyansh Joshi', 'Tara Bhat',
];
const CSE_B = [
  'Nikhil Varma', 'Pooja Hegde', 'Siddharth Kulkarni', 'Neha Chatterjee', 'Yash Malhotra', 'Riya Banerjee',
  'Karan Mehra', 'Sneha Raghavan', 'Dev Anand', 'Lakshmi Prasad', 'Om Prakash', 'Zara Khan',
];
const ECE_A = [
  'Aditi Kapoor', 'Harsh Vardhan', 'Nandini Rao', 'Pranav Shetty', 'Shreya Ghosh', 'Varun Bhatia', 'Anjali Mishra',
  'Rahul Dubey', 'Tanvi Desai', 'Manav Arora', 'Ira Sen', 'Vivek Tiwari', 'Gauri Kamath', 'Rudra Sinha',
];

export interface SeedResult {
  adminId: string;
  incharges: { priya: string; arjun: string; sanjay: string };
  exams: Record<'dbmsToday' | 'dspToday' | 'mathDraft' | 'osShortage' | 'cnPast', string>;
  rooms: Record<string, string>;
  studentUserEmail: string;
}

export async function seedDatabase(db: Database, log: (m: string) => void = () => undefined): Promise<SeedResult> {
  const existing = await db.system((q) => q.query<{ n: number }>('select count(*)::int as n from users'));
  if (existing.rows[0].n > 0) throw new Error('Database already contains data. Run `npm run db:reset` to start fresh.');

  const today = todayIso();
  const hash = await hashPassword(DEMO_PASSWORD); // one hash reused for all demo accounts (dev only)

  // ------------------------------------------------------------ reference data (privileged)
  const base = await db.system(async (q) => {
    const ins = async (sql: string, params: unknown[]) => (await q.query<{ id: string }>(sql, params)).rows[0].id;
    const dept = {
      CSE: await ins(`insert into departments (code, name) values ('CSE', 'Computer Science & Engineering') returning id`, []),
      ECE: await ins(`insert into departments (code, name) values ('ECE', 'Electronics & Communication Engineering') returning id`, []),
      MATH: await ins(`insert into departments (code, name) values ('MATH', 'Mathematics') returning id`, []),
    };
    const user = (email: string, name: string, role: string) =>
      ins('insert into users (email, password_hash, role, full_name) values ($1, $2, $3, $4) returning id', [email, hash, role, name]);
    const adminId = await user('admin@exam.local', 'Dr. Kavitha Subramanian', 'ADMIN');
    const priya = await user('priya.raman@exam.local', 'Dr. Priya Raman', 'INCHARGE');
    const arjun = await user('arjun.mehta@exam.local', 'Prof. Arjun Mehta', 'INCHARGE');
    const sanjay = await user('sanjay.verma@exam.local', 'Mr. Sanjay Verma', 'INCHARGE');

    const addStudents = async (names: string[], deptCode: 'CSE' | 'ECE', section: string, startNo: number) => {
      for (const [i, name] of names.entries()) {
        const roll = `23${deptCode}${String(startNo + i).padStart(3, '0')}`;
        const email = `${roll.toLowerCase()}@student.exam.local`;
        const uid = await user(email, name, 'STUDENT');
        await q.query(
          `insert into students (user_id, roll_no, full_name, email, department_id, year, section) values ($1, $2, $3, $4, $5, 3, $6)`,
          [uid, roll, name, email, dept[deptCode], section],
        );
      }
    };
    await addStudents(CSE_A, 'CSE', 'A', 1);
    await addStudents(CSE_B, 'CSE', 'B', 15);
    await addStudents(ECE_A, 'ECE', 'A', 1);

    const course = (code: string, name: string, d: string, credits = 3) =>
      ins('insert into courses (code, name, department_id, year, credits) values ($1, $2, $3, 3, $4) returning id', [code, name, d, credits]);
    const courses = {
      CS301: await course('CS301', 'Database Management Systems', dept.CSE, 4),
      CS302: await course('CS302', 'Operating Systems', dept.CSE, 4),
      CS303: await course('CS303', 'Computer Networks', dept.CSE),
      EC301: await course('EC301', 'Digital Signal Processing', dept.ECE, 4),
      MA301: await course('MA301', 'Probability & Statistics', dept.MATH),
    };

    const room = (no: string, block: string, floor: number, cap: number, status = 'AVAILABLE', notes: string | null = null) =>
      ins('insert into rooms (room_no, block, floor, capacity, status, notes) values ($1, $2, $3, $4, $5, $6) returning id', [
        no, block, floor, cap, status, notes,
      ]);
    const rooms = {
      'A-101': await room('A-101', 'Academic Block A', 1, 40),
      'A-102': await room('A-102', 'Academic Block A', 1, 30),
      'B-201': await room('B-201', 'Academic Block B', 2, 60),
      'B-202': await room('B-202', 'Academic Block B', 2, 24),
      'C-301': await room('C-301', 'Science Block C', 3, 50),
      'LH-1': await room('LH-1', 'Lecture Hall Complex', 0, 120, 'MAINTENANCE', 'Projector and seating repair until further notice'),
    };
    return { dept, adminId, priya, arjun, sanjay, courses, rooms };
  });
  log('reference data: 3 departments, 44 users, 40 students, 5 courses, 6 rooms');

  const asAdmin = <T>(fn: (q: Queryable) => Promise<T>) => db.asUser(base.adminId, fn);
  const admin = base.adminId;
  const authOf = (id: string, role: 'INCHARGE' | 'ADMIN'): AuthUser => ({ id, role, email: '', fullName: '', studentId: null });

  // ------------------------------------------------------------ examinations (via services)
  const mkExam = async (input: Parameters<typeof createExam>[1]) => (await asAdmin((q) => createExam(q, input, admin))).id;

  const dbmsToday = await mkExam({
    name: 'Mid-Semester Examination — Database Management Systems', examType: 'MIDTERM', courseId: base.courses.CS301,
    departmentId: base.dept.CSE, year: 3, section: null, examDate: today, session: 'FN', startTime: '09:30',
    durationMinutes: 120, autoEnroll: true,
  });
  const dspToday = await mkExam({
    name: 'Mid-Semester Examination — Digital Signal Processing', examType: 'MIDTERM', courseId: base.courses.EC301,
    departmentId: base.dept.ECE, year: 3, section: null, examDate: today, session: 'AN', startTime: '14:00',
    durationMinutes: 120, autoEnroll: true,
  });
  const mathDraft = await mkExam({
    name: 'Mid-Semester Examination — Probability & Statistics', examType: 'MIDTERM', courseId: base.courses.MA301,
    departmentId: null, year: 3, section: null, examDate: addDays(today, 3), session: 'FN', startTime: '10:00',
    durationMinutes: 180, autoEnroll: true,
  });
  const osShortage = await mkExam({
    name: 'End-Semester Examination — Operating Systems', examType: 'END_SEMESTER', courseId: base.courses.CS302,
    departmentId: base.dept.CSE, year: 3, section: null, examDate: addDays(today, 10), session: 'AN', startTime: '14:00',
    durationMinutes: 180, autoEnroll: true,
  });
  // A past examination cannot be created through the API (date validation), so insert it directly.
  const cnPast = await db.system(async (q) => {
    const id = (
      await q.query<{ id: string }>(
        `insert into examinations (name, exam_type, course_id, department_id, year, exam_date, session, start_time, duration_minutes, created_by, created_at)
         values ('Internal Assessment — Computer Networks', 'INTERNAL', $1, $2, 3, $3, 'FN', '10:00', 90, $4, now() - interval '12 days') returning id`,
        [base.courses.CS303, base.dept.CSE, addDays(today, -5), admin],
      )
    ).rows[0].id;
    return id;
  });
  await asAdmin((q) => changeEligible(q, cnPast, { mode: 'criteria' }));
  log('examinations: 5 created with eligible students enrolled by cohort');

  // ------------------------------------------------------------ rooms, in-charges, allocation
  const R = base.rooms;
  await asAdmin(async (q) => {
    await setExamRooms(q, dbmsToday, [R['A-101'], R['B-202']]);
    await setExamRooms(q, dspToday, [R['B-201'], R['B-202']]);
    await setExamRooms(q, mathDraft, [R['C-301'], R['A-102']]);
    await setExamRooms(q, osShortage, [R['B-202']]); // 26 eligible, 24 seats → capacity shortage warning
    await setExamRooms(q, cnPast, [R['A-101'], R['A-102']]);
  });
  await asAdmin(async (q) => {
    await commitAllocation(q, dbmsToday, { strategy: 'BALANCED', order: 'ROLL' }, admin);
    await commitAllocation(q, dspToday, { strategy: 'MIN_ROOMS', order: 'ROLL' }, admin); // picks B-202 only
    await commitAllocation(q, mathDraft, { strategy: 'BALANCED', order: 'INTERLEAVE' }, admin);
    await commitAllocation(q, cnPast, { strategy: 'BALANCED', order: 'ROLL' }, admin);
  });
  await asAdmin(async (q) => {
    // A-101 for CS301 is a two-faculty hall (Priya + Sanjay); the rest have one in-charge.
    await setIncharges(q, dbmsToday, [{ roomId: R['A-101'], inchargeIds: [base.priya, base.sanjay] }, { roomId: R['B-202'], inchargeIds: [base.arjun] }], admin);
    await setIncharges(q, dspToday, [{ roomId: R['B-202'], inchargeIds: [base.arjun] }], admin);
    await setIncharges(q, mathDraft, [{ roomId: R['C-301'], inchargeIds: [base.priya] }, { roomId: R['A-102'], inchargeIds: [base.arjun] }], admin);
    await setIncharges(q, cnPast, [{ roomId: R['A-101'], inchargeIds: [base.priya] }, { roomId: R['A-102'], inchargeIds: [base.arjun] }], admin);
  });
  await asAdmin(async (q) => {
    await publishExam(q, cnPast, false, admin);
    await publishExam(q, dbmsToday, false, admin);
    await publishExam(q, dspToday, false, admin);
  });
  log('allocations: 4 committed (balanced, minimum-rooms, interleaved); 3 published; 1 left as draft');

  // ------------------------------------------------------------ attendance (as the in-charges)
  const markRoom = async (inchargeId: string, examId: string, roomId: string, opts: { absentEvery: number; limit?: number; finalize: boolean }) => {
    const user = authOf(inchargeId, 'INCHARGE');
    await db.asUser(inchargeId, async (q) => {
      const allocs = (
        await q.query<{ id: string }>('select id from allocations where exam_id = $1 and room_id = $2 order by seat_no', [examId, roomId])
      ).rows;
      const subset = allocs.slice(0, opts.limit ?? allocs.length);
      await recordMarks(
        q, user, examId, roomId,
        subset.map((a, i) => ({ allocationId: a.id, status: (i + 1) % opts.absentEvery === 0 ? 'ABSENT' : 'PRESENT' })),
      );
      if (opts.finalize) await finalizeRoom(q, user, examId, roomId);
    });
  };
  await markRoom(base.priya, cnPast, R['A-101'], { absentEvery: 7, finalize: true });
  await markRoom(base.arjun, cnPast, R['A-102'], { absentEvery: 5, finalize: true });
  await markRoom(base.priya, dbmsToday, R['A-101'], { absentEvery: 6, finalize: true });
  await markRoom(base.arjun, dbmsToday, R['B-202'], { absentEvery: 4, limit: 6, finalize: false }); // incomplete
  log('attendance: 3 rooms finalized, 1 room in progress (incomplete), 1 exam not started');

  return {
    adminId: base.adminId,
    incharges: { priya: base.priya, arjun: base.arjun, sanjay: base.sanjay },
    exams: { dbmsToday, dspToday, mathDraft, osShortage, cnPast },
    rooms: R,
    studentUserEmail: '23cse001@student.exam.local',
  };
}

/** Demonstrates that the database rejects invalid operations (each attempt is rolled back). */
export async function runSeedSelfCheck(db: Database, seed: SeedResult, log: (m: string) => void) {
  const ROLLBACK = Symbol('rollback');
  const attempt = async (label: string, userId: string, fn: (q: Queryable) => Promise<unknown>) => {
    try {
      await db.asUser(userId, async (q) => {
        await fn(q);
        throw ROLLBACK;
      });
    } catch (err) {
      if (err === ROLLBACK) return log(`  ✗ ${label}: unexpectedly allowed`);
      const msg = mapDatabaseError(err)?.message ?? (err as Error).message;
      return log(`  ✓ ${label} → rejected: ${msg}`);
    }
  };
  log('validation self-check (all attempts rolled back):');
  await attempt('Book room LH-1 (under maintenance)', seed.adminId, (q) => setExamRooms(q, seed.exams.osShortage, [seed.rooms['LH-1']]));
  await attempt('Seat a student twice in one exam', seed.adminId, async (q) => {
    const a = (await q.query<{ student_id: string }>('select student_id from allocations where exam_id = $1 limit 1', [seed.exams.mathDraft])).rows[0];
    await q.query(`insert into allocations (exam_id, student_id, room_id, seat_no) values ($1, $2, $3, 49)`, [
      seed.exams.mathDraft, a.student_id, seed.rooms['C-301'],
    ]);
  });
  await attempt('Seat beyond room capacity (seat 31 in A-102)', seed.adminId, async (q) => {
    await q.query(`update allocations set seat_no = 31 where id = (select id from allocations where exam_id = $1 and room_id = $2 limit 1)`, [
      seed.exams.mathDraft, seed.rooms['A-102'],
    ]);
  });
  await attempt('Assign a 3rd faculty to hall A-101 (max 2)', seed.adminId, (q) =>
    q.query(
      `insert into incharge_assignments (exam_id, room_id, incharge_id, exam_date, session, exam_active)
       select exam_id, room_id, $3, exam_date, session, exam_active from exam_rooms where exam_id = $1 and room_id = $2`,
      [seed.exams.dbmsToday, seed.rooms['A-101'], seed.incharges.arjun],
    ),
  );
  await attempt('Enrol an ECE student in the CSE-only OS exam', seed.adminId, async (q) => {
    const ece = (await q.query<{ id: string }>(`select s.id from students s join departments d on d.id = s.department_id where d.code = 'ECE' limit 1`)).rows[0];
    await changeEligible(q, seed.exams.osShortage, { mode: 'add', studentIds: [ece.id] });
  });
  await attempt('Finalize B-202 with unmarked students', seed.incharges.arjun, (q) =>
    finalizeRoom(q, { id: seed.incharges.arjun, role: 'INCHARGE', email: '', fullName: '', studentId: null }, seed.exams.dbmsToday, seed.rooms['B-202']),
  );
  await attempt('Edit finalized attendance in A-101', seed.incharges.priya, async (q) => {
    const r = await q.query(`update attendance_records set status = 'PRESENT' where exam_id = $1 and room_id = $2 and status = 'ABSENT'`, [
      seed.exams.dbmsToday, seed.rooms['A-101'],
    ]);
    if (r.rowCount === 0) throw new Error('no rows visible/updatable');
  });
}
