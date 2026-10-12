-- =============================================================================
-- 006 — (a) up to two faculty in-charges per exam hall
--       (b) a branch-specific examination only admits students of that branch
-- =============================================================================

-- (a) one row per (exam, hall, faculty) instead of one row per hall --------------
alter table incharge_assignments drop constraint incharge_assignments_pkey;
alter table incharge_assignments add constraint incharge_assignments_pkey primary key (exam_id, room_id, incharge_id);
create index incharge_assignments_room_idx on incharge_assignments(exam_id, room_id);

create function app.tg_incharge_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare v_room text;
begin
  -- serialise concurrent assignments to the same hall, then count the other faculty already there
  perform 1 from exam_rooms where exam_id = new.exam_id and room_id = new.room_id for update;
  if (select count(*) from incharge_assignments
       where exam_id = new.exam_id and room_id = new.room_id and incharge_id <> new.incharge_id) >= 2 then
    select room_no into v_room from rooms where id = new.room_id;
    raise exception 'ERR_TOO_MANY_INCHARGES: Exam hall % already has 2 faculty in-charges (the maximum)', v_room;
  end if;
  return new;
end $$;
create trigger incharge_assignments_limit before insert or update of exam_id, room_id, incharge_id on incharge_assignments
  for each row execute function app.tg_incharge_limit();

-- Names of the faculty in a hall, for anyone allowed to see that hall (admins and its own
-- in-charges — so co-invigilators can see each other even though RLS hides others' rows).
create function app.room_incharge_names(p_exam uuid, p_room uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when app.is_admin() or app.is_assigned_room(p_exam, p_room) then
    (select string_agg(u.full_name, ', ' order by ia.assigned_at, u.full_name)
       from incharge_assignments ia join users u on u.id = ia.incharge_id
      where ia.exam_id = p_exam and ia.room_id = p_room)
  end
$$;
revoke all on function app.room_incharge_names(uuid, uuid) from public;
grant execute on function app.room_incharge_names(uuid, uuid) to exam_app;

-- (b) branch rule ------------------------------------------------------------------
-- Enrolment: when an examination names a department, every eligible student must belong to it.
create function app.tg_exam_student_branch() returns trigger language plpgsql security definer set search_path = public as $$
declare v_exam_dept uuid; v_student_dept uuid; v_code text; v_roll text; v_student_code text;
begin
  select department_id into v_exam_dept from examinations where id = new.exam_id;
  if v_exam_dept is null then return new; end if;   -- multi-department paper
  select s.department_id, s.roll_no, d.code into v_student_dept, v_roll, v_student_code
    from students s join departments d on d.id = s.department_id where s.id = new.student_id;
  if v_student_dept is distinct from v_exam_dept then
    select code into v_code from departments where id = v_exam_dept;
    raise exception 'ERR_BRANCH_MISMATCH: % is a % student; this examination is only for % students', v_roll, v_student_code, v_code;
  end if;
  return new;
end $$;
create trigger exam_students_branch before insert or update of exam_id, student_id on exam_students
  for each row execute function app.tg_exam_student_branch();

-- Re-targeting an examination to a branch is refused while other-branch students are enrolled.
create function app.tg_exam_branch_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_count int; v_code text;
begin
  if new.department_id is not null and new.department_id is distinct from old.department_id then
    select count(*) into v_count
      from exam_students es join students s on s.id = es.student_id
     where es.exam_id = new.id and s.department_id <> new.department_id;
    if v_count > 0 then
      select code into v_code from departments where id = new.department_id;
      raise exception 'ERR_BRANCH_MISMATCH: % enrolled student(s) are not in %. Remove them before restricting this examination to %', v_count, v_code, v_code;
    end if;
  end if;
  return new;
end $$;
create trigger examinations_branch_change before update of department_id on examinations
  for each row execute function app.tg_exam_branch_change();

-- Moving a student to another branch is refused while they sit an active exam restricted to the old one.
create function app.tg_student_branch_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_exam text;
begin
  if new.department_id is distinct from old.department_id then
    select e.name into v_exam
      from exam_students es join examinations e on e.id = es.exam_id
     where es.student_id = new.id and e.is_active and e.department_id is not null and e.department_id <> new.department_id
     limit 1;
    if v_exam is not null then
      raise exception 'ERR_BRANCH_MISMATCH: % is enrolled in “%”, which is restricted to their current branch. Remove them from it first', new.roll_no, v_exam;
    end if;
  end if;
  return new;
end $$;
create trigger students_branch_change before update of department_id on students
  for each row execute function app.tg_student_branch_change();
