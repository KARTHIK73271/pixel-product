import type {
  CourseInput,
  DepartmentInput,
  RoomInput,
  StudentInput,
  UserCreateInput,
} from '../../shared/schemas';
import type { AuthUser } from '../auth/session';
import { hashPassword } from '../auth/password';
import type { Queryable } from '../db/index';
import { badRequest, notFound } from '../http/errors';
import { audit } from './audit';
import { Params, todayIso } from './sql';

// ---------------------------------------------------------------------------
// Departments & courses
// ---------------------------------------------------------------------------
export async function listDepartments(q: Queryable) {
  return (
    await q.query(
      `select d.id, d.code, d.name,
              (select count(*) from students s where s.department_id = d.id and s.is_active)::int as "studentCount",
              (select count(*) from courses c where c.department_id = d.id)::int as "courseCount"
         from departments d order by d.code`,
    )
  ).rows;
}

export async function createDepartment(q: Queryable, input: DepartmentInput) {
  const r = await q.query<{ id: string }>('insert into departments (code, name) values ($1, $2) returning id', [input.code, input.name]);
  await audit(q, { action: 'DEPARTMENT_CREATED', entityType: 'department', entityId: r.rows[0].id, summary: `Created department ${input.code}` });
  return r.rows[0];
}

export async function listCourses(q: Queryable) {
  return (
    await q.query(
      `select c.id, c.code, c.name, c.year, c.credits, c.department_id as "departmentId", d.code as "departmentCode",
              (select count(*) from examinations e where e.course_id = c.id and e.is_active)::int as "examCount"
         from courses c join departments d on d.id = c.department_id order by c.code`,
    )
  ).rows;
}

export async function createCourse(q: Queryable, input: CourseInput) {
  const r = await q.query<{ id: string }>(
    'insert into courses (code, name, department_id, year, credits) values ($1, $2, $3, $4, $5) returning id',
    [input.code, input.name, input.departmentId, input.year, input.credits],
  );
  await audit(q, { action: 'COURSE_CREATED', entityType: 'course', entityId: r.rows[0].id, summary: `Created course ${input.code} — ${input.name}` });
  return r.rows[0];
}

export async function updateCourse(q: Queryable, id: string, input: CourseInput) {
  const r = await q.query('update courses set code = $2, name = $3, department_id = $4, year = $5, credits = $6 where id = $1', [
    id,
    input.code,
    input.name,
    input.departmentId,
    input.year,
    input.credits,
  ]);
  if (!r.rowCount) throw notFound('Course');
  await audit(q, { action: 'COURSE_UPDATED', entityType: 'course', entityId: id, summary: `Updated course ${input.code}` });
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
/**
 * Room list with load. "Allocated" is the peak seat count in any single upcoming slot (active
 * exams dated today or later), and remaining = capacity − peak — i.e. headroom in the busiest slot.
 */
export async function listRooms(q: Queryable, opts: { q?: string; status?: string; date?: string; session?: string }) {
  const b = new Params();
  const where: string[] = [];
  if (opts.q) {
    const like = b.p(`%${opts.q}%`);
    where.push(`(r.room_no ilike ${like} or r.block ilike ${like})`);
  }
  if (opts.status) where.push(`r.status = ${b.p(opts.status)}`);
  const today = b.p(todayIso());
  const slotDate = b.p(opts.date ?? null);
  const slotSession = b.p(opts.session ?? null);
  return (
    await q.query(
      `select r.id, r.room_no as "roomNo", r.block, r.floor, r.capacity, r.status, r.notes,
              (select count(*) from exam_rooms er join examinations e on e.id = er.exam_id
                where er.room_id = r.id and e.is_active and e.exam_date >= ${today}::date)::int as "upcomingBookings",
              coalesce((select max(cnt) from (
                  select count(a.id) as cnt from exam_rooms er
                    join examinations e on e.id = er.exam_id and e.is_active
                    left join allocations a on a.exam_id = er.exam_id and a.room_id = er.room_id
                   where er.room_id = r.id
                     and (case when ${slotDate}::date is null then e.exam_date >= ${today}::date
                               else e.exam_date = ${slotDate}::date and (${slotSession}::exam_session is null or e.session = ${slotSession}::exam_session) end)
                   group by er.exam_id) t), 0)::int as allocated,
              (select json_agg(json_build_object('examId', e.id, 'name', e.name, 'examDate', e.exam_date, 'session', e.session,
                         'allocated', (select count(*) from allocations a where a.exam_id = e.id and a.room_id = r.id))
                       order by e.exam_date, e.session)
                 from exam_rooms er join examinations e on e.id = er.exam_id
                where er.room_id = r.id and e.is_active and e.exam_date >= ${today}::date) as bookings
         from rooms r
        ${where.length ? `where ${where.join(' and ')}` : ''}
        order by r.block, r.room_no`,
      b.values,
    )
  ).rows.map((r) => ({ ...r, remaining: r.capacity - r.allocated, bookings: r.bookings ?? [] }));
}

export async function createRoom(q: Queryable, input: RoomInput) {
  const r = await q.query<{ id: string }>(
    `insert into rooms (room_no, block, floor, capacity, status, notes) values ($1, $2, $3, $4, $5, $6) returning id`,
    [input.roomNo, input.block, input.floor ?? null, input.capacity, input.status, input.notes ?? null],
  );
  await audit(q, {
    action: 'ROOM_CREATED',
    entityType: 'room',
    entityId: r.rows[0].id,
    summary: `Created room ${input.roomNo} (${input.capacity} seats, ${input.status.toLowerCase()})`,
  });
  return r.rows[0];
}

export async function updateRoom(q: Queryable, id: string, input: RoomInput) {
  const prev = await q.query<{ room_no: string; capacity: number; status: string }>(
    'select room_no, capacity, status from rooms where id = $1 for update',
    [id],
  );
  if (!prev.rows[0]) throw notFound('Room');
  await q.query('update rooms set room_no = $2, block = $3, floor = $4, capacity = $5, status = $6, notes = $7 where id = $1', [
    id,
    input.roomNo,
    input.block,
    input.floor ?? null,
    input.capacity,
    input.status,
    input.notes ?? null,
  ]);
  const p = prev.rows[0];
  const changes = [
    p.capacity !== input.capacity ? `capacity ${p.capacity} → ${input.capacity}` : '',
    p.status !== input.status ? `status ${p.status} → ${input.status}` : '',
    p.room_no !== input.roomNo ? `number ${p.room_no} → ${input.roomNo}` : '',
  ].filter(Boolean);
  await audit(q, {
    action: 'ROOM_UPDATED',
    entityType: 'room',
    entityId: id,
    summary: `Updated room ${input.roomNo}${changes.length ? ` (${changes.join(', ')})` : ''}`,
  });
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------
export async function listStudents(
  q: Queryable,
  opts: { q?: string; departmentId?: string; year?: number; section?: string; page: number; pageSize: number },
) {
  const b = new Params();
  const where: string[] = [];
  if (opts.q) {
    const like = b.p(`%${opts.q}%`);
    where.push(`(s.roll_no ilike ${like} or s.full_name ilike ${like})`);
  }
  if (opts.departmentId) where.push(`s.department_id = ${b.p(opts.departmentId)}`);
  if (opts.year) where.push(`s.year = ${b.p(opts.year)}`);
  if (opts.section) where.push(`s.section = ${b.p(opts.section)}`);
  const limit = b.p(opts.pageSize);
  const offset = b.p((opts.page - 1) * opts.pageSize);
  const r = await q.query<Record<string, unknown> & { total: number }>(
    `select s.id, s.roll_no as "rollNo", s.full_name as "fullName", s.email, s.year, s.section, s.is_active as "isActive",
            s.department_id as "departmentId", d.code as "departmentCode", (s.user_id is not null) as "hasLogin",
            coalesce((select u.google_linked from users u where u.id = s.user_id), false) as "googleLinked",
            (select count(*) from exam_students es join examinations e on e.id = es.exam_id
              where es.student_id = s.id and e.is_active)::int as "examCount",
            count(*) over ()::int as total
       from students s join departments d on d.id = s.department_id
      ${where.length ? `where ${where.join(' and ')}` : ''}
      order by d.code, s.year, s.section, s.roll_no
      limit ${limit} offset ${offset}`,
    b.values,
  );
  return { items: r.rows.map(({ total: _t, ...row }) => row), total: r.rows[0]?.total ?? 0, page: opts.page, pageSize: opts.pageSize };
}

export async function createStudent(q: Queryable, input: StudentInput) {
  const r = await q.query<{ id: string }>(
    `insert into students (roll_no, full_name, email, department_id, year, section, is_active)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.rollNo, input.fullName, input.email ?? null, input.departmentId, input.year, input.section, input.isActive],
  );
  await audit(q, { action: 'STUDENT_CREATED', entityType: 'student', entityId: r.rows[0].id, summary: `Created student ${input.rollNo} — ${input.fullName}` });
  return r.rows[0];
}

export async function updateStudent(q: Queryable, id: string, input: StudentInput) {
  const r = await q.query(
    `update students set roll_no = $2, full_name = $3, email = $4, department_id = $5, year = $6, section = $7, is_active = $8
      where id = $1`,
    [id, input.rollNo, input.fullName, input.email ?? null, input.departmentId, input.year, input.section, input.isActive],
  );
  if (!r.rowCount) throw notFound('Student');
  await audit(q, { action: 'STUDENT_UPDATED', entityType: 'student', entityId: id, summary: `Updated student ${input.rollNo}` });
}

// ---------------------------------------------------------------------------
// Staff accounts
// ---------------------------------------------------------------------------
export async function listStaff(q: Queryable) {
  return (
    await q.query(
      `select u.id, u.email, u.full_name as "fullName", u.role, u.is_active as "isActive", u.last_login_at as "lastLoginAt",
              u.google_linked as "googleLinked", u.password_login as "passwordLogin",
              (select count(*) from incharge_assignments ia join examinations e on e.id = ia.exam_id
                where ia.incharge_id = u.id and e.is_active and e.exam_date >= $1::date)::int as "upcomingDuties"
         from users u where u.role in ('ADMIN', 'INCHARGE') order by u.role, u.full_name`,
      [todayIso()],
    )
  ).rows;
}

/** Marker stored instead of a hash for Google-only accounts: never matches any password. */
export const GOOGLE_ONLY_HASH = '!google-only';

export async function createStaff(q: Queryable, input: UserCreateInput) {
  const hash = input.password ? await hashPassword(input.password) : GOOGLE_ONLY_HASH;
  const r = await q.query<{ id: string }>(
    `insert into users (email, password_hash, role, full_name) values ($1, $2, $3, $4) returning id`,
    [input.email, hash, input.role, input.fullName],
  );
  await audit(q, {
    action: 'USER_CREATED',
    entityType: 'user',
    entityId: r.rows[0].id,
    summary: `Created ${input.role === 'ADMIN' ? 'admin' : 'in-charge'} account for ${input.fullName}${input.password ? '' : ' (Google sign-in only)'}`,
  });
  return r.rows[0];
}

export async function unlinkGoogle(q: Queryable, id: string) {
  const r = await q.query<{ ok: boolean }>('select app.unlink_google($1) as ok', [id]);
  if (!r.rows[0].ok) throw notFound('User');
  await audit(q, { action: 'GOOGLE_UNLINKED', entityType: 'user', entityId: id, summary: 'Removed the Google account binding from a user' });
}

export async function enableStudentLogin(q: Queryable, studentId: string) {
  const r = await q.query<{ id: string }>('select app.enable_student_login($1) as id', [studentId]);
  const s = await q.query<{ roll_no: string; email: string }>('select roll_no, email from students where id = $1', [studentId]);
  await audit(q, {
    action: 'STUDENT_LOGIN_ENABLED',
    entityType: 'student',
    entityId: studentId,
    summary: `Enabled Google sign-in for ${s.rows[0].roll_no} (${s.rows[0].email})`,
  });
  return { userId: r.rows[0].id };
}

export async function updateStaff(q: Queryable, actor: AuthUser, id: string, input: { fullName?: string; isActive?: boolean }) {
  if (id === actor.id && input.isActive === false) throw badRequest('You cannot deactivate your own account.');
  const r = await q.query<{ full_name: string }>(
    `update users set full_name = coalesce($2, full_name), is_active = coalesce($3, is_active)
      where id = $1 and role in ('ADMIN', 'INCHARGE') returning full_name`,
    [id, input.fullName ?? null, input.isActive ?? null],
  );
  if (!r.rows[0]) throw notFound('User');
  await audit(q, {
    action: 'USER_UPDATED',
    entityType: 'user',
    entityId: id,
    summary: `Updated account ${r.rows[0].full_name}${input.isActive === false ? ' (deactivated)' : input.isActive ? ' (activated)' : ''}`,
  });
}

// ---------------------------------------------------------------------------
// Global search (scoped by role; RLS hides everything else anyway)
// ---------------------------------------------------------------------------
export async function search(q: Queryable, user: AuthUser, term: string) {
  const like = `%${term}%`;
  const exams = (
    await q.query(
      `select e.id, e.name, c.code as "courseCode", e.exam_date as "examDate", e.session, e.status
         from examinations e join courses c on c.id = e.course_id
        where e.is_active and (e.name ilike $1 or c.code ilike $1 or c.name ilike $1)
        order by e.exam_date limit 6`,
      [like],
    )
  ).rows;
  if (user.role !== 'ADMIN') return { exams, students: [], rooms: [] };
  const students = (
    await q.query(
      `select s.id, s.roll_no as "rollNo", s.full_name as "fullName", d.code as "departmentCode", s.section
         from students s join departments d on d.id = s.department_id
        where s.roll_no ilike $1 or s.full_name ilike $1 order by s.roll_no limit 6`,
      [like],
    )
  ).rows;
  const rooms = (
    await q.query(
      `select id, room_no as "roomNo", block, capacity, status from rooms
        where room_no ilike $1 or block ilike $1 order by room_no limit 6`,
      [like],
    )
  ).rows;
  return { exams, students, rooms };
}
