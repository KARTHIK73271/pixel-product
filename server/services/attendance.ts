import type { AttendanceMark } from '../../shared/schemas';
import type { AuthUser } from '../auth/session';
import type { Queryable } from '../db/index';
import { badRequest, conflict, forbidden, notFound } from '../http/errors';
import { audit } from './audit';
import { todayIso } from './sql';

/** Explicit authorization (RLS enforces the same rule underneath). */
export async function assertRoomAccess(q: Queryable, user: AuthUser, examId: string, roomId: string) {
  if (user.role === 'ADMIN') return;
  if (user.role !== 'INCHARGE') throw forbidden();
  const r = await q.query<{ ok: boolean }>('select app.is_assigned_room($1, $2) as ok', [examId, roomId]);
  if (!r.rows[0]?.ok) throw forbidden('You are not assigned to this examination room.');
}

export interface RoomCounts {
  allocated: number;
  present: number;
  absent: number;
  unmarked: number;
}

async function roomCounts(q: Queryable, examId: string, roomId: string): Promise<RoomCounts> {
  const r = await q.query<RoomCounts>(
    `select count(a.id)::int as allocated,
            count(*) filter (where ar.status = 'PRESENT')::int as present,
            count(*) filter (where ar.status = 'ABSENT')::int as absent,
            count(a.id) filter (where ar.allocation_id is null)::int as unmarked
       from allocations a left join attendance_records ar on ar.allocation_id = a.id
      where a.exam_id = $1 and a.room_id = $2`,
    [examId, roomId],
  );
  return r.rows[0];
}

export async function getRoomSheet(q: Queryable, user: AuthUser, examId: string, roomId: string) {
  await assertRoomAccess(q, user, examId, roomId);
  const head = await q.query(
    `select e.id as "examId", e.name as "examName", e.exam_type as "examType", e.exam_date as "examDate", e.session,
            to_char(e.start_time, 'HH24:MI') as "startTime", e.duration_minutes as "durationMinutes", e.status as "examStatus",
            e.year, e.section as "examSection",
            c.code as "courseCode", c.name as "courseName", d.name as "departmentName",
            r.id as "roomId", r.room_no as "roomNo", r.block, r.floor, r.capacity,
            app.staff_name(ia.incharge_id) as "inchargeName", ia.incharge_id as "inchargeId",
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus",
            s.finalized_at as "finalizedAt", app.staff_name(s.finalized_by) as "finalizedByName",
            s.reopened_count as "reopenedCount", s.last_reopen_reason as "lastReopenReason"
       from exam_rooms er
       join examinations e on e.id = er.exam_id
       join courses c on c.id = e.course_id
       left join departments d on d.id = e.department_id
       join rooms r on r.id = er.room_id
       left join incharge_assignments ia on ia.exam_id = er.exam_id and ia.room_id = er.room_id
       left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
      where er.exam_id = $1 and er.room_id = $2`,
    [examId, roomId],
  );
  if (!head.rows[0]) throw notFound('Examination room');
  const rows = await q.query(
    `select a.id as "allocationId", a.seat_no as "seatNo", st.id as "studentId", st.roll_no as "rollNo",
            st.full_name as "fullName", d.code as "departmentCode", d.name as "departmentName", st.section,
            ar.status, ar.marked_at as "markedAt", app.staff_name(ar.marked_by) as "markedByName"
       from allocations a
       join students st on st.id = a.student_id
       join departments d on d.id = st.department_id
       left join attendance_records ar on ar.allocation_id = a.id
      where a.exam_id = $1 and a.room_id = $2
      order by a.seat_no`,
    [examId, roomId],
  );
  return { ...head.rows[0], students: rows.rows, counts: await roomCounts(q, examId, roomId) };
}

export async function recordMarks(
  q: Queryable,
  user: AuthUser,
  examId: string,
  roomId: string,
  marks: { allocationId: string; status: AttendanceMark | null }[],
) {
  await assertRoomAccess(q, user, examId, roomId);
  const exam = await q.query<{ status: string; is_active: boolean }>('select status, is_active from examinations where id = $1', [
    examId,
  ]);
  if (!exam.rows[0]) throw notFound('Examination');
  if (exam.rows[0].status !== 'PUBLISHED' || !exam.rows[0].is_active)
    throw conflict('NOT_PUBLISHED', 'Attendance can only be recorded for published examinations.');

  const sub = await q.query<{ status: string }>('select status from attendance_submissions where exam_id = $1 and room_id = $2', [
    examId,
    roomId,
  ]);
  if (sub.rows[0]?.status === 'FINALIZED')
    throw conflict('FINALIZED', 'Attendance for this room is finalized. An admin must reopen it before corrections.');

  const ids = [...new Set(marks.map((m) => m.allocationId))];
  const owned = await q.query<{ id: string; roll_no: string; prev: AttendanceMark | null }>(
    `select a.id, s.roll_no, ar.status as prev
       from allocations a join students s on s.id = a.student_id
       left join attendance_records ar on ar.allocation_id = a.id
      where a.id = any($1::uuid[]) and a.exam_id = $2 and a.room_id = $3`,
    [ids, examId, roomId],
  );
  if (owned.rows.length !== ids.length) throw badRequest('One or more students are not seated in this room.');

  if (!sub.rows[0]) {
    await q.query(
      `insert into attendance_submissions (exam_id, room_id) values ($1, $2) on conflict (exam_id, room_id) do nothing`,
      [examId, roomId],
    );
  }

  const prevById = new Map(owned.rows.map((r) => [r.id, r]));
  const corrections: string[] = [];
  for (const m of marks) {
    const prev = prevById.get(m.allocationId)!;
    if (m.status === null) {
      await q.query('delete from attendance_records where allocation_id = $1', [m.allocationId]);
    } else {
      await q.query(
        `insert into attendance_records (allocation_id, exam_id, room_id, status, marked_by)
         values ($1, $2, $3, $4, $5)
         on conflict (allocation_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now()`,
        [m.allocationId, examId, roomId, m.status, user.id],
      );
    }
    if (prev.prev && prev.prev !== m.status) corrections.push(`${prev.roll_no}: ${prev.prev} → ${m.status ?? 'UNMARKED'}`);
  }
  if (corrections.length) {
    await audit(q, {
      action: 'ATTENDANCE_CORRECTED',
      entityType: 'attendance',
      entityId: roomId,
      examId,
      summary: `Corrected attendance — ${corrections.slice(0, 5).join('; ')}${corrections.length > 5 ? ` (+${corrections.length - 5} more)` : ''}`,
      metadata: { roomId, corrections },
    });
  }
  return roomCounts(q, examId, roomId);
}

export async function finalizeRoom(q: Queryable, user: AuthUser, examId: string, roomId: string) {
  await assertRoomAccess(q, user, examId, roomId);
  const counts = await roomCounts(q, examId, roomId);
  if (counts.allocated === 0) throw conflict('NO_ALLOCATIONS', 'There are no allocated students in this room.');
  if (counts.unmarked > 0)
    throw conflict('INCOMPLETE', `${counts.unmarked} of ${counts.allocated} students are still unmarked. Mark every student before submitting.`, {
      counts,
    });
  await q.query(
    `insert into attendance_submissions (exam_id, room_id) values ($1, $2) on conflict (exam_id, room_id) do nothing`,
    [examId, roomId],
  );
  const r = await q.query(
    `update attendance_submissions set status = 'FINALIZED', finalized_by = $3, finalized_at = now()
      where exam_id = $1 and room_id = $2 and status = 'IN_PROGRESS'`,
    [examId, roomId, user.id],
  );
  if (r.rowCount === 0) throw conflict('FINALIZED', 'Attendance for this room is already finalized.');
  const room = await q.query<{ room_no: string }>('select room_no from rooms where id = $1', [roomId]);
  await audit(q, {
    action: 'ATTENDANCE_FINALIZED',
    entityType: 'attendance',
    entityId: roomId,
    examId,
    summary: `Submitted & finalized attendance for ${room.rows[0]?.room_no}: ${counts.present} present, ${counts.absent} absent`,
    metadata: { roomId, ...counts },
  });
  return counts;
}

export async function reopenRoom(q: Queryable, user: AuthUser, examId: string, roomId: string, reason: string) {
  if (user.role !== 'ADMIN') throw forbidden('Only an examination admin can reopen finalized attendance.');
  const r = await q.query(
    `update attendance_submissions
        set status = 'IN_PROGRESS', finalized_at = null, finalized_by = null,
            reopened_count = reopened_count + 1, last_reopen_reason = $3, last_reopened_by = $4, last_reopened_at = now()
      where exam_id = $1 and room_id = $2 and status = 'FINALIZED'`,
    [examId, roomId, reason, user.id],
  );
  if (r.rowCount === 0) throw conflict('NOT_FINALIZED', 'Attendance for this room is not finalized.');
  const room = await q.query<{ room_no: string }>('select room_no from rooms where id = $1', [roomId]);
  await audit(q, {
    action: 'ATTENDANCE_REOPENED',
    entityType: 'attendance',
    entityId: roomId,
    examId,
    summary: `Reopened attendance for ${room.rows[0]?.room_no}: “${reason}”`,
    metadata: { roomId, reason },
  });
}

export interface DutyRow {
  examId: string;
  examName: string;
  examDate: string;
  session: string;
  startTime: string;
  examStatus: string;
  courseCode: string;
  courseName: string;
  roomId: string;
  roomNo: string;
  block: string;
  capacity: number;
  inchargeName: string | null;
  allocated: number;
  present: number;
  absent: number;
  submissionStatus: string;
  finalizedAt: string | null;
  reopenedCount: number | null;
}

/** Rooms the user supervises (in-charge) or all rooms of active exams (admin), with live progress. */
export async function listDuties(q: Queryable, user: AuthUser) {
  const r = await q.query<DutyRow>(
    `select e.id as "examId", e.name as "examName", e.exam_date as "examDate", e.session,
            to_char(e.start_time, 'HH24:MI') as "startTime", e.status as "examStatus",
            c.code as "courseCode", c.name as "courseName",
            r.id as "roomId", r.room_no as "roomNo", r.block, r.capacity,
            app.staff_name(ia.incharge_id) as "inchargeName",
            (select count(*) from allocations a where a.exam_id = er.exam_id and a.room_id = er.room_id)::int as allocated,
            (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = er.room_id and ar.status = 'PRESENT')::int as present,
            (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = er.room_id and ar.status = 'ABSENT')::int as absent,
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus", s.finalized_at as "finalizedAt",
            s.reopened_count as "reopenedCount"
       from exam_rooms er
       join examinations e on e.id = er.exam_id and e.is_active
       join courses c on c.id = e.course_id
       join rooms r on r.id = er.room_id
       left join incharge_assignments ia on ia.exam_id = er.exam_id and ia.room_id = er.room_id
       left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
      where ($1::boolean or ia.incharge_id = $2)
      order by e.exam_date, e.session, r.room_no`,
    [user.role === 'ADMIN', user.id],
  );
  const today = todayIso();
  return r.rows.map((row) => ({
    ...row,
    unmarked: Math.max(0, row.allocated - row.present - row.absent),
    timing: (row.examDate < today ? 'PAST' : row.examDate === today ? 'TODAY' : 'UPCOMING') as 'PAST' | 'TODAY' | 'UPCOMING',
  }));
}
