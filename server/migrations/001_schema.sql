-- =============================================================================
-- 001_schema.sql — core schema for the Smart Examination Section system
--
-- Policy decisions enforced here (see README "Integrity rules"):
--   * A student may sit at most ONE active examination per (date, session).
--   * A room is booked by at most ONE active examination per (date, session),
--     so seat numbers are unique per room per slot.
--   * An in-charge supervises at most ONE room per (date, session).
--   * Attendance is a row per allocated student; "unmarked" = no row.
--   * Finalized attendance can never be edited/deleted without an admin reopen.
-- The (exam_date, session, exam_active) columns on child tables are kept in sync
-- with examinations via ON UPDATE CASCADE composite foreign keys, which lets
-- plain partial unique indexes enforce the per-slot rules above.
-- =============================================================================

create schema if not exists app;

create type user_role as enum ('ADMIN', 'INCHARGE', 'STUDENT');
create type exam_session as enum ('FN', 'AN');
create type exam_type as enum ('INTERNAL', 'MIDTERM', 'END_SEMESTER', 'SUPPLEMENTARY');
create type exam_status as enum ('DRAFT', 'ALLOCATED', 'PUBLISHED');
create type room_status as enum ('AVAILABLE', 'MAINTENANCE', 'RETIRED');
create type attendance_mark as enum ('PRESENT', 'ABSENT');
create type submission_status as enum ('IN_PROGRESS', 'FINALIZED');

create function app.tg_touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Identity
-- ----------------------------------------------------------------------------
create table departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[A-Z]{2,10}$'),
  name        text not null check (length(name) between 2 and 120),
  created_at  timestamptz not null default now(),
  constraint departments_code_key unique (code),
  constraint departments_name_key unique (name)
);

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash  text not null,
  role           user_role not null,
  full_name      text not null check (length(full_name) between 2 and 120),
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint users_email_key unique (email)
);
create trigger users_touch before update on users for each row execute function app.tg_touch_updated_at();

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text,
  user_agent  text,
  constraint sessions_token_hash_key unique (token_hash)
);
create index sessions_user_idx on sessions(user_id);

create table students (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete set null,
  roll_no        text not null check (roll_no ~ '^[A-Z0-9]{4,20}$'),
  full_name      text not null check (length(full_name) between 2 and 120),
  email          text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  department_id  uuid not null references departments(id),
  year           smallint not null check (year between 1 and 5),
  section        text not null check (section ~ '^[A-Z]$'),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint students_roll_no_key unique (roll_no),
  constraint students_user_id_key unique (user_id)
);
create index students_cohort_idx on students(department_id, year, section);
create trigger students_touch before update on students for each row execute function app.tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Academic catalogue & infrastructure
-- ----------------------------------------------------------------------------
create table courses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null check (code ~ '^[A-Z]{2,6}[0-9]{3,4}[A-Z]?$'),
  name           text not null check (length(name) between 2 and 160),
  department_id  uuid not null references departments(id),
  year           smallint not null check (year between 1 and 5),
  credits        smallint not null default 3 check (credits between 0 and 10),
  created_at     timestamptz not null default now(),
  constraint courses_code_key unique (code)
);

create table rooms (
  id          uuid primary key default gen_random_uuid(),
  room_no     text not null check (room_no ~ '^[A-Z0-9-]{1,12}$'),
  block       text not null check (length(block) between 1 and 40),
  floor       smallint check (floor between -2 and 50),
  capacity    integer not null check (capacity > 0 and capacity <= 500),
  status      room_status not null default 'AVAILABLE',
  notes       text check (notes is null or length(notes) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint rooms_room_no_key unique (room_no)
);
create trigger rooms_touch before update on rooms for each row execute function app.tg_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Examinations
-- ----------------------------------------------------------------------------
create table examinations (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(name) between 3 and 160),
  exam_type         exam_type not null,
  course_id         uuid not null references courses(id),
  department_id     uuid references departments(id),          -- null = multi-department
  year              smallint not null check (year between 1 and 5),
  section           text check (section is null or section ~ '^[A-Z]$'), -- null = all sections
  exam_date         date not null,
  session           exam_session not null,
  start_time        time not null,
  duration_minutes  smallint not null check (duration_minutes between 30 and 300),
  status            exam_status not null default 'DRAFT',
  is_active         boolean not null default true,
  published_at      timestamptz,
  published_by      uuid references users(id),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint examinations_slot_key unique (id, exam_date, session, is_active),
  constraint examinations_publication_chk check ((status = 'PUBLISHED') = (published_at is not null)),
  constraint examinations_inactive_draft_chk check (is_active or status = 'DRAFT')
);
-- "Duplicate applicable course/session record": one active exam per course + type + section.
create unique index examinations_course_type_section_uniq
  on examinations (course_id, exam_type, coalesce(section, '*')) where is_active;
create index examinations_date_idx on examinations(exam_date, session);
create trigger examinations_touch before update on examinations for each row execute function app.tg_touch_updated_at();

create table exam_students (
  exam_id      uuid not null,
  student_id   uuid not null references students(id),
  exam_date    date not null,
  session      exam_session not null,
  exam_active  boolean not null,
  added_at     timestamptz not null default now(),
  primary key (exam_id, student_id),
  constraint exam_students_exam_fk foreign key (exam_id, exam_date, session, exam_active)
    references examinations (id, exam_date, session, is_active) on update cascade on delete cascade
);
create unique index exam_students_slot_uniq on exam_students (student_id, exam_date, session) where exam_active;

create table exam_rooms (
  exam_id      uuid not null,
  room_id      uuid not null references rooms(id),
  exam_date    date not null,
  session      exam_session not null,
  exam_active  boolean not null,
  added_at     timestamptz not null default now(),
  primary key (exam_id, room_id),
  constraint exam_rooms_slot_key unique (exam_id, room_id, exam_date, session, exam_active),
  constraint exam_rooms_exam_fk foreign key (exam_id, exam_date, session, exam_active)
    references examinations (id, exam_date, session, is_active) on update cascade on delete cascade
);
create unique index exam_rooms_slot_uniq on exam_rooms (room_id, exam_date, session) where exam_active;

create table incharge_assignments (
  exam_id      uuid not null,
  room_id      uuid not null,
  incharge_id  uuid not null references users(id),
  exam_date    date not null,
  session      exam_session not null,
  exam_active  boolean not null,
  assigned_by  uuid references users(id),
  assigned_at  timestamptz not null default now(),
  primary key (exam_id, room_id),
  constraint incharge_room_fk foreign key (exam_id, room_id, exam_date, session, exam_active)
    references exam_rooms (exam_id, room_id, exam_date, session, exam_active) on update cascade on delete cascade
);
create unique index incharge_slot_uniq on incharge_assignments (incharge_id, exam_date, session) where exam_active;
create index incharge_assignments_user_idx on incharge_assignments(incharge_id);

-- ----------------------------------------------------------------------------
-- Seating allocation
-- ----------------------------------------------------------------------------
create table allocations (
  id            uuid primary key default gen_random_uuid(),
  exam_id       uuid not null,
  student_id    uuid not null,
  room_id       uuid not null,
  seat_no       integer not null check (seat_no > 0),
  allocated_by  uuid references users(id),
  allocated_at  timestamptz not null default now(),
  constraint allocations_exam_student_key unique (exam_id, student_id),
  constraint allocations_exam_room_seat_key unique (exam_id, room_id, seat_no),
  constraint allocations_id_exam_room_key unique (id, exam_id, room_id),
  constraint allocations_eligible_fk foreign key (exam_id, student_id)
    references exam_students (exam_id, student_id) on delete restrict,
  constraint allocations_room_fk foreign key (exam_id, room_id)
    references exam_rooms (exam_id, room_id) on delete restrict
);
create index allocations_student_idx on allocations(student_id);
create index allocations_room_idx on allocations(room_id);

-- ----------------------------------------------------------------------------
-- Attendance
-- ----------------------------------------------------------------------------
create table attendance_submissions (
  exam_id             uuid not null,
  room_id             uuid not null,
  status              submission_status not null default 'IN_PROGRESS',
  finalized_by        uuid references users(id),
  finalized_at        timestamptz,
  reopened_count      integer not null default 0 check (reopened_count >= 0),
  last_reopen_reason  text,
  last_reopened_by    uuid references users(id),
  last_reopened_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (exam_id, room_id),
  constraint submissions_room_fk foreign key (exam_id, room_id)
    references exam_rooms (exam_id, room_id) on delete restrict,
  constraint submissions_finalized_chk check ((status = 'FINALIZED') = (finalized_at is not null and finalized_by is not null))
);
create trigger submissions_touch before update on attendance_submissions for each row execute function app.tg_touch_updated_at();

create table attendance_records (
  allocation_id  uuid primary key,
  exam_id        uuid not null,
  room_id        uuid not null,
  status         attendance_mark not null,
  marked_by      uuid not null references users(id),
  marked_at      timestamptz not null default now(),
  constraint attendance_allocation_fk foreign key (allocation_id, exam_id, room_id)
    references allocations (id, exam_id, room_id) on delete restrict on update restrict
);
create index attendance_exam_room_idx on attendance_records(exam_id, room_id);

-- ----------------------------------------------------------------------------
-- Audit trail (append-only)
-- ----------------------------------------------------------------------------
create table audit_events (
  id           bigint generated always as identity primary key,
  actor_id     uuid references users(id),
  actor_name   text,
  actor_role   user_role,
  action       text not null check (action ~ '^[A-Z_]{3,60}$'),
  entity_type  text not null,
  entity_id    text,
  exam_id      uuid references examinations(id),
  summary      text not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_events_created_idx on audit_events(created_at desc);
create index audit_events_exam_idx on audit_events(exam_id, created_at desc);

create function app.tg_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'ERR_AUDIT_IMMUTABLE: Audit events are append-only';
end $$;
create trigger audit_events_no_update before update or delete on audit_events
  for each row execute function app.tg_audit_immutable();

-- ----------------------------------------------------------------------------
-- Integrity triggers (SECURITY DEFINER so they see all rows regardless of RLS)
-- ----------------------------------------------------------------------------

-- Only users with role INCHARGE may be assigned as room in-charges.
create function app.tg_incharge_role() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from users where id = new.incharge_id and role = 'INCHARGE' and is_active) then
    raise exception 'ERR_INVALID_INCHARGE: Assigned user is not an active examination in-charge';
  end if;
  return new;
end $$;
create trigger incharge_assignments_role before insert or update of incharge_id on incharge_assignments
  for each row execute function app.tg_incharge_role();

-- Rooms can only be booked while AVAILABLE.
create function app.tg_exam_room_available() returns trigger language plpgsql security definer set search_path = public as $$
declare st room_status; rno text;
begin
  select status, room_no into st, rno from rooms where id = new.room_id;
  if st is distinct from 'AVAILABLE' then
    raise exception 'ERR_ROOM_UNAVAILABLE: Room % is % and cannot be assigned', rno, lower(st::text);
  end if;
  return new;
end $$;
create trigger exam_rooms_available before insert on exam_rooms
  for each row execute function app.tg_exam_room_available();

-- Seats must fit the room and the room must be available; finalized rooms are frozen.
create function app.tg_allocation_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; st room_status; rno text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if exists (select 1 from attendance_submissions s
               where s.exam_id = old.exam_id and s.room_id = old.room_id and s.status = 'FINALIZED') then
      raise exception 'ERR_FINALIZED: Allocations in a room with finalized attendance cannot be changed';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select capacity, status, room_no into cap, st, rno from rooms where id = new.room_id;
    if st is distinct from 'AVAILABLE' then
      raise exception 'ERR_ROOM_UNAVAILABLE: Room % is not available for allocation', rno;
    end if;
    if new.seat_no > cap then
      raise exception 'ERR_OVER_CAPACITY: Seat % exceeds the capacity (%) of room %', new.seat_no, cap, rno;
    end if;
    if exists (select 1 from attendance_submissions s
               where s.exam_id = new.exam_id and s.room_id = new.room_id and s.status = 'FINALIZED') then
      raise exception 'ERR_FINALIZED: Room % has finalized attendance; allocations are frozen', rno;
    end if;
    return new;
  end if;
  return old;
end $$;
create trigger allocations_guard before insert or update or delete on allocations
  for each row execute function app.tg_allocation_guard();

-- Capacity can't shrink below seats already handed out in active examinations.
create function app.tg_room_capacity_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare max_seat int;
begin
  if new.capacity < old.capacity then
    select max(a.seat_no) into max_seat
      from allocations a join examinations e on e.id = a.exam_id
     where a.room_id = new.id and e.is_active;
    if max_seat is not null and new.capacity < max_seat then
      raise exception 'ERR_CAPACITY_IN_USE: Capacity cannot be reduced below % (highest allocated seat)', max_seat;
    end if;
  end if;
  return new;
end $$;
create trigger rooms_capacity_guard before update of capacity on rooms
  for each row execute function app.tg_room_capacity_guard();

-- Attendance only for published exams, never for finalized rooms.
create function app.tg_attendance_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_exam uuid; v_room uuid;
begin
  if tg_op = 'DELETE' then v_exam := old.exam_id; v_room := old.room_id;
  else v_exam := new.exam_id; v_room := new.room_id; end if;

  if exists (select 1 from attendance_submissions s
             where s.exam_id = v_exam and s.room_id = v_room and s.status = 'FINALIZED') then
    raise exception 'ERR_FINALIZED: Attendance for this room is finalized and locked';
  end if;
  if tg_op = 'UPDATE' and (new.exam_id <> old.exam_id or new.room_id <> old.room_id) then
    raise exception 'ERR_IMMUTABLE: Attendance cannot be moved between rooms';
  end if;
  if tg_op <> 'DELETE' and not exists (select 1 from examinations e where e.id = v_exam and e.status = 'PUBLISHED' and e.is_active) then
    raise exception 'ERR_NOT_PUBLISHED: Attendance can only be recorded for published examinations';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger attendance_records_guard before insert or update or delete on attendance_records
  for each row execute function app.tg_attendance_guard();

-- Submission state machine:
--   IN_PROGRESS -> FINALIZED  only when every allocated student is marked
--   FINALIZED   -> IN_PROGRESS only by an ADMIN with a recorded reason (reopen)
create function app.tg_submission_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare v_alloc int; v_marked int; v_role user_role;
begin
  if new.status = 'FINALIZED' and (tg_op = 'INSERT' or old.status <> 'FINALIZED') then
    select count(*) into v_alloc from allocations where exam_id = new.exam_id and room_id = new.room_id;
    select count(*) into v_marked from attendance_records where exam_id = new.exam_id and room_id = new.room_id;
    if v_alloc = 0 then
      raise exception 'ERR_NO_ALLOCATIONS: There are no allocated students in this room';
    end if;
    if v_marked < v_alloc then
      raise exception 'ERR_INCOMPLETE: % of % students are still unmarked', v_alloc - v_marked, v_alloc;
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'FINALIZED' and new.status <> 'FINALIZED' then
    v_role := (select role from users where id = nullif(current_setting('app.user_id', true), '')::uuid);
    -- privileged maintenance connections (no app.user_id) are allowed; app users must be ADMIN
    if current_setting('app.user_id', true) is not null and current_setting('app.user_id', true) <> ''
       and v_role is distinct from 'ADMIN' then
      raise exception 'ERR_FORBIDDEN: Only an examination admin can reopen finalized attendance';
    end if;
    if new.last_reopen_reason is null or length(trim(new.last_reopen_reason)) < 10
       or new.reopened_count <> old.reopened_count + 1 then
      raise exception 'ERR_REOPEN_REASON: Reopening requires a recorded reason';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'FINALIZED' and new.status = 'FINALIZED'
     and (new.finalized_at <> old.finalized_at or new.finalized_by <> old.finalized_by) then
    raise exception 'ERR_FINALIZED: Submission is already finalized';
  end if;
  return new;
end $$;
create trigger attendance_submissions_guard before insert or update on attendance_submissions
  for each row execute function app.tg_submission_guard();
