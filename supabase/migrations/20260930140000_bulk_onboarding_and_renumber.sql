-- Bulk onboarding (staff + roles, project registration) and project renumber.
--
-- Three admin-only RPCs behind the Admin console's paste boxes. Each takes
-- p_apply: false returns the per-row plan and writes nothing, true does the
-- same work and writes it. The console always previews first.
--
--   pms_admin_bulk_onboard_staff(rows, apply, digest)
--     rows: [{email, name, role, team, title, disciplines[]}]
--     Adds pms_user_roles rows for people who have none, fills a blank
--     display_name / team, and adds or completes their pms_meta staff
--     directory entry. Never changes a role or team already set: the preview
--     reports the difference and the admin changes it by hand.
--
--   pms_admin_bulk_register_projects(rows, apply)
--     rows: [{number, status, name}]
--     Creates a PMS record for each listed number that has a drive-discovery
--     candidate and no record yet. The blob mirrors candidateProjectBlob() in
--     SettyAdmin.html (onboarding.test.mjs pins the key sets together).
--
--   pms_admin_renumber_project(project_id, new_number, apply)
--     Fixes a typo in a record's project number: the record itself and every
--     table that stores the number (RFIs, submittals, meetings, lessons, QA,
--     permissions, drawing index, SETTYfy/Newforma maps). Tables keyed by the
--     record id (emails, filing log) need nothing. The preview lists every
--     table and row count it will touch.

-- ── helpers ─────────────────────────────────────────────────────────────────
-- 8 base-36 characters, the same shape as the app's uid().
create or replace function public.pms_rand_id8()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select string_agg(substr('0123456789abcdefghijklmnopqrstuvwxyz', (get_byte(b, i) % 36) + 1, 1), '' order by i)
  from (select gen_random_bytes(8) b) r, generate_series(0, 7) i;
$$;
revoke all on function public.pms_rand_id8() from public, anon;

-- ── 1. staff + roles ────────────────────────────────────────────────────────
create or replace function public.pms_admin_bulk_onboard_staff(p_rows jsonb, p_apply boolean default false, p_digest boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_by    text := lower(coalesce(auth.jwt()->>'email', ''));
  v_roles text[] := array['admin','project_manager','engineer','operations','accounting','contracts','marketing','qaqc','staff'];
  v_disc  text[] := array['Mechanical','Electrical','Plumbing','Fire Protection'];
  v_staff jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_seen  text[] := '{}';
  v_sum   jsonb := '{}'::jsonb;
  r       jsonb;
  v_email text; v_name text; v_role text; v_team text; v_title text; v_discs jsonb;
  v_cur   public.pms_user_roles%rowtype;
  v_found boolean;
  v_idx   int;
  v_entry jsonb;
  v_acts  text[];
  v_notes text[];
  v_bump  boolean := false;
  k       text;
begin
  if not public.is_pms_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;

  select coalesce(data->'staff', '[]'::jsonb) into v_staff from public.pms_meta where id = 'app_meta' for update;
  if v_staff is null then v_staff := '[]'::jsonb; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(trim(coalesce(r->>'email', '')));
    v_name  := nullif(trim(coalesce(r->>'name', '')), '');
    v_role  := lower(trim(coalesce(r->>'role', '')));
    v_team  := nullif(upper(trim(coalesce(r->>'team', ''))), '');
    v_title := nullif(trim(coalesce(r->>'title', '')), '');
    v_discs := coalesce((select jsonb_agg(d) from jsonb_array_elements_text(coalesce(r->'disciplines', '[]'::jsonb)) d where d = any(v_disc)), '[]'::jsonb);
    v_acts := '{}'; v_notes := '{}';

    if v_email !~ '^[^@\s]+@setty\.com$' then
      v_out := v_out || jsonb_build_object('email', v_email, 'name', v_name, 'result', 'invalid', 'notes', jsonb_build_array('email must be @setty.com'));
      v_sum := jsonb_set(v_sum, '{invalid}', to_jsonb(coalesce((v_sum->>'invalid')::int, 0) + 1));
      continue;
    end if;
    if v_email = any(v_seen) then
      v_out := v_out || jsonb_build_object('email', v_email, 'name', v_name, 'result', 'duplicate', 'notes', jsonb_build_array('listed twice; the first row wins'));
      v_sum := jsonb_set(v_sum, '{duplicate}', to_jsonb(coalesce((v_sum->>'duplicate')::int, 0) + 1));
      continue;
    end if;
    v_seen := v_seen || v_email;
    if not (v_role = any(v_roles)) then
      v_out := v_out || jsonb_build_object('email', v_email, 'name', v_name, 'result', 'invalid', 'notes', jsonb_build_array('unknown role "' || v_role || '"'));
      v_sum := jsonb_set(v_sum, '{invalid}', to_jsonb(coalesce((v_sum->>'invalid')::int, 0) + 1));
      continue;
    end if;

    -- Role registry.
    select * into v_cur from public.pms_user_roles where lower(email) = v_email;
    if not found then
      v_acts := v_acts || 'role_added'::text;
      if p_apply then
        insert into public.pms_user_roles (email, role, display_name, team, added_by, updated_at)
        values (v_email, v_role, v_name, v_team, v_by, now());
        if p_digest then
          insert into public.pms_user_prefs (email, weekly_digest, digest_scope, updated_at)
          values (v_email, true, 'mine', now()) on conflict (email) do nothing;
        end if;
      end if;
    else
      if v_cur.role <> v_role then v_notes := v_notes || ('role kept as ' || v_cur.role || ' (sheet says ' || v_role || ')'); end if;
      if v_cur.team is not null and v_team is not null and v_cur.team <> v_team then v_notes := v_notes || ('team kept as ' || v_cur.team || ' (sheet says ' || v_team || ')'); end if;
      if (v_cur.display_name is null and v_name is not null) or (v_cur.team is null and v_team is not null) then
        v_acts := v_acts || 'role_filled'::text;
        if p_apply then
          update public.pms_user_roles
             set display_name = coalesce(display_name, v_name), team = coalesce(team, v_team), updated_at = now()
           where lower(email) = v_email;
        end if;
      end if;
    end if;

    -- Staff directory: by email, else a same-named entry with no email.
    v_found := false; v_idx := null;
    select (o - 1)::int into v_idx from jsonb_array_elements(v_staff) with ordinality e(x, o)
     where lower(coalesce(x->>'email', '')) = v_email limit 1;
    if v_idx is not null then
      v_found := true;
      if coalesce((v_staff->v_idx->>'inactive')::boolean, false) then v_notes := v_notes || 'marked inactive in the staff directory'::text; end if;
    elsif v_name is not null then
      select (o - 1)::int into v_idx from jsonb_array_elements(v_staff) with ordinality e(x, o)
       where coalesce(x->>'email', '') = '' and lower(trim(coalesce(x->>'name', ''))) = lower(v_name) limit 1;
      if v_idx is not null then
        v_found := true;
        v_acts := v_acts || 'directory_email_filled'::text;
        v_staff := jsonb_set(v_staff, array[v_idx::text, 'email'], to_jsonb(v_email));
        v_bump := true;
      end if;
    end if;
    if v_found then
      v_entry := v_staff->v_idx;
      if coalesce(v_entry->>'role', '') = '' and v_title is not null then
        v_staff := jsonb_set(v_staff, array[v_idx::text, 'role'], to_jsonb(v_title)); v_bump := true;
        if not ('directory_email_filled' = any(v_acts)) then v_acts := v_acts || 'directory_filled'::text; end if;
      end if;
      if jsonb_array_length(coalesce(v_entry->'disciplines', '[]'::jsonb)) = 0 and jsonb_array_length(v_discs) > 0 then
        v_staff := jsonb_set(v_staff, array[v_idx::text, 'disciplines'], v_discs); v_bump := true;
        if not ('directory_email_filled' = any(v_acts) or 'directory_filled' = any(v_acts)) then v_acts := v_acts || 'directory_filled'::text; end if;
      end if;
    else
      if v_name is null then
        v_notes := v_notes || 'no name, so no staff directory entry'::text;
      else
        v_acts := v_acts || 'directory_added'::text;
        v_staff := v_staff || jsonb_build_object('id', public.pms_rand_id8(), 'name', v_name, 'email', v_email,
          'role', coalesce(v_title, ''), 'rate', 0, 'disciplines', v_discs, 'overhead', false, 'inactive', false);
        v_bump := true;
      end if;
    end if;

    v_out := v_out || jsonb_build_object('email', v_email, 'name', v_name, 'role', v_role, 'team', v_team,
      'result', case when cardinality(v_acts) = 0 then 'unchanged' else 'changed' end,
      'actions', to_jsonb(v_acts), 'notes', to_jsonb(v_notes));
    foreach k in array v_acts loop
      v_sum := jsonb_set(v_sum, array[k], to_jsonb(coalesce((v_sum->>k)::int, 0) + 1));
    end loop;
    if cardinality(v_acts) = 0 then v_sum := jsonb_set(v_sum, '{unchanged}', to_jsonb(coalesce((v_sum->>'unchanged')::int, 0) + 1)); end if;
  end loop;

  if p_apply and v_bump then
    insert into public.pms_meta (id, data, updated_at)
    values ('app_meta', jsonb_build_object('staff', v_staff, 'termContracts', '[]'::jsonb), now())
    on conflict (id) do update set data = jsonb_set(coalesce(public.pms_meta.data, '{}'::jsonb), '{staff}', v_staff), updated_at = now();
  end if;

  return jsonb_build_object('applied', p_apply, 'summary', v_sum, 'rows', v_out);
end;
$$;
revoke all on function public.pms_admin_bulk_onboard_staff(jsonb, boolean, boolean) from public, anon;
grant execute on function public.pms_admin_bulk_onboard_staff(jsonb, boolean, boolean) to authenticated;

-- ── 2. project registration ─────────────────────────────────────────────────
-- Mirrors candidateProjectBlob() in SettyAdmin.html key for key.
create or replace function public.pms_candidate_project_blob(c public.pms_project_candidates, p_id text, p_name text, p_status text, p_by text)
returns jsonb
language sql
volatile
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p_id, 'name', p_name, 'projectNumber', c.project_number, 'projectManager', '', 'deputyProjectManager', '', 'prime', '',
    'projectAddress', '', 'projectCity', '', 'projectState', '', 'status', p_status, 'proposalDueDate', '', 'probability', 100,
    'clientName', '', 'clientContact', '', 'projectContacts', jsonb_build_object('proposal', '[]'::jsonb, 'pm', '[]'::jsonb, 'contract', '[]'::jsonb, 'accounting', '[]'::jsonb),
    'contractStatus', 'Waiting for NTP/Contract', 'contractNotes', '', 'feeType', 'Lump Sum', 'primeProjectNumber', '',
    'contractNumber', '', 'contractDate', '', 'contractFolderUrl', '', 'projectFolderUrl', '', 'proposalFolderUrl', '',
    'feeCalculatorSubs', '[]'::jsonb, 'rfis', '[]'::jsonb, 'submittals', '[]'::jsonb, 'submittalRegister', '[]'::jsonb, 'rfiDueDays', 5, 'submittalDueDays', 10,
    'phaseSubFees', '{}'::jsonb, 'contractExpirationDate', '', 'archived', false, 'checklists', '[]'::jsonb, 'buildingCategory', 'Office',
    'squareFootage', 0, 'manualConstructionCost', 0, 'projectType', 'Type II New Construction', 'disciplinePercentOverrides', '{}'::jsonb,
    'phases', '[]'::jsonb, 'feeScheduleFinalized', false
  ) || jsonb_build_object(  -- split: jsonb_build_object takes at most 100 arguments
    'teamMembers', jsonb_build_array(
      jsonb_build_object('id', public.pms_rand_id8(), 'name', '', 'role', 'Project Manager', 'rate', 0),
      jsonb_build_object('id', public.pms_rand_id8(), 'name', '', 'role', 'Deputy Project Manager', 'rate', 0)),
    'milestones', '[]'::jsonb, 'changeOrders', '[]'::jsonb, 'emails', '[]'::jsonb, 'invoices', '[]'::jsonb,
    'startDate', to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'isTaskOrder', false,
    'taskOrderTermContractId', '', 'taskOrderNumber', '', 'relatedGroup', '', 'relatedRole', '', 'scopeContent', '', 'scopeLocked', false,
    'scopeAuditLog', '[]'::jsonb, 'proposalFinalized', null, 'notes', '[]'::jsonb, 'oneNoteUrl', '', 'oneNoteNotebookUrl', '', 'oneNoteNotebookId', '',
    'teamsOneNoteNotebookId', '', 'teamsOneNoteUrl', '', 'teamsChannelFolderUrl', '',
    'externalLinks', jsonb_build_array(jsonb_build_object('id', public.pms_rand_id8(), 'label', 'Project folder (' || c.share_label || ': drive)', 'url', c.drive_path)),
    'clientUploadsFolderUrl', '', 'settyDeliverablesFolderUrl', '', 'reimbursableBudget', 0, 'reimbursables', '[]'::jsonb,
    'createdFrom', jsonb_build_object('source', 'drive-discovery-bulk', 'drivePath', c.drive_path,
      'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', p_by)
  );
$$;
revoke all on function public.pms_candidate_project_blob(public.pms_project_candidates, text, text, text, text) from public, anon;

create or replace function public.pms_admin_bulk_register_projects(p_rows jsonb, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_by       text := lower(coalesce(auth.jwt()->>'email', ''));
  v_statuses text[] := array['Not Started','In Progress','In for Review','On Hold','Top Priority','In Construction Administration','Completed'];
  v_out      jsonb := '[]'::jsonb;
  v_sum      jsonb := '{}'::jsonb;
  v_seen     text[] := '{}';
  r          jsonb;
  v_num      text; v_status text; v_name text; v_res text; v_note text;
  v_rec      record;
  c          public.pms_project_candidates%rowtype;
  v_id       text;
begin
  if not public.is_pms_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_num    := upper(regexp_replace(coalesce(r->>'number', ''), '\s', '', 'g'));
    v_status := nullif(trim(coalesce(r->>'status', '')), '');
    v_name   := nullif(trim(coalesce(r->>'name', '')), '');
    v_note   := null; v_id := null;
    c := null;

    if v_num = '' then continue; end if;
    if v_num = any(v_seen) then
      v_res := 'duplicate'; v_note := 'listed twice';
    else
      v_seen := v_seen || v_num;
      select id, project->>'name' nm, project->>'status' st into v_rec
        from public.pms_projects where upper(project->>'projectNumber') = v_num limit 1;
      select * into c from public.pms_project_candidates where project_number = v_num;

      if v_rec.id is not null then
        v_res := 'already_registered'; v_id := v_rec.id;
        v_note := v_rec.nm || coalesce(' · ' || v_rec.st, '');
        if v_status is not null and v_rec.st is distinct from v_status then v_note := v_note || ' (sheet says ' || v_status || '; not changed)'; end if;
        if c.project_number is not null and c.status <> 'created' and p_apply then
          update public.pms_project_candidates
             set status = 'created', created_project_id = v_rec.id, note = 'Already in the PMS (bulk list)', reviewed_at = now(), reviewed_by = v_by
           where project_number = v_num;
        end if;
      elsif c.project_number is null then
        v_res := 'no_folder'; v_note := 'no drive folder with this number in the scans';
      elsif c.pms_match_id is not null then
        v_res := 'likely_existing'; v_note := 'likely already in the PMS as ' || coalesce(c.pms_match_number, '?') || ' — use Link to it';
      elsif coalesce(v_status, 'In Progress') <> all(v_statuses) then
        v_res := 'bad_status'; v_note := 'status "' || v_status || '" is not a PMS status';
      elsif coalesce(v_name, nullif(trim(c.name_from_folder), '')) is null then
        v_res := 'needs_name'; v_note := 'the folder has no 00- name; add a name column';
      else
        v_res := 'create';
        v_name := coalesce(v_name, trim(c.name_from_folder));
        v_note := v_name || ' · ' || coalesce(v_status, 'In Progress') || ' · ' || c.team || ' ' || c.share_label || ':';
        if c.status = 'dismissed' then v_note := v_note || ' (was dismissed)'; end if;
        if p_apply then
          loop
            v_id := public.pms_rand_id8();
            exit when not exists (select 1 from public.pms_projects where id = v_id);
          end loop;
          insert into public.pms_projects (id, project, version, updated_at, team, updated_by)
          values (v_id, public.pms_candidate_project_blob(c, v_id, v_name, coalesce(v_status, 'In Progress'), v_by), 1, now(), c.team, v_by);
          update public.pms_project_candidates
             set status = 'created', created_project_id = v_id, reviewed_at = now(), reviewed_by = v_by
           where project_number = v_num;
        end if;
      end if;
    end if;

    v_out := v_out || jsonb_build_object('number', v_num, 'result', v_res, 'note', v_note, 'project_id', v_id,
      'team', c.team, 'folder', c.folder_name);
    v_sum := jsonb_set(v_sum, array[v_res], to_jsonb(coalesce((v_sum->>v_res)::int, 0) + 1));
  end loop;

  return jsonb_build_object('applied', p_apply, 'summary', v_sum, 'rows', v_out);
end;
$$;
revoke all on function public.pms_admin_bulk_register_projects(jsonb, boolean) from public, anon;
grant execute on function public.pms_admin_bulk_register_projects(jsonb, boolean) to authenticated;

-- ── 3. renumber ─────────────────────────────────────────────────────────────
-- Columns that hold a project NUMBER. 'upper' compares case-insensitively and
-- writes the new number as typed; 'lower' is the drawing index, which keys
-- by the lowercased number. Columns that hold the record id are harmless
-- here: an 8-character id never equals a project number. Accounting imports
-- (pms_ar_invoices), telemetry and backup tables are left alone on purpose.
create or replace function public.pms_admin_renumber_project(p_project_id text, p_new_number text, p_apply boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_by    text := lower(coalesce(auth.jwt()->>'email', ''));
  v_new   text := upper(regexp_replace(coalesce(p_new_number, ''), '\s', '', 'g'));
  v_old   text;
  v_name  text;
  v_furl  text;
  v_cols  text[][] := array[
    ['pms_rfis','project_number','upper'], ['pms_rfis','project_id','upper'],
    ['pms_submittals','project_number','upper'], ['pms_submittals','project_id','upper'],
    ['pms_rfi_events','project_number','upper'], ['pms_submittal_events','project_number','upper'],
    ['pms_meetings','project_number','upper'], ['pms_meeting_items','project_number','upper'],
    ['pms_meeting_sweep_state','project_number','upper'], ['pms_owner_comments','project_number','upper'],
    ['pms_project_disciplines','project_number','upper'], ['pms_project_permissions','project_number','upper'],
    ['pms_project_scope_ai','project_number','upper'], ['pms_settyfy_map','project_number','upper'],
    ['pms_settyfy_sov_map','project_number','upper'], ['pms_newforma_project_map','project_number','upper'],
    ['pms_field_photo_sessions','project_number','upper'], ['pms_lessons','project_id','upper'],
    ['photo_catalog','project_num','upper'], ['pms_qa_findings','project','upper'], ['pms_qa_reviews','project','upper'],
    ['pms_ca_review_feedback','project','upper'], ['pms_ii_agent_runs','project_id','upper'],
    ['pms_ii_brief_feedback','project_id','upper'], ['pms_project_analysis','project_id','upper'],
    ['pms_drawing_index_files','project_prefix','lower'], ['pms_drawing_text','project_prefix','lower']];
  i       int;
  v_n     bigint;
  v_touch jsonb := '[]'::jsonb;
  v_warn  jsonb := '[]'::jsonb;
  v_cand  text;
  v_seg   text;
begin
  if not public.is_pms_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select project->>'projectNumber', project->>'name', project->>'projectFolderUrl' into v_old, v_name, v_furl
    from public.pms_projects where id = p_project_id;
  if not found then raise exception 'No PMS record with id %', p_project_id; end if;
  v_old := trim(coalesce(v_old, ''));
  if v_old = '' then raise exception 'This record has no project number yet (pipeline job); set it in the PMS app instead'; end if;
  if v_new !~ '^[A-Z]{2,6}[0-9]{5,7}\.[0-9]{2}(\.[0-9]{2})?$' then raise exception 'Not a project number: "%"', v_new; end if;
  if upper(v_old) = v_new then raise exception 'The record already has number %', v_new; end if;
  if exists (select 1 from public.pms_projects where id <> p_project_id and upper(project->>'projectNumber') = v_new) then
    raise exception '% already belongs to another PMS record; link the folder to that one instead', v_new;
  end if;

  for i in 1 .. array_length(v_cols, 1) loop
    if to_regclass('public.' || v_cols[i][1]) is null
       or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v_cols[i][1] and column_name = v_cols[i][2]) then
      continue;
    end if;
    if v_cols[i][3] = 'lower' then
      execute format('select count(*) from public.%I where %I = $1', v_cols[i][1], v_cols[i][2]) into v_n using lower(v_old);
    else
      execute format('select count(*) from public.%I where upper(%I::text) = $1', v_cols[i][1], v_cols[i][2]) into v_n using upper(v_old);
    end if;
    if v_n > 0 then
      v_touch := v_touch || jsonb_build_object('table', v_cols[i][1], 'column', v_cols[i][2], 'rows', v_n);
      if p_apply then
        if v_cols[i][3] = 'lower' then
          execute format('update public.%I set %I = $1 where %I = $2', v_cols[i][1], v_cols[i][2], v_cols[i][2]) using lower(v_new), lower(v_old);
        else
          execute format('update public.%I set %I = $1 where upper(%I::text) = $2', v_cols[i][1], v_cols[i][2], v_cols[i][2]) using v_new, upper(v_old);
        end if;
      end if;
    end if;
  end loop;

  -- The folder the record points at is not renamed. If its name carries the
  -- old number the connector's by-number lookup stops finding it; an Azure
  -- drive folder linked through pms_project_candidates is still found
  -- (azureLinkedFolder in pms-mcp).
  v_seg := regexp_replace(coalesce(v_furl, ''), '/+$', '');
  v_seg := regexp_replace(v_seg, '^.*/', '');
  if v_seg <> '' and upper(v_seg) like upper(v_old) || '%' then
    v_warn := v_warn || to_jsonb('The project folder is still named with ' || v_old || ' (' || v_furl || '). Rename it to start with '
      || v_new || ' in SharePoint (NY) so the connector finds it by number. A drive folder that drive discovery linked to this record is still found.');
  end if;

  select status into v_cand from public.pms_project_candidates where project_number = v_new;
  if v_cand is not null and v_cand <> 'created' then
    v_touch := v_touch || jsonb_build_object('table', 'pms_project_candidates', 'column', 'status', 'rows', 1, 'note', 'the ' || v_new || ' drive folder is marked as this record');
  end if;

  if p_apply then
    if to_regclass('public.pms_mcp_tree_cache') is not null then
      delete from public.pms_mcp_tree_cache where project_prefix = lower(v_old) or project_prefix like lower(v_old) || '#%';
    end if;
    update public.pms_projects
       set project = jsonb_set(project, '{projectNumber}', to_jsonb(v_new)),
           version = version + 1, updated_at = now(), updated_by = v_by
     where id = p_project_id;
    if v_cand is not null and v_cand <> 'created' then
      update public.pms_project_candidates
         set status = 'created', created_project_id = p_project_id, note = 'Record renumbered from ' || v_old,
             reviewed_at = now(), reviewed_by = v_by
       where project_number = v_new;
    end if;
  end if;

  return jsonb_build_object('applied', p_apply, 'project_id', p_project_id, 'name', v_name,
    'old_number', v_old, 'new_number', v_new, 'touched', v_touch, 'warnings', v_warn);
end;
$$;
revoke all on function public.pms_admin_renumber_project(text, text, boolean) from public, anon;
grant execute on function public.pms_admin_renumber_project(text, text, boolean) to authenticated;
