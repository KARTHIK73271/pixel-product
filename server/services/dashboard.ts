/**
 * Admin command-centre metrics. Every number is computed live from base tables — no stored totals.
 *
 * KPI definitions (all scoped to ACTIVE examinations matching the filters):
 *   totalExams         examinations in scope (any status)
 *   activeRooms        rooms with status AVAILABLE; seatingCapacity = their summed capacity
 *   eligible           (exam, student) enrolment pairs
 *   allocated          seats allocated (draft or published allocations)
 *   unallocated        eligible − allocated
 *   utilization        allocated ÷ capacity of rooms booked by in-scope exams
 *   capacityIssues     exams whose eligible count exceeds usable booked capacity
 *                      + bookings of rooms that are not AVAILABLE + seats beyond capacity (integrity check)
 *   attendanceCompletion  marked ÷ allocated, PUBLISHED exams only (unmarked never counts as absent)
 *   finalPresent/Absent   marks inside FINALIZED room submissions only
 *   pendingRooms       occupied rooms of PUBLISHED exams whose submission is not FINALIZED
 *   overdueRooms       pendingRooms whose exam date is before today
 *   pendingReports     PUBLISHED exams dated today or earlier with ≥1 pending room (report still provisional)
 */
import type { DashboardFilter } from '../../shared/schemas';
import type { AuthUser } from '../auth/session';
import type { Queryable } from '../db/index';
import { listDuties } from './attendance';
import { todayIso } from './sql';

const EXAM_FILTER = `e.is_active
  and ($1::date is null or e.exam_date >= $1::date)
  and ($2::date is null or e.exam_date <= $2::date)
  and ($3::uuid is null or e.id = $3::uuid)
  and ($4::uuid is null or e.course_id = $4::uuid)
  and ($5::uuid is null or e.department_id = $5::uuid)
  and ($6::uuid is null or exists (select 1 from exam_rooms x where x.exam_id = e.id and x.room_id = $6::uuid))`;

const filterParams = (f: DashboardFilter) => [
  f.from ?? null,
  f.to ?? null,
  f.examId ?? null,
  f.courseId ?? null,
  f.departmentId ?? null,
  f.roomId ?? null,
];

export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface Alert {
  id: string;
  severity: AlertSeverity;
  kind: string;
  title: string;
  detail: string;
  examId?: string;
  examDate?: string;
  href: string;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export async function computeAlerts(q: Queryable, f: DashboardFilter = {}): Promise<Alert[]> {
  const today = todayIso();
  const r = await q.query<{
    id: string;
    name: string;
    course_code: string;
    exam_date: string;
    session: string;
    status: string;
    eligible: number;
    rooms: number;
    capacity: number;
    allocated: number;
    unavailable_rooms: string | null;
    rooms_without_incharge: string | null;
    pending_rooms: number;
  }>(
    `select e.id, e.name, c.code as course_code, e.exam_date, e.session, e.status,
            (select count(*) from exam_students es where es.exam_id = e.id)::int as eligible,
            (select count(*) from exam_rooms er where er.exam_id = e.id)::int as rooms,
            (select coalesce(sum(r.capacity), 0) from exam_rooms er join rooms r on r.id = er.room_id
               where er.exam_id = e.id and r.status = 'AVAILABLE')::int as capacity,
            (select count(*) from allocations a where a.exam_id = e.id)::int as allocated,
            (select string_agg(r.room_no, ', ' order by r.room_no) from exam_rooms er join rooms r on r.id = er.room_id
               where er.exam_id = e.id and r.status <> 'AVAILABLE') as unavailable_rooms,
            (select string_agg(distinct r.room_no, ', ') from allocations a join rooms r on r.id = a.room_id
               where a.exam_id = e.id and not exists (select 1 from incharge_assignments ia
                 where ia.exam_id = a.exam_id and ia.room_id = a.room_id)) as rooms_without_incharge,
            (select count(*) from exam_rooms er where er.exam_id = e.id
               and exists (select 1 from allocations a where a.exam_id = er.exam_id and a.room_id = er.room_id)
               and not exists (select 1 from attendance_submissions s where s.exam_id = er.exam_id
                 and s.room_id = er.room_id and s.status = 'FINALIZED'))::int as pending_rooms
       from examinations e join courses c on c.id = e.course_id
      where ${EXAM_FILTER}
      order by e.exam_date, e.session`,
    filterParams(f),
  );
  const alerts: Alert[] = [];
  for (const e of r.rows) {
    const d = daysBetween(today, e.exam_date);
    const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : d > 0 ? `in ${d} days` : `${-d} day(s) ago`;
    const base = { examId: e.id, examDate: e.exam_date };
    const label = `${e.course_code} · ${e.name}`;
    const push = (kind: string, severity: AlertSeverity, title: string, detail: string, tab = 'overview') =>
      alerts.push({ id: `${kind}:${e.id}`, kind, severity, title, detail, href: `/examinations/${e.id}?tab=${tab}`, ...base });

    if (d >= 0 && e.eligible === 0) push('NO_STUDENTS', 'warning', 'Enrol eligible students', `${label} (${when}) has no students.`, 'students');
    if (d >= 0 && e.rooms === 0)
      push('NO_ROOMS', d <= 3 ? 'critical' : 'warning', 'Assign examination rooms', `${label} is ${when} and has no rooms.`, 'rooms');
    if (e.rooms > 0 && e.eligible > e.capacity)
      push(
        'CAPACITY_SHORTAGE',
        'critical',
        'Capacity shortage',
        `${label}: ${e.eligible} eligible students but only ${e.capacity} usable seats (${e.eligible - e.capacity} short).`,
        'rooms',
      );
    if (e.unavailable_rooms)
      push('ROOM_UNAVAILABLE', 'critical', 'Unavailable room booked', `${label} uses ${e.unavailable_rooms}, now not available.`, 'rooms');
    if (d >= 0 && e.status === 'DRAFT' && e.rooms > 0 && e.eligible > 0)
      push('NEEDS_ALLOCATION', 'warning', 'Run seating allocation', `${label} (${when}) has rooms but no seating plan.`, 'allocation');
    if (d >= 0 && e.status === 'ALLOCATED')
      push(
        'UNPUBLISHED',
        d <= 2 ? 'critical' : 'warning',
        'Publish seating schedule',
        `${label} is ${when}; students cannot see their seats until it is published.`,
        'allocation',
      );
    if (e.status !== 'DRAFT' && e.allocated < e.eligible)
      push('UNALLOCATED', 'warning', 'Students without seats', `${label}: ${e.eligible - e.allocated} eligible student(s) unallocated.`, 'allocation');
    if (e.rooms_without_incharge)
      push(
        'NO_INCHARGE',
        d <= 1 ? 'critical' : 'warning',
        'Assign room in-charge',
        `${label}: ${e.rooms_without_incharge} has seated students but no in-charge.`,
        'rooms',
      );
    if (e.status === 'PUBLISHED' && e.pending_rooms > 0 && d < 0)
      push('ATTENDANCE_OVERDUE', 'critical', 'Attendance overdue', `${label} was ${when}; ${e.pending_rooms} room(s) not finalized.`, 'attendance');
    if (e.status === 'PUBLISHED' && e.pending_rooms > 0 && d === 0)
      push('ATTENDANCE_PENDING', 'info', 'Attendance in progress', `${label}: ${e.pending_rooms} room(s) awaiting submission.`, 'attendance');
  }
  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.examDate ?? '').localeCompare(b.examDate ?? ''));
}

export async function adminDashboard(q: Queryable, f: DashboardFilter) {
  const p = filterParams(f);
  const today = todayIso();

  const exams = (
    await q.query<{ total: number; published: number; allocatedDraft: number; draft: number; upcoming: number }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'PUBLISHED')::int as published,
              count(*) filter (where status = 'ALLOCATED')::int as "allocatedDraft",
              count(*) filter (where status = 'DRAFT')::int as draft,
              count(*) filter (where exam_date >= $7::date)::int as upcoming
         from examinations e where ${EXAM_FILTER}`,
      [...p, today],
    )
  ).rows[0];

  const rooms = (
    await q.query<{ active: number; capacity: number; total: number; unavailable: number }>(
      `select count(*) filter (where status = 'AVAILABLE')::int as active,
              coalesce(sum(capacity) filter (where status = 'AVAILABLE'), 0)::int as capacity,
              count(*)::int as total,
              count(*) filter (where status <> 'AVAILABLE')::int as unavailable
         from rooms where ($1::uuid is null or id = $1::uuid)`,
      [f.roomId ?? null],
    )
  ).rows[0];

  const seats = (
    await q.query<{ eligible: number; allocated: number; allocatedAll: number; bookedCapacity: number; overCapacitySeats: number }>(
      `with fe as (select e.id from examinations e where ${EXAM_FILTER})
       select (select count(*) from exam_students es join fe on fe.id = es.exam_id)::int as eligible,
              (select count(*) from allocations a join fe on fe.id = a.exam_id
                 where ($6::uuid is null or a.room_id = $6::uuid))::int as allocated,
              (select count(*) from allocations a join fe on fe.id = a.exam_id)::int as "allocatedAll",
              (select coalesce(sum(r.capacity), 0) from exam_rooms er join fe on fe.id = er.exam_id
                 join rooms r on r.id = er.room_id where ($6::uuid is null or er.room_id = $6::uuid))::int as "bookedCapacity",
              (select count(*) from allocations a join fe on fe.id = a.exam_id join rooms r on r.id = a.room_id
                 where a.seat_no > r.capacity)::int as "overCapacitySeats"`,
      p,
    )
  ).rows[0];

  const attendance = (
    await q.query<{ allocated: number; marked: number; present: number; absent: number; finalPresent: number; finalAbsent: number }>(
      `with fe as (select e.id from examinations e where ${EXAM_FILTER} and e.status = 'PUBLISHED')
       select count(a.id)::int as allocated,
              count(ar.allocation_id)::int as marked,
              count(*) filter (where ar.status = 'PRESENT')::int as present,
              count(*) filter (where ar.status = 'ABSENT')::int as absent,
              count(*) filter (where ar.status = 'PRESENT' and s.status = 'FINALIZED')::int as "finalPresent",
              count(*) filter (where ar.status = 'ABSENT' and s.status = 'FINALIZED')::int as "finalAbsent"
         from allocations a join fe on fe.id = a.exam_id
         left join attendance_records ar on ar.allocation_id = a.id
         left join attendance_submissions s on s.exam_id = a.exam_id and s.room_id = a.room_id
        where ($6::uuid is null or a.room_id = $6::uuid)`,
      p,
    )
  ).rows[0];

  const pending = (
    await q.query<{ pendingRooms: number; overdueRooms: number; pendingReports: number }>(
      `with pr as (
         select er.exam_id, e.exam_date
           from exam_rooms er join examinations e on e.id = er.exam_id
           left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
          where ${EXAM_FILTER} and e.status = 'PUBLISHED' and ($6::uuid is null or er.room_id = $6::uuid)
            and exists (select 1 from allocations a where a.exam_id = er.exam_id and a.room_id = er.room_id)
            and coalesce(s.status::text, 'NOT_STARTED') <> 'FINALIZED')
       select count(*)::int as "pendingRooms",
              count(*) filter (where exam_date < $7::date)::int as "overdueRooms",
              count(distinct exam_id) filter (where exam_date <= $7::date)::int as "pendingReports"
         from pr`,
      [...p, today],
    )
  ).rows[0];

  const capacity = (
    await q.query<{ shortageExams: number; unavailableBookings: number }>(
      `with fe as (select e.id from examinations e where ${EXAM_FILTER})
       select (select count(*) from fe where
                 (select count(*) from exam_rooms er where er.exam_id = fe.id) > 0 and
                 (select count(*) from exam_students es where es.exam_id = fe.id) >
                 (select coalesce(sum(r.capacity), 0) from exam_rooms er join rooms r on r.id = er.room_id
                   where er.exam_id = fe.id and r.status = 'AVAILABLE'))::int as "shortageExams",
              (select count(*) from exam_rooms er join fe on fe.id = er.exam_id join rooms r on r.id = er.room_id
                 where r.status <> 'AVAILABLE')::int as "unavailableBookings"`,
      p,
    )
  ).rows[0];

  const roomUtilization = (
    await q.query<{ roomId: string; roomNo: string; capacity: number; status: string; bookings: number; allocated: number }>(
      `with fe as (select e.id from examinations e where ${EXAM_FILTER})
       select r.id as "roomId", r.room_no as "roomNo", r.capacity, r.status,
              (select count(*) from exam_rooms er join fe on fe.id = er.exam_id where er.room_id = r.id)::int as bookings,
              (select count(*) from allocations a join fe on fe.id = a.exam_id where a.room_id = r.id)::int as allocated
         from rooms r where ($6::uuid is null or r.id = $6::uuid)
        order by r.room_no`,
      p,
    )
  ).rows.map((r) => ({
    ...r,
    offered: r.capacity * r.bookings,
    utilization: r.bookings > 0 ? r.allocated / (r.capacity * r.bookings) : 0,
  }));

  const attendanceByExam = (
    await q.query<{ examId: string; label: string; name: string; examDate: string; allocated: number; present: number; absent: number }>(
      `select e.id as "examId", c.code as label, e.name, e.exam_date as "examDate",
              count(a.id)::int as allocated,
              count(*) filter (where ar.status = 'PRESENT')::int as present,
              count(*) filter (where ar.status = 'ABSENT')::int as absent
         from examinations e join courses c on c.id = e.course_id
         join allocations a on a.exam_id = e.id and ($6::uuid is null or a.room_id = $6::uuid)
         left join attendance_records ar on ar.allocation_id = a.id
        where ${EXAM_FILTER} and e.status = 'PUBLISHED'
        group by e.id, c.code, e.name, e.exam_date
        order by e.exam_date, c.code`,
      p,
    )
  ).rows.map((r) => ({ ...r, unmarked: r.allocated - r.present - r.absent }));

  const departments = (
    await q.query<{ departmentCode: string; departmentName: string; eligible: number; allocated: number; present: number; absent: number }>(
      `select d.code as "departmentCode", d.name as "departmentName",
              count(*)::int as eligible,
              count(a.id)::int as allocated,
              count(*) filter (where ar.status = 'PRESENT')::int as present,
              count(*) filter (where ar.status = 'ABSENT')::int as absent
         from exam_students es
         join examinations e on e.id = es.exam_id
         join students st on st.id = es.student_id
         join departments d on d.id = st.department_id
         left join allocations a on a.exam_id = es.exam_id and a.student_id = es.student_id
         left join attendance_records ar on ar.allocation_id = a.id
        where ${EXAM_FILTER}
        group by d.code, d.name order by d.code`,
      p,
    )
  ).rows;

  const timeline = (
    await q.query(
      `select e.id, e.name, c.code as "courseCode", e.exam_date as "examDate", e.session,
              to_char(e.start_time, 'HH24:MI') as "startTime", e.status,
              (select count(*) from exam_students es where es.exam_id = e.id)::int as eligible,
              (select count(*) from allocations a where a.exam_id = e.id)::int as allocated,
              (select count(*) from exam_rooms er where er.exam_id = e.id)::int as rooms
         from examinations e join courses c on c.id = e.course_id
        where ${EXAM_FILTER} and e.exam_date >= $7::date
        order by e.exam_date, e.session limit 8`,
      [...p, today],
    )
  ).rows;

  // Live control centre: focus on today, else the nearest upcoming date, else the latest past date.
  const focus = (
    await q.query<{ d: string | null }>(
      `select coalesce(
          (select min(e.exam_date) from examinations e where ${EXAM_FILTER} and e.status = 'PUBLISHED' and e.exam_date >= $7::date),
          (select max(e.exam_date) from examinations e where ${EXAM_FILTER} and e.status = 'PUBLISHED')) as d`,
      [...p, today],
    )
  ).rows[0].d;
  const controlCenter = focus
    ? (
        await q.query(
          `select e.id as "examId", e.name as "examName", c.code as "courseCode", e.session,
                  to_char(e.start_time, 'HH24:MI') as "startTime",
                  r.id as "roomId", r.room_no as "roomNo", r.block, r.capacity,
                  app.room_incharge_names(er.exam_id, er.room_id) as "inchargeName",
                  (select count(*) from allocations a where a.exam_id = er.exam_id and a.room_id = er.room_id)::int as allocated,
                  (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = er.room_id and ar.status = 'PRESENT')::int as present,
                  (select count(*) from attendance_records ar where ar.exam_id = er.exam_id and ar.room_id = er.room_id and ar.status = 'ABSENT')::int as absent,
                  coalesce(s.status::text, 'NOT_STARTED') as "submissionStatus"
             from exam_rooms er
             join examinations e on e.id = er.exam_id
             join courses c on c.id = e.course_id
             join rooms r on r.id = er.room_id
             left join attendance_submissions s on s.exam_id = er.exam_id and s.room_id = er.room_id
            where ${EXAM_FILTER} and e.status = 'PUBLISHED' and e.exam_date = $7::date
              and ($6::uuid is null or er.room_id = $6::uuid)
              and exists (select 1 from allocations a where a.exam_id = er.exam_id and a.room_id = er.room_id)
            order by e.session, r.room_no`,
          [...p, focus],
        )
      ).rows.map((r) => ({ ...r, unmarked: r.allocated - r.present - r.absent }))
    : [];

  const activity = (
    await q.query(
      `select a.id, a.actor_name as "actorName", a.actor_role as "actorRole", a.action, a.summary,
              a.exam_id as "examId", a.created_at as "createdAt"
         from audit_events a where ($1::uuid is null or a.exam_id = $1::uuid)
        order by a.created_at desc, a.id desc limit 8`,
      [f.examId ?? null],
    )
  ).rows;

  const alerts = await computeAlerts(q, f);

  return {
    generatedAt: new Date().toISOString(),
    today,
    kpis: {
      totalExams: exams.total,
      examsByStatus: { published: exams.published, allocated: exams.allocatedDraft, draft: exams.draft },
      upcomingExams: exams.upcoming,
      activeRooms: rooms.active,
      unavailableRooms: rooms.unavailable,
      seatingCapacity: rooms.capacity,
      eligible: seats.eligible,
      allocated: seats.allocated,
      unallocated: Math.max(0, seats.eligible - seats.allocatedAll),
      bookedCapacity: seats.bookedCapacity,
      utilization: seats.bookedCapacity > 0 ? seats.allocated / seats.bookedCapacity : 0,
      capacityIssues: capacity.shortageExams + capacity.unavailableBookings + seats.overCapacitySeats,
      capacityBreakdown: { ...capacity, overCapacitySeats: seats.overCapacitySeats },
      attendance: {
        ...attendance,
        unmarked: attendance.allocated - attendance.marked,
        completion: attendance.allocated > 0 ? attendance.marked / attendance.allocated : 0,
      },
      pendingRooms: pending.pendingRooms,
      overdueRooms: pending.overdueRooms,
      pendingReports: pending.pendingReports,
    },
    charts: { roomUtilization, attendanceByExam, departments },
    timeline,
    controlCenter: { date: focus, rooms: controlCenter },
    alerts,
    activity,
  };
}

export async function inchargeDashboard(q: Queryable, user: AuthUser) {
  const duties = await listDuties(q, user);
  const relevant = duties.filter((d) => d.examStatus === 'PUBLISHED');
  return {
    today: todayIso(),
    duties,
    summary: {
      assignedRooms: duties.length,
      today: duties.filter((d) => d.timing === 'TODAY').length,
      pendingSubmissions: relevant.filter((d) => d.submissionStatus !== 'FINALIZED' && d.timing !== 'UPCOMING').length,
      finalized: relevant.filter((d) => d.submissionStatus === 'FINALIZED').length,
      studentsToday: duties.filter((d) => d.timing === 'TODAY').reduce((a, d) => a + d.allocated, 0),
    },
  };
}

export async function notificationsFor(q: Queryable, user: AuthUser) {
  if (user.role === 'ADMIN') {
    const alerts = await computeAlerts(q, {});
    return alerts.slice(0, 25).map((a) => ({ id: a.id, severity: a.severity, title: a.title, detail: a.detail, href: a.href }));
  }
  if (user.role === 'INCHARGE') {
    const duties = await listDuties(q, user);
    return duties
      .filter((d) => d.examStatus === 'PUBLISHED' && d.submissionStatus !== 'FINALIZED' && d.timing !== 'UPCOMING')
      .map((d) => ({
        id: `duty:${d.examId}:${d.roomId}`,
        severity: (d.timing === 'PAST' ? 'critical' : 'warning') as AlertSeverity,
        title: d.timing === 'PAST' ? 'Attendance overdue' : 'Attendance due today',
        detail: `${d.courseCode} · Room ${d.roomNo}: ${d.unmarked} unmarked of ${d.allocated}${d.reopenedCount ? ' (reopened by admin)' : ''}`,
        href: `/attendance/${d.examId}/${d.roomId}`,
      }));
  }
  const portal = await studentPortal(q, user);
  return portal.upcoming
    .filter((u) => u.roomNo)
    .map((u) => ({
      id: `seat:${u.examId}`,
      severity: 'info' as AlertSeverity,
      title: 'Seat allocation published',
      detail: `${u.courseCode} on ${u.examDate} (${u.session}) — Room ${u.roomNo}, seat ${u.seatNo}`,
      href: '/my',
    }));
}

export async function studentPortal(q: Queryable, user: AuthUser) {
  const profile = (
    await q.query(
      `select s.id, s.roll_no as "rollNo", s.full_name as "fullName", s.email, s.year, s.section,
              d.code as "departmentCode", d.name as "departmentName"
         from students s join departments d on d.id = s.department_id where s.user_id = $1`,
      [user.id],
    )
  ).rows[0];
  if (!profile) return { profile: null, upcoming: [], history: [] };
  // RLS: only PUBLISHED examinations and the student's own allocation rows are visible here.
  const rows = (
    await q.query<{
      examId: string;
      examName: string;
      examType: string;
      examDate: string;
      session: string;
      startTime: string;
      durationMinutes: number;
      courseCode: string;
      courseName: string;
      credits: number;
      roomNo: string | null;
      block: string | null;
      floor: number | null;
      seatNo: number | null;
      attendance: string | null;
    }>(
      `select e.id as "examId", e.name as "examName", e.exam_type as "examType", e.exam_date as "examDate", e.session,
              to_char(e.start_time, 'HH24:MI') as "startTime", e.duration_minutes as "durationMinutes",
              c.code as "courseCode", c.name as "courseName", c.credits,
              r.room_no as "roomNo", r.block, r.floor, a.seat_no as "seatNo", ar.status as attendance
         from exam_students es
         join examinations e on e.id = es.exam_id
         join courses c on c.id = e.course_id
         left join allocations a on a.exam_id = es.exam_id and a.student_id = es.student_id
         left join rooms r on r.id = a.room_id
         left join attendance_records ar on ar.allocation_id = a.id
        where es.student_id = $1 and e.status = 'PUBLISHED' and e.is_active
        order by e.exam_date, e.session`,
      [profile.id],
    )
  ).rows;
  const today = todayIso();
  return {
    profile,
    upcoming: rows.filter((r) => r.examDate >= today),
    history: rows.filter((r) => r.examDate < today).reverse(),
  };
}
