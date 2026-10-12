-- =============================================================================
-- 002_security.sql — least-privilege application role + Row-Level Security
--
-- Every API request runs inside a transaction that executes
--   SET LOCAL ROLE exam_app; set_config('app.user_id', <session user>, true)
-- so the policies below apply to all application reads and writes. The role
-- is derived from the users table, never from client input.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'exam_app') then
    create role exam_app nologin;
  end if;
end $$;
-- allow the connecting (migration/owner) user to switch into the role
grant exam_app to current_user;

-- ----------------------------------------------------------------------------
-- Identity helpers
-- ----------------------------------------------------------------------------
create function app.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.user_role() returns user_role language sql stable security definer set search_path = public as $$
  select role from users where id = app.uid() and is_active
$$;

create function app.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'ADMIN' from users where id = app.uid() and is_active), false)
$$;

create function app.is_incharge() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'INCHARGE' from users where id = app.uid() and is_active), false)
$$;

create function app.my_student_id() returns uuid language sql stable security definer set search_path = public as $$
  select s.id from students s join users u on u.id = s.user_id
   where s.user_id = app.uid() and s.is_active and u.is_active and u.role = 'STUDENT'
$$;

create function app.is_assigned_room(p_exam uuid, p_room uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from incharge_assignments
                  where exam_id = p_exam and room_id = p_room and incharge_id = app.uid())
         and app.is_incharge()
$$;

create function app.is_assigned_exam(p_exam uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from incharge_assignments where exam_id = p_exam and incharge_id = app.uid())
         and app.is_incharge()
$$;

create function app.exam_published(p_exam uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from examinations where id = p_exam and status = 'PUBLISHED' and is_active)
$$;

create function app.student_visible_to_incharge(p_student uuid) returns boolean language sql stable security definer set search_path = public as $$
  select app.is_incharge() and exists (
    select 1 from allocations a
      join incharge_assignments ia on ia.exam_id = a.exam_id and ia.room_id = a.room_id
     where a.student_id = p_student and ia.incharge_id = app.uid())
$$;

create function app.student_owns_allocation(p_allocation uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from allocations a
                  where a.id = p_allocation and a.student_id = app.my_student_id()
                    and app.exam_published(a.exam_id))
$$;

-- Append-only audit writer: the actor is taken from the session, never from arguments.
create function app.log_event(p_action text, p_entity_type text, p_entity_id text, p_exam_id uuid,
                              p_summary text, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := app.uid(); v_name text; v_role user_role;
begin
  if v_uid is null then
    raise exception 'ERR_UNAUTHENTICATED: No authenticated actor for audit event';
  end if;
  select full_name, role into v_name, v_role from users where id = v_uid;
  insert into audit_events (actor_id, actor_name, actor_role, action, entity_type, entity_id, exam_id, summary, metadata)
  values (v_uid, v_name, v_role, p_action, p_entity_type, p_entity_id, p_exam_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end $$;

revoke all on all functions in schema app from public;
grant usage on schema app to exam_app;
grant usage on schema public to exam_app;
grant execute on function app.uid(), app.user_role(), app.is_admin(), app.is_incharge(), app.my_student_id(),
  app.is_assigned_room(uuid, uuid), app.is_assigned_exam(uuid), app.exam_published(uuid),
  app.student_visible_to_incharge(uuid), app.student_owns_allocation(uuid),
  app.log_event(text, text, text, uuid, text, jsonb), app.tg_touch_updated_at()
  to exam_app;

-- ----------------------------------------------------------------------------
-- Table privileges (column-level where secrets exist). sessions: no access.
-- ----------------------------------------------------------------------------
grant select (id, email, role, full_name, is_active, last_login_at, created_at, updated_at) on users to exam_app;
grant insert (email, password_hash, role, full_name, is_active) on users to exam_app;
grant update (full_name, is_active) on users to exam_app;

grant select, insert, update, delete on departments, courses, rooms, students, examinations,
  exam_students, exam_rooms, incharge_assignments, allocations,
  attendance_records, attendance_submissions to exam_app;
grant select on audit_events to exam_app;

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- ----------------------------------------------------------------------------
alter table users                  enable row level security;
alter table departments            enable row level security;
alter table courses                enable row level security;
alter table rooms                  enable row level security;
alter table students               enable row level security;
alter table examinations           enable row level security;
alter table exam_students          enable row level security;
alter table exam_rooms             enable row level security;
alter table incharge_assignments   enable row level security;
alter table allocations            enable row level security;
alter table attendance_records     enable row level security;
alter table attendance_submissions enable row level security;
alter table audit_events           enable row level security;
alter table sessions               enable row level security;  -- no policies: deny all to exam_app

-- users: self, or admins
create policy users_select on users for select using (id = app.uid() or app.is_admin());
create policy users_admin_insert on users for insert with check (app.is_admin());
create policy users_admin_update on users for update using (app.is_admin()) with check (app.is_admin());

-- reference data: readable by any authenticated user, writable by admins
create policy departments_read on departments for select using (app.uid() is not null);
create policy departments_admin on departments for all using (app.is_admin()) with check (app.is_admin());
create policy courses_read on courses for select using (app.uid() is not null);
create policy courses_admin on courses for all using (app.is_admin()) with check (app.is_admin());
create policy rooms_read on rooms for select using (app.uid() is not null);
create policy rooms_admin on rooms for all using (app.is_admin()) with check (app.is_admin());

-- students: admin; the student themself; in-charges for students seated in their rooms
create policy students_select on students for select using (
  app.is_admin() or id = app.my_student_id() or app.student_visible_to_incharge(id));
create policy students_admin on students for all using (app.is_admin()) with check (app.is_admin());

-- examinations: admin; assigned in-charge; eligible student once published
create policy examinations_select on examinations for select using (
  app.is_admin()
  or app.is_assigned_exam(id)
  or (status = 'PUBLISHED' and is_active and exists (
        select 1 from exam_students es where es.exam_id = examinations.id and es.student_id = app.my_student_id())));
create policy examinations_admin on examinations for all using (app.is_admin()) with check (app.is_admin());

create policy exam_students_select on exam_students for select using (
  app.is_admin() or app.is_assigned_exam(exam_id)
  or (student_id = app.my_student_id() and app.exam_published(exam_id)));
create policy exam_students_admin on exam_students for all using (app.is_admin()) with check (app.is_admin());

create policy exam_rooms_select on exam_rooms for select using (app.is_admin() or app.is_assigned_room(exam_id, room_id));
create policy exam_rooms_admin on exam_rooms for all using (app.is_admin()) with check (app.is_admin());

create policy incharge_select on incharge_assignments for select using (app.is_admin() or (incharge_id = app.uid() and app.is_incharge()));
create policy incharge_admin on incharge_assignments for all using (app.is_admin()) with check (app.is_admin());

-- allocations: students only ever see their own row, and only when published
create policy allocations_select on allocations for select using (
  app.is_admin() or app.is_assigned_room(exam_id, room_id)
  or (student_id = app.my_student_id() and app.exam_published(exam_id)));
create policy allocations_admin on allocations for all using (app.is_admin()) with check (app.is_admin());

-- attendance: admin or the in-charge of that exact (exam, room); students read their own finalized marks
create policy attendance_select on attendance_records for select using (
  app.is_admin() or app.is_assigned_room(exam_id, room_id)
  or (app.student_owns_allocation(allocation_id) and exists (
        select 1 from attendance_submissions s where s.exam_id = attendance_records.exam_id
           and s.room_id = attendance_records.room_id and s.status = 'FINALIZED')));
create policy attendance_insert on attendance_records for insert with check (
  (app.is_admin() or app.is_assigned_room(exam_id, room_id)) and marked_by = app.uid());
create policy attendance_update on attendance_records for update
  using (app.is_admin() or app.is_assigned_room(exam_id, room_id))
  with check ((app.is_admin() or app.is_assigned_room(exam_id, room_id)) and marked_by = app.uid());
create policy attendance_delete on attendance_records for delete using (app.is_admin() or app.is_assigned_room(exam_id, room_id));

create policy submissions_select on attendance_submissions for select using (app.is_admin() or app.is_assigned_room(exam_id, room_id));
create policy submissions_insert on attendance_submissions for insert with check (
  app.is_admin() or (app.is_assigned_room(exam_id, room_id) and status = 'IN_PROGRESS'));
-- in-charges can only touch IN_PROGRESS rows (finalized rows are invisible to their UPDATE)
create policy submissions_update on attendance_submissions for update
  using (app.is_admin() or (app.is_assigned_room(exam_id, room_id) and status = 'IN_PROGRESS'))
  with check (app.is_admin() or (app.is_assigned_room(exam_id, room_id) and (status = 'IN_PROGRESS' or finalized_by = app.uid())));
create policy submissions_admin_delete on attendance_submissions for delete using (app.is_admin());

-- audit: admins read everything; others read their own actions
create policy audit_select on audit_events for select using (app.is_admin() or actor_id = app.uid());
