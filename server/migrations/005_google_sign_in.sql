-- =============================================================================
-- 005_google_sign_in.sql — Google OAuth 2.0 / OpenID Connect sign-in
--
-- * Only pre-registered users can sign in: a Google identity is matched to an
--   existing active account by verified email, then bound to it permanently via
--   the Google subject id (`sub`). A different Google account presenting the same
--   email later is refused until an admin unlinks the binding.
-- * Roles always come from this table — never from Google or the client.
-- * Accounts may be "Google-only" (no usable password).
-- =============================================================================

alter table users add column google_sub text;
alter table users add constraint users_google_sub_key unique (google_sub);

-- read-only flags for the admin UI (the sub itself and the hash stay private)
alter table users add column google_linked boolean generated always as (google_sub is not null) stored;
alter table users add column password_login boolean generated always as (password_hash like 'scrypt$%') stored;
grant select (google_linked, password_login) on users to exam_app;

-- In-flight OAuth authorizations (state / nonce / PKCE verifier). Single use, 10-minute TTL.
-- Privileged access only: no grants and no RLS policies for the application role.
create table oauth_transactions (
  state_hash     text primary key,
  nonce          text not null,
  code_verifier  text not null,
  return_to      text,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
alter table oauth_transactions enable row level security;
create index oauth_transactions_expiry_idx on oauth_transactions(expires_at);

-- Admin: remove a Google binding (e.g. the person changed Google accounts).
create function app.unlink_google(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not app.is_admin() then
    raise exception 'ERR_FORBIDDEN: Only an examination admin can unlink Google accounts';
  end if;
  update users set google_sub = null where id = p_user;
  return found;
end $$;

-- Admin: give a registered student a sign-in account (Google-only) using their register email.
create function app.enable_student_login(p_student uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text; v_name text; v_user uuid; v_uid uuid;
begin
  if not app.is_admin() then
    raise exception 'ERR_FORBIDDEN: Only an examination admin can enable student sign-in';
  end if;
  select lower(email), full_name, user_id into v_email, v_name, v_uid from students where id = p_student and is_active;
  if not found then raise exception 'ERR_NOT_FOUND: Active student not found'; end if;
  if v_uid is not null then raise exception 'ERR_ALREADY_ENABLED: This student can already sign in'; end if;
  if v_email is null then raise exception 'ERR_EMAIL_REQUIRED: Add the student''s email address first'; end if;
  insert into users (email, password_hash, role, full_name) values (v_email, '!google-only', 'STUDENT', v_name)
  returning id into v_user;
  update students set user_id = v_user where id = p_student;
  return v_user;
end $$;

revoke all on function app.unlink_google(uuid), app.enable_student_login(uuid) from public;
grant execute on function app.unlink_google(uuid), app.enable_student_login(uuid) to exam_app;
