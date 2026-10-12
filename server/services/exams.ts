import type { z } from 'zod';
import type { ExamInput, examListQuerySchema } from '../../shared/schemas';
import type { Queryable } from '../db/index';
import { badRequest, conflict, notFound } from '../http/errors';
import { audit } from './audit';
import { Params, todayIso } from './sql';

export interface ExamRow {
  id: string;
  name: string;
  examType: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  departmentId: string | null;
  departmentCode: string | null;
  departmentName: string | null;
  year: number;
  section: string | null;
  examDate: string;
  session: 'FN' | 'AN';
  startTime: string;
  durationMinutes: number;
  status: 'DRAFT' | 'ALLOCATED' | 'PUBLISHED';
  isActive: boolean;
  publishedAt: string | null;
  eligibleCount: number;
  allocatedCount: number;
  roomCount: number;
  capacity: number;
  finalizedRooms: number;
}

const EXAM_COLUMNS = `
  e.id, e.name, e.exam_type as "examType", e.course_id as "courseId", c.code as "courseCode", c.name as "courseName",
  e.department_id as "departmentId", d.code as "departmentCode", d.name as "departmentName",
  e.year, e.section, e.exam_date as "examDate", e.session, to_char(e.start_time, 'HH24:MI') as "startTime",
  e.duration_minutes as "durationMinutes", e.status, e.is_active as "isActive", e.published_at as "publishedAt",
  (select count(*) from exam_students es where es.exam_id = e.id)::int as "eligibleCount",
  (select count(*) from allocations a where a.exam_id = e.id)::int as "allocatedCount",
  (select count(*) from exam_rooms er where er.exam_id = e.id)::int as "roomCount",
  (select coalesce(sum(r.capacity), 0) from exam_rooms er join rooms r on r.id = er.room_id
     where er.exam_id = e.id and r.status = 'AVAILABLE')::int as capacity,
  (select count(*) from attendance_submissions s where s.exam_id = e.id and s.status = 'FINALIZED')::int as "finalizedRooms"`;

const EXAM_FROM = `examinations e join courses c on c.id = e.course_id left join departments d on d.id = e.department_id`;

export async function listExams(q: Queryable, f: z.output<typeof examListQuerySchema>) {
  const b = new Params();
  const where: string[] = [];
  if (f.active !== 'all') where.push(`e.is_active = ${b.p(f.active === 'true')}`);
  if (f.q) {
    const like = b.p(`%${f.q}%`);
    where.push(`(e.name ilike ${like} or c.code ilike ${like} or c.name ilike ${like})`);
  }
  if (f.status) where.push(`e.status = ${b.p(f.status)}`);
  if (f.departmentId) where.push(`e.department_id = ${b.p(f.departmentId)}`);
  if (f.session) where.push(`e.session = ${b.p(f.session)}`);
  if (f.from) where.push(`e.exam_date >= ${b.p(f.from)}::date`);
  if (f.to) where.push(`e.exam_date <= ${b.p(f.to)}::date`);
  const order =
    f.sort === 'date_desc'
      ? 'e.exam_date desc, e.session desc, e.name'
      : f.sort === 'name'
        ? 'e.name, e.exam_date'
        : 'e.exam_date asc, e.session asc, e.name';
  const limit = b.p(f.pageSize);
  const offset = b.p((f.page - 1) * f.pageSize);
  const r = await q.query<ExamRow & { total: number }>(
    `select ${EXAM_COLUMNS}, count(*) over ()::int as total
       from ${EXAM_FROM}
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by ${order}
      limit ${limit} offset ${offset}`,
    b.values,
  );
  return {
    items: r.rows.map(({ total: _t, ...row }) => row),
    total: r.rows[0]?.total ?? 0,
    page: f.page,
    pageSize: f.pageSize,
  };
}

export async function getExamRow(q: Queryable, examId: string): Promise<ExamRow> {
  const r = await q.query<ExamRow>(`select ${EXAM_COLUMNS} from ${EXAM_FROM} where e.id = $1`, [examId]);
  if (!r.rows[0]) throw notFound('Examination');
  return r.rows[0];
}

/** Locks the examination row for the remainder of the transaction (serialises writers). */
export async function lockExam(q: Queryable, examId: string) {
  const r = await q.query<{ id: string; status: string; is_active: boolean; name: string; exam_date: string }>(
    'select id, status, is_active, name, exam_date from examinations where id = $1 for update',
    [examId],
  );
  if (!r.rows[0]) throw notFound('Examination');
  return r.rows[0];
}

function assertEditable(exam: { status: string; is_active: boolean }, what: string) {
  if (!exam.is_active) throw conflict('EXAM_INACTIVE', `This examination is deactivated; reactivate it to change ${what}.`);
  if (exam.status === 'PUBLISHED')
    throw conflict('EXAM_PUBLISHED', `This examination is published. Unpublish it before changing ${what}.`);
}

export async function getExamDetail(q: Queryable, examId: string) {
  const exam = await getExamRow(q, examId);
  const rooms = await q.query(
    `select r.id, r.room_no as "roomNo", r.block, r.floor, r.capacity, r.status,
            (select count(*) from allocations a where a.exam_id = er.exam_id and a.room_id = r.id)::int as allocated,
            (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = r.id)::int as marked,
            (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = r.id and ar.status = 'PRESENT')::int as present,
            (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = r.id and ar.status = 'ABSENT')::int as absent,
            ia.incharge_id as "inchargeId", app.staff_name(ia.incharge_id) as "inchargeName",
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus", s.finalized_at as "finalizedAt",
            s.reopened_count as "reopenedCount"
       from exam_rooms er
       join rooms r on r.id = er.room_id
       left join incharge_assignments ia on ia.exam_id = er.exam_id and ia.room_id = er.room_id
       left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
      where er.exam_id = $1
      order by r.room_no`,
    [examId],
  );
  const students = await q.query(
    `select s.id, s.roll_no as "rollNo", s.full_name as "fullName", d.code as "departmentCode", s.section, s.year,
            a.id as "allocationId", a.room_id as "roomId", r.room_no as "roomNo", a.seat_no as "seatNo",
            ar.status as "attendance"
       from exam_students es
       join students s on s.id = es.student_id
       join departments d on d.id = s.department_id
       left join allocations a on a.exam_id = es.exam_id and a.student_id = s.id
       left join rooms r on r.id = a.room_id
       left join attendance_records ar on ar.allocation_id = a.id
      where es.exam_id = $1
      order by d.code, s.section, s.roll_no`,
    [examId],
  );
  return { exam, rooms: rooms.rows, students: students.rows, warnings: examWarnings(exam, rooms.rows as RoomLite[]) };
}

interface RoomLite {
  roomNo: string;
  status: string;
  allocated: number;
  inchargeId: string | null;
  capacity: number;
}

export function examWarnings(exam: ExamRow, rooms: RoomLite[]) {
  const w: { severity: 'critical' | 'warning' | 'info'; message: string }[] = [];
  if (!exam.isActive) w.push({ severity: 'info', message: 'Examination is deactivated.' });
  if (exam.eligibleCount === 0) w.push({ severity: 'warning', message: 'No eligible students are enrolled yet.' });
  if (rooms.length === 0) w.push({ severity: 'warning', message: 'No rooms are assigned.' });
  if (exam.eligibleCount > exam.capacity && rooms.length > 0)
    w.push({
      severity: 'critical',
      message: `Capacity shortage: ${exam.eligibleCount} eligible students but only ${exam.capacity} usable seats.`,
    });
  for (const r of rooms) {
    if (r.status !== 'AVAILABLE')
      w.push({ severity: 'critical', message: `Room ${r.roomNo} is ${r.status.toLowerCase()} but still assigned.` });
    if (r.allocated > 0 && !r.inchargeId)
      w.push({ severity: 'warning', message: `Room ${r.roomNo} has ${r.allocated} students but no in-charge.` });
  }
  const unallocated = exam.eligibleCount - exam.allocatedCount;
  if (exam.status !== 'DRAFT' && unallocated > 0)
    w.push({ severity: 'warning', message: `${unallocated} eligible student(s) have no seat.` });
  if (exam.status === 'ALLOCATED') w.push({ severity: 'info', message: 'Allocation is a draft — students cannot see it until published.' });
  return w;
}

export async function createExam(q: Queryable, input: ExamInput & { autoEnroll?: boolean }, userId: string) {
  if (input.examDate < todayIso()) throw badRequest('Examination date cannot be in the past.', { fields: { examDate: 'Date is in the past' } });
  await assertCourse(q, input.courseId);
  const r = await q.query<{ id: string }>(
    `insert into examinations (name, exam_type, course_id, department_id, year, section, exam_date, session,
                               start_time, duration_minutes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      input.name,
      input.examType,
      input.courseId,
      input.departmentId,
      input.year,
      input.section,
      input.examDate,
      input.session,
      input.startTime,
      input.durationMinutes,
      userId,
    ],
  );
  const id = r.rows[0].id;
  let enrolled = { added: 0, skippedConflicts: 0 };
  if (input.autoEnroll) enrolled = await enrolByCriteria(q, id);
  await audit(q, {
    action: 'EXAM_CREATED',
    entityType: 'examination',
    entityId: id,
    examId: id,
    summary: `Created examination “${input.name}” on ${input.examDate} (${input.session})`,
    metadata: { ...input, enrolled },
  });
  return { id, enrolled };
}

async function assertCourse(q: Queryable, courseId: string) {
  const c = await q.query('select 1 from courses where id = $1', [courseId]);
  if (!c.rows[0]) throw badRequest('Selected course does not exist.', { fields: { courseId: 'Unknown course' } });
}

export async function updateExam(q: Queryable, examId: string, input: ExamInput) {
  const cur = await lockExam(q, examId);
  assertEditable(cur, 'its details');
  const prev = await getExamRow(q, examId);
  if (input.examDate !== prev.examDate && input.examDate < todayIso())
    throw badRequest('Examination date cannot be moved into the past.', { fields: { examDate: 'Date is in the past' } });
  await assertCourse(q, input.courseId);
  await q.query(
    `update examinations set name = $2, exam_type = $3, course_id = $4, department_id = $5, year = $6, section = $7,
            exam_date = $8, session = $9, start_time = $10, duration_minutes = $11
      where id = $1`,
    [
      examId,
      input.name,
      input.examType,
      input.courseId,
      input.departmentId,
      input.year,
      input.section,
      input.examDate,
      input.session,
      input.startTime,
      input.durationMinutes,
    ],
  );
  const changed = Object.entries({
    name: [prev.name, input.name],
    examDate: [prev.examDate, input.examDate],
    session: [prev.session, input.session],
    startTime: [prev.startTime, input.startTime],
  })
    .filter(([, [a, b]]) => a !== b)
    .map(([k, [a, b]]) => ({ field: k, from: a, to: b }));
  await audit(q, {
    action: 'EXAM_UPDATED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Updated examination “${input.name}”${changed.length ? ` (${changed.map((c) => c.field).join(', ')})` : ''}`,
    metadata: { changed },
  });
}

async function attendanceCount(q: Queryable, examId: string) {
  const r = await q.query<{ n: number }>('select count(*)::int as n from attendance_records where exam_id = $1', [examId]);
  return r.rows[0].n;
}

export async function deactivateExam(q: Queryable, examId: string) {
  const cur = await lockExam(q, examId);
  if (!cur.is_active) return;
  if ((await attendanceCount(q, examId)) > 0)
    throw conflict('HAS_ATTENDANCE', 'Attendance has been recorded for this examination; it cannot be deactivated.');
  await q.query('delete from attendance_submissions where exam_id = $1', [examId]);
  const removed = await q.query('delete from allocations where exam_id = $1', [examId]);
  await q.query(
    `update examinations set is_active = false, status = 'DRAFT', published_at = null, published_by = null where id = $1`,
    [examId],
  );
  await audit(q, {
    action: 'EXAM_DEACTIVATED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Deactivated examination “${cur.name}” and released ${removed.rowCount} seat(s)`,
  });
}

export async function reactivateExam(q: Queryable, examId: string) {
  const cur = await lockExam(q, examId);
  if (cur.is_active) return;
  await q.query('update examinations set is_active = true where id = $1', [examId]);
  await audit(q, {
    action: 'EXAM_REACTIVATED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Reactivated examination “${cur.name}”`,
  });
}

/** Enrols active students matching the exam's department/year/section, skipping slot conflicts. */
export async function enrolByCriteria(q: Queryable, examId: string) {
  const conflicts = await q.query<{ n: number }>(
    `select count(*)::int as n
       from examinations e
       join students s on s.is_active and s.year = e.year
                      and (e.department_id is null or s.department_id = e.department_id)
                      and (e.section is null or s.section = e.section)
      where e.id = $1
        and not exists (select 1 from exam_students x where x.exam_id = e.id and x.student_id = s.id)
        and exists (select 1 from exam_students x where x.student_id = s.id and x.exam_date = e.exam_date
                       and x.session = e.session and x.exam_active and x.exam_id <> e.id)`,
    [examId],
  );
  const r = await q.query(
    `insert into exam_students (exam_id, student_id, exam_date, session, exam_active)
     select e.id, s.id, e.exam_date, e.session, e.is_active
       from examinations e
       join students s on s.is_active and s.year = e.year
                      and (e.department_id is null or s.department_id = e.department_id)
                      and (e.section is null or s.section = e.section)
      where e.id = $1
        and not exists (select 1 from exam_students x where x.student_id = s.id and x.exam_date = e.exam_date
                           and x.session = e.session and x.exam_active and x.exam_id <> e.id)
     on conflict (exam_id, student_id) do nothing`,
    [examId],
  );
  return { added: r.rowCount, skippedConflicts: conflicts.rows[0].n };
}

export async function changeEligible(
  q: Queryable,
  examId: string,
  body: { mode: 'criteria' } | { mode: 'add' | 'remove'; studentIds: string[] },
) {
  const cur = await lockExam(q, examId);
  assertEditable(cur, 'eligible students');
  if (body.mode === 'criteria') {
    const res = await enrolByCriteria(q, examId);
    await audit(q, {
      action: 'ELIGIBILITY_UPDATED',
      entityType: 'examination',
      entityId: examId,
      examId,
      summary: `Enrolled ${res.added} student(s) by criteria${res.skippedConflicts ? `; ${res.skippedConflicts} skipped (slot conflict)` : ''}`,
      metadata: res,
    });
    return res;
  }
  if (body.mode === 'add') {
    const r = await q.query(
      `insert into exam_students (exam_id, student_id, exam_date, session, exam_active)
       select e.id, s.id, e.exam_date, e.session, e.is_active
         from examinations e cross join unnest($2::uuid[]) as t(sid)
         join students s on s.id = t.sid and s.is_active
        where e.id = $1
       on conflict (exam_id, student_id) do nothing`,
      [examId, body.studentIds],
    );
    await audit(q, {
      action: 'ELIGIBILITY_UPDATED',
      entityType: 'examination',
      entityId: examId,
      examId,
      summary: `Added ${r.rowCount} eligible student(s)`,
      metadata: { studentIds: body.studentIds },
    });
    return { added: r.rowCount, skippedConflicts: 0 };
  }
  // remove: release seats first (blocked by FK if attendance exists)
  const released = await q.query('delete from allocations where exam_id = $1 and student_id = any($2::uuid[])', [
    examId,
    body.studentIds,
  ]);
  const r = await q.query('delete from exam_students where exam_id = $1 and student_id = any($2::uuid[])', [
    examId,
    body.studentIds,
  ]);
  await audit(q, {
    action: 'ELIGIBILITY_UPDATED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Removed ${r.rowCount} eligible student(s)${released.rowCount ? ` and released ${released.rowCount} seat(s)` : ''}`,
    metadata: { studentIds: body.studentIds },
  });
  return { removed: r.rowCount, released: released.rowCount };
}

export async function setExamRooms(q: Queryable, examId: string, roomIds: string[]) {
  const cur = await lockExam(q, examId);
  assertEditable(cur, 'rooms');
  const unique = [...new Set(roomIds)];
  const existing = (
    await q.query<{ room_id: string }>('select room_id from exam_rooms where exam_id = $1', [examId])
  ).rows.map((r) => r.room_id);
  const toRemove = existing.filter((id) => !unique.includes(id));
  const toAdd = unique.filter((id) => !existing.includes(id));
  let released = 0;
  if (toRemove.length) {
    const rel = await q.query('delete from allocations where exam_id = $1 and room_id = any($2::uuid[])', [examId, toRemove]);
    released = rel.rowCount;
    await q.query(
      `delete from attendance_submissions where exam_id = $1 and room_id = any($2::uuid[]) and status = 'IN_PROGRESS'`,
      [examId, toRemove],
    );
    await q.query('delete from exam_rooms where exam_id = $1 and room_id = any($2::uuid[])', [examId, toRemove]);
  }
  if (toAdd.length) {
    const found = await q.query<{ id: string }>('select id from rooms where id = any($1::uuid[])', [toAdd]);
    if (found.rows.length !== toAdd.length) throw badRequest('One or more selected rooms do not exist.');
    await q.query(
      `insert into exam_rooms (exam_id, room_id, exam_date, session, exam_active)
       select e.id, r.id, e.exam_date, e.session, e.is_active
         from examinations e cross join unnest($2::uuid[]) as t(rid) join rooms r on r.id = t.rid
        where e.id = $1`,
      [examId, toAdd],
    );
  }
  if (toAdd.length || toRemove.length) {
    const names = await q.query<{ id: string; room_no: string }>('select id, room_no from rooms where id = any($1::uuid[])', [
      [...toAdd, ...toRemove],
    ]);
    const nameOf = (id: string) => names.rows.find((r) => r.id === id)?.room_no ?? id;
    await audit(q, {
      action: 'ROOMS_ASSIGNED',
      entityType: 'examination',
      entityId: examId,
      examId,
      summary: [
        toAdd.length ? `Assigned ${toAdd.map(nameOf).join(', ')}` : '',
        toRemove.length ? `Removed ${toRemove.map(nameOf).join(', ')}` : '',
        released ? `(${released} seat(s) released)` : '',
      ]
        .filter(Boolean)
        .join('; '),
      metadata: { added: toAdd, removed: toRemove, released },
    });
  }
  return { added: toAdd.length, removed: toRemove.length, released };
}

export async function setIncharges(
  q: Queryable,
  examId: string,
  assignments: { roomId: string; inchargeId: string | null }[],
  userId: string,
) {
  const cur = await lockExam(q, examId);
  if (!cur.is_active) throw conflict('EXAM_INACTIVE', 'This examination is deactivated.');
  const changes: string[] = [];
  for (const a of assignments) {
    const room = await q.query<{ room_no: string }>(
      `select r.room_no from exam_rooms er join rooms r on r.id = er.room_id where er.exam_id = $1 and er.room_id = $2`,
      [examId, a.roomId],
    );
    if (!room.rows[0]) throw badRequest('Room is not assigned to this examination.');
    if (a.inchargeId === null) {
      const d = await q.query('delete from incharge_assignments where exam_id = $1 and room_id = $2', [examId, a.roomId]);
      if (d.rowCount) changes.push(`${room.rows[0].room_no}: unassigned`);
      continue;
    }
    const prev = await q.query<{ incharge_id: string }>(
      'select incharge_id from incharge_assignments where exam_id = $1 and room_id = $2',
      [examId, a.roomId],
    );
    if (prev.rows[0]?.incharge_id === a.inchargeId) continue;
    await q.query(
      `insert into incharge_assignments (exam_id, room_id, incharge_id, exam_date, session, exam_active, assigned_by)
       select er.exam_id, er.room_id, $3, er.exam_date, er.session, er.exam_active, $4
         from exam_rooms er where er.exam_id = $1 and er.room_id = $2
       on conflict (exam_id, room_id) do update set incharge_id = excluded.incharge_id,
              assigned_by = excluded.assigned_by, assigned_at = now()`,
      [examId, a.roomId, a.inchargeId, userId],
    );
    const name = await q.query<{ n: string | null }>('select app.staff_name($1) as n', [a.inchargeId]);
    changes.push(`${room.rows[0].room_no}: ${name.rows[0].n ?? 'in-charge'}`);
  }
  if (changes.length)
    await audit(q, {
      action: 'INCHARGES_ASSIGNED',
      entityType: 'examination',
      entityId: examId,
      examId,
      summary: `In-charge assignments — ${changes.join('; ')}`,
      metadata: { assignments },
    });
  return { changed: changes.length };
}

export async function publishExam(q: Queryable, examId: string, acknowledgeUnallocated: boolean, userId: string) {
  const cur = await lockExam(q, examId);
  if (!cur.is_active) throw conflict('EXAM_INACTIVE', 'This examination is deactivated.');
  if (cur.status === 'PUBLISHED') throw conflict('ALREADY_PUBLISHED', 'This examination is already published.');
  if (cur.status !== 'ALLOCATED') throw conflict('NOT_ALLOCATED', 'Run and confirm a seating allocation before publishing.');
  const exam = await getExamRow(q, examId);
  if (exam.allocatedCount === 0) throw conflict('NOT_ALLOCATED', 'No students have been allocated seats.');
  const missing = await q.query<{ room_no: string }>(
    `select distinct r.room_no from allocations a join rooms r on r.id = a.room_id
      where a.exam_id = $1 and not exists (select 1 from incharge_assignments ia where ia.exam_id = a.exam_id and ia.room_id = a.room_id)
      order by r.room_no`,
    [examId],
  );
  if (missing.rows.length)
    throw conflict(
      'MISSING_INCHARGE',
      `Assign an in-charge to every occupied room before publishing (missing: ${missing.rows.map((r) => r.room_no).join(', ')}).`,
    );
  const unallocated = exam.eligibleCount - exam.allocatedCount;
  if (unallocated > 0 && !acknowledgeUnallocated)
    throw conflict('UNALLOCATED_STUDENTS', `${unallocated} eligible student(s) have no seat. Confirm to publish anyway.`, {
      unallocated,
    });
  await q.query(`update examinations set status = 'PUBLISHED', published_at = now(), published_by = $2 where id = $1`, [
    examId,
    userId,
  ]);
  await audit(q, {
    action: 'EXAM_PUBLISHED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Published seating for “${cur.name}” (${exam.allocatedCount} seats${unallocated ? `, ${unallocated} unallocated` : ''})`,
    metadata: { allocated: exam.allocatedCount, unallocated },
  });
}

export async function unpublishExam(q: Queryable, examId: string) {
  const cur = await lockExam(q, examId);
  if (cur.status !== 'PUBLISHED') throw conflict('NOT_PUBLISHED', 'This examination is not published.');
  if ((await attendanceCount(q, examId)) > 0)
    throw conflict('HAS_ATTENDANCE', 'Attendance has already been recorded; the allocation can no longer be unpublished.');
  await q.query(`update examinations set status = 'ALLOCATED', published_at = null, published_by = null where id = $1`, [examId]);
  await audit(q, {
    action: 'EXAM_UNPUBLISHED',
    entityType: 'examination',
    entityId: examId,
    examId,
    summary: `Unpublished seating for “${cur.name}”`,
  });
}
