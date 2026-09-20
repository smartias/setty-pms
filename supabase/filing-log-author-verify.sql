-- Filing log author binding — verification. Run AFTER the migration, in the
-- SQL editor (postgres role). Exercises the REAL policies and triggers by
-- switching to the `authenticated` role with a simulated JWT, inside one
-- transaction that always rolls back — nothing it writes survives.
--
-- Every row of the result must show ✓. A ✗ means the migration did not land
-- the way it says it does; roll back via the pms_ops_snapshots row
-- `filing-log-author-binding-rollback-2026-09-20`.

begin;

create temp table verify_results (n int, label text, expect text, got text) on commit drop;
-- The DO block below switches to the `authenticated` role; the temp table
-- belongs to postgres, so that role needs an explicit grant to record results.
grant insert, select on verify_results to authenticated;

do $verify$
declare
  persona text := 'verify.persona@setty.com';
  row_id uuid;
  got text;
begin
  -- Act as a signed-in user with an email claim.
  perform set_config('request.jwt.claims', json_build_object('email', persona, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1. A spoofed user_email is overwritten by the JWT email.
  insert into pms_filing_log (project_id, operation, status, user_email, email_subject)
  values ('verify-project', 'email-sp', 'success', 'someone.else@setty.com', 'verify 1')
  returning id, user_email into row_id, got;
  insert into verify_results values (1, 'insert: spoofed user_email replaced by JWT email', persona, got);

  -- 2. A row written with no user_email (transmittal.html shape) gets the author.
  insert into pms_filing_log (project_id, operation, status, files)
  values ('verify-project', 'transmittal-generated', 'success', '{"transmittalNumber":"T-0"}'::jsonb)
  returning user_email into got;
  insert into verify_results values (2, 'insert: null user_email filled from JWT', persona, got);

  -- 3. Mixed-case JWT email is normalized.
  perform set_config('request.jwt.claims', json_build_object('email', 'Mixed.Case@Setty.com', 'role', 'authenticated')::text, true);
  insert into pms_filing_log (project_id, operation, status)
  values ('verify-project', 'rfi-new', 'success')
  returning user_email into got;
  insert into verify_results values (3, 'insert: JWT email lower-cased', 'mixed.case@setty.com', got);
  perform set_config('request.jwt.claims', json_build_object('email', persona, 'role', 'authenticated')::text, true);

  -- 4. Updating files is allowed (the transmittal register's only write).
  update pms_filing_log set files = '{"transmittalNumber":"T-0","supersededBy":"T-1"}'::jsonb where id = row_id
  returning files ->> 'supersededBy' into got;
  insert into verify_results values (4, 'update: files column accepted', 'T-1', got);

  -- 5. Updating any other column is rejected.
  begin
    update pms_filing_log set status = 'failed' where id = row_id;
    got := 'allowed';
  exception when check_violation then
    got := 'rejected';
  end;
  insert into verify_results values (5, 'update: status column rejected (append-only)', 'rejected', got);

  begin
    update pms_filing_log set user_email = 'tamper@setty.com' where id = row_id;
    got := 'allowed';
  exception when check_violation then
    got := 'rejected';
  end;
  insert into verify_results values (6, 'update: user_email column rejected (append-only)', 'rejected', got);

  -- 7. A JWT with no email claim cannot insert at all.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  begin
    insert into pms_filing_log (project_id, operation, status) values ('verify-project', 'email-sp', 'success');
    got := 'allowed';
  exception when insufficient_privilege then
    got := 'denied';
  end;
  insert into verify_results values (7, 'insert: no-email JWT denied by policy', 'denied', got);

  -- 8. ...nor update.
  begin
    update pms_filing_log set files = '{}'::jsonb where id = row_id;
    get diagnostics got = row_count;
    got := case when got = '0' then 'denied' else 'allowed' end;
  exception when insufficient_privilege then
    got := 'denied';
  end;
  insert into verify_results values (8, 'update: no-email JWT denied by policy', 'denied', got);

  reset role;
end
$verify$;

select n, label, expect, got, case when got = expect then '✓' else '✗ MISMATCH' end as verdict
from verify_results order by n;

rollback;
