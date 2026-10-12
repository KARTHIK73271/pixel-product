import type { AuthUser } from '../auth/session';
import type { Queryable } from '../db/index';
import { forbidden, notFound } from '../http/errors';
import { todayIso } from './sql';

/**
 * Absentee statement for an examination, derived entirely from attendance_records.
 * Row-Level Security limits in-charges to their assigned rooms automatically; the
 * explicit room check gives a clear 403 instead of an empty report.
 */
export async function absenteeReport(q: Queryable, user: AuthUser, examId: string, roomId?: string) {
  if (roomId && user.role === 'INCHARGE') {
    const ok = await q.query<{ ok: boolean }>('select app.is_assigned_room($1, $2) as ok', [examId, roomId]);
    if (!ok.rows[0]?.ok) throw forbidden('You are not assigned to this examination room.');
  }
  const exam = await q.query(
    `select e.id, e.name, e.exam_type as "examType", e.exam_date as "examDate", e.session,
            to_char(e.start_time, 'HH24:MI') as "startTime", e.status, c.code as "courseCode", c.name as "courseName",
            d.name as "departmentName", e.year, e.section
       from examinations e join courses c on c.id = e.course_id left join departments d on d.id = e.department_id
      where e.id = $1`,
    [examId],
  );
  if (!exam.rows[0]) throw notFound('Examination');

  const rooms = await q.query<{
    roomId: string;
    roomNo: string;
    block: string;
    inchargeName: string | null;
    allocated: number;
    present: number;
    absent: number;
    unmarked: number;
    submissionStatus: string;
    finalizedAt: string | null;
  }>(
    `select r.id as "roomId", r.room_no as "roomNo", r.block, app.staff_name(ia.incharge_id) as "inchargeName",
            count(a.id)::int as allocated,
            count(*) filter (where ar.status = 'PRESENT')::int as present,
            count(*) filter (where ar.status = 'ABSENT')::int as absent,
            count(a.id) filter (where ar.allocation_id is null)::int as unmarked,
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus", s.finalized_at as "finalizedAt"
       from exam_rooms er
       join rooms r on r.id = er.room_id
       left join incharge_assignments ia on ia.exam_id = er.exam_id and ia.room_id = er.room_id
       left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
       left join allocations a on a.exam_id = er.exam_id and a.room_id = er.room_id
       left join attendance_records ar on ar.allocation_id = a.id
      where er.exam_id = $1 and ($2::uuid is null or er.room_id = $2)
      group by r.id, r.room_no, r.block, ia.incharge_id, s.status, s.finalized_at
      order by r.room_no`,
    [examId, roomId ?? null],
  );
  const absentees = await q.query(
    `select a.room_id as "roomId", r.room_no as "roomNo", a.seat_no as "seatNo", st.roll_no as "rollNo",
            st.full_name as "fullName", d.code as "departmentCode", st.section,
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus"
       from attendance_records ar
       join allocations a on a.id = ar.allocation_id
       join students st on st.id = a.student_id
       join departments d on d.id = st.department_id
       join rooms r on r.id = a.room_id
       left join attendance_submissions s on s.exam_id = a.exam_id and s.room_id = a.room_id
      where ar.exam_id = $1 and ar.status = 'ABSENT' and ($2::uuid is null or a.room_id = $2)
      order by r.room_no, st.roll_no`,
    [examId, roomId ?? null],
  );

  const totals = rooms.rows.reduce(
    (t, r) => ({
      allocated: t.allocated + r.allocated,
      present: t.present + r.present,
      absent: t.absent + r.absent,
      unmarked: t.unmarked + r.unmarked,
    }),
    { allocated: 0, present: 0, absent: 0, unmarked: 0 },
  );
  const occupied = rooms.rows.filter((r) => r.allocated > 0);
  const finalizedRooms = occupied.filter((r) => r.submissionStatus === 'FINALIZED').length;
  return {
    exam: exam.rows[0],
    rooms: rooms.rows.map((r) => ({ ...r, reportStatus: r.submissionStatus === 'FINALIZED' ? 'FINAL' : 'PROVISIONAL' })),
    absentees: absentees.rows,
    totals,
    finalizedRooms,
    occupiedRooms: occupied.length,
    reportStatus: occupied.length > 0 && finalizedRooms === occupied.length ? 'FINAL' : 'PROVISIONAL',
    scope: roomId ? 'ROOM' : user.role === 'ADMIN' ? 'EXAMINATION' : 'ASSIGNED_ROOMS',
    generatedAt: new Date().toISOString(),
    generatedBy: user.fullName,
  };
}

/** Per-department totals across published examinations (optionally a single exam / date range). */
export async function departmentStats(q: Queryable, f: { examId?: string; from?: string; to?: string }) {
  const r = await q.query(
    `select d.code as "departmentCode", d.name as "departmentName",
            count(distinct (es.exam_id, es.student_id))::int as eligible,
            count(distinct a.id)::int as allocated,
            count(distinct ar.allocation_id) filter (where ar.status = 'PRESENT')::int as present,
            count(distinct ar.allocation_id) filter (where ar.status = 'ABSENT')::int as absent
       from exam_students es
       join examinations e on e.id = es.exam_id and e.is_active and e.status = 'PUBLISHED'
       join students st on st.id = es.student_id
       join departments d on d.id = st.department_id
       left join allocations a on a.exam_id = es.exam_id and a.student_id = es.student_id
       left join attendance_records ar on ar.allocation_id = a.id
      where ($1::uuid is null or e.id = $1) and ($2::date is null or e.exam_date >= $2) and ($3::date is null or e.exam_date <= $3)
      group by d.code, d.name
      order by d.code`,
    [f.examId ?? null, f.from ?? null, f.to ?? null],
  );
  return r.rows.map((row) => ({
    ...row,
    unmarked: row.allocated - row.present - row.absent,
    absenteeRate: row.present + row.absent > 0 ? row.absent / (row.present + row.absent) : null,
  }));
}

/** Published, occupied rooms whose attendance is not yet finalized. */
export async function pendingSubmissions(q: Queryable) {
  const r = await q.query(
    `select e.id as "examId", e.name as "examName", e.exam_date as "examDate", e.session, c.code as "courseCode",
            r.id as "roomId", r.room_no as "roomNo", app.staff_name(ia.incharge_id) as "inchargeName",
            count(a.id)::int as allocated, count(ar.allocation_id)::int as marked,
            coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus", s.reopened_count as "reopenedCount"
       from exam_rooms er
       join examinations e on e.id = er.exam_id and e.is_active and e.status = 'PUBLISHED'
       join courses c on c.id = e.course_id
       join rooms r on r.id = er.room_id
       left join incharge_assignments ia on ia.exam_id = er.exam_id and ia.room_id = er.room_id
       left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
       join allocations a on a.exam_id = er.exam_id and a.room_id = er.room_id
       left join attendance_records ar on ar.allocation_id = a.id
      where coalesce(s.status::text, 'NOT_STARTED') <> 'FINALIZED'
      group by e.id, e.name, e.exam_date, e.session, c.code, r.id, r.room_no, ia.incharge_id, s.status, s.reopened_count
      order by e.exam_date, e.session, r.room_no`,
  );
  const today = todayIso();
  return r.rows.map((row) => ({ ...row, overdue: row.examDate < today }));
}

/** Exams with any attendance activity — the list of reports that can be generated. */
export async function reportIndex(q: Queryable) {
  const r = await q.query(
    `select e.id, e.name, e.exam_date as "examDate", e.session, c.code as "courseCode",
            (select count(*) from allocations a where a.exam_id = e.id)::int as allocated,
            (select count(*) from attendance_records ar where ar.exam_id = e.id and ar.status = 'PRESENT')::int as present,
            (select count(*) from attendance_records ar where ar.exam_id = e.id and ar.status = 'ABSENT')::int as absent,
            (select count(distinct a.room_id) from allocations a where a.exam_id = e.id)::int as "occupiedRooms",
            (select count(*) from attendance_submissions s where s.exam_id = e.id and s.status = 'FINALIZED'
                and exists (select 1 from allocations a where a.exam_id = s.exam_id and a.room_id = s.room_id))::int as "finalizedRooms"
       from examinations e join courses c on c.id = e.course_id
      where e.is_active and e.status = 'PUBLISHED'
      order by e.exam_date desc, e.session desc`,
  );
  return r.rows.map((row) => ({
    ...row,
    unmarked: row.allocated - row.present - row.absent,
    reportStatus: row.occupiedRooms > 0 && row.finalizedRooms === row.occupiedRooms ? 'FINAL' : 'PROVISIONAL',
  }));
}
