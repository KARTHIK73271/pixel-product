-- Display name of a staff member (admin/in-charge) for attendance sheets and reports.
-- Returns null for students and unknown ids, so it cannot be used to enumerate student identities.
create function app.staff_name(p_user uuid) returns text language sql stable security definer set search_path = public as $$
  select full_name from users where id = p_user and role in ('ADMIN', 'INCHARGE') and app.uid() is not null
$$;
revoke all on function app.staff_name(uuid) from public;
grant execute on function app.staff_name(uuid) to exam_app;
