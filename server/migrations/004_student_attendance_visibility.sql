-- Students may read their own attendance once the room is finalized. The original policy checked
-- attendance_submissions through RLS, which students cannot read, so the check always failed.
-- A SECURITY DEFINER helper answers "is this room finalized?" without exposing submission rows.
create function app.room_finalized(p_exam uuid, p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from attendance_submissions
                  where exam_id = p_exam and room_id = p_room and status = 'FINALIZED')
$$;
revoke all on function app.room_finalized(uuid, uuid) from public;
grant execute on function app.room_finalized(uuid, uuid) to exam_app;

drop policy attendance_select on attendance_records;
create policy attendance_select on attendance_records for select using (
  app.is_admin() or app.is_assigned_room(exam_id, room_id)
  or (app.student_owns_allocation(allocation_id) and app.room_finalized(exam_id, room_id)));
