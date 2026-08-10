// pms-user-emails — Supabase Edge Function.
//
// Two routes, both sending via Resend:
//   POST /welcome  — admin-only (JWT checked against my_pms_role). Called by
//                    the Admin Console right after a user is added to
//                    pms_user_roles. Sends the "you've been added" email.
//   POST /digest   — weekly "My Projects" digest to OPTED-IN users only
//                    (pms_user_prefs.weekly_digest = true; digest_scope
//                    'mine' = projects they're on via teamMembers, 'all' =
//                    every active project). Triggered Monday mornings by
//                    pg_cron, guarded by the x-pms-cron header whose value
//                    lives in pms_integration_secrets (name 'user-emails-cron').
//                    Also callable by an admin JWT for testing:
//                      ?dryRun=1   — build everything, send nothing, report
//                      ?only=a@b   — restrict recipients (testing)
//
// Digest item rules ported from the never-deployed weekly-digest draft
// (confirmed by Sara 2026-05-29): RFI open = status "Open"; submittal open =
// "Under Review"; milestones !cancelled && <100% due in 21 days; action items
// = notes with actionItem flag not done (undated ones in a separate bucket).
// Action items are per-person (Sara, 2026-08-10): an item whose owner resolves
// to a staff email appears only in that owner's digest.
// "⚠ Overdue" section (Sara, 2026-08-10): open action items / RFIs / submittals
// past their due date, ONLY when assigned to the recipient. Milestones are
// deliberately excluded — they often aren't closed out until Monday midday,
// so an overdue-milestone list would be noisy and inaccurate.
//
// verify_jwt is OFF (browser CORS preflight can't carry a JWT) — every route
// enforces its own auth above. No external imports: plain fetch against
// Supabase REST with the service-role key.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("DIGEST_FROM_EMAIL") || "Setty PMS <digest@pms.setty.com>";
const PMS_URL = "https://smartias.github.io/setty-pms/SettyPMS.html";
const LOOKAHEAD_DAYS = 21;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-pms-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// ── Supabase REST helpers (service role) ─────────────────────────────────────
async function svc(path: string): Promise<any> {
  const res = await fetch(SUPABASE_URL + "/rest/v1" + path, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`REST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
// PostgREST caps every response at 1000 rows — page until a short page.
async function svcAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await svc(`${path}${sep}limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// Caller-is-admin check: replay the caller's JWT against my_pms_role().
async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer .{20,}/.test(auth)) return false;
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/my_pms_role", {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: auth, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return false;
    return (await res.json()) === "admin";
  } catch (_) {
    return false;
  }
}

async function cronKeyValid(req: Request): Promise<boolean> {
  const given = req.headers.get("x-pms-cron") || "";
  if (!given) return false;
  const rows = await svc("/pms_integration_secrets?name=eq.user-emails-cron&select=token");
  return rows.length > 0 && rows[0].token === given;
}

// ── Resend ───────────────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not configured — add it under Supabase → Edge Functions → Secrets (see resend.com, free tier).");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ── Shared HTML bits (plain tables + inline styles for Outlook) ──────────────
const esc = (s: string) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shell(title: string, inner: string, today: Date): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>${esc(title)}</title></head>
<body style="background:#f5f7fa;padding:0;margin:0">
  <table style="background:#fff;max-width:760px;margin:24px auto;border-collapse:collapse;font-family:Calibri,'Segoe UI',sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-radius:6px;overflow:hidden">
    <tr><td style="padding:28px">
      ${inner}
      <div style="font-size:9pt;color:#999;margin-top:32px;border-top:1px solid #eee;padding-top:12px">
        Setty PMS · ${today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </td></tr>
  </table>
</body></html>`;
}

// ── /welcome ─────────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", project_manager: "Project Manager", engineer: "Engineer",
  operations: "Operations", accounting: "Accounting", contracts: "Contracts",
  marketing: "Marketing", qaqc: "QA/QC", staff: "Staff",
};

function welcomeHtml(p: { email: string; role: string; display_name?: string; added_by?: string }, today: Date): string {
  const first = (p.display_name || p.email.split("@")[0]).split(/[\s.]/)[0];
  const role = ROLE_LABELS[p.role] || p.role;
  const adminNote = p.role === "admin"
    ? `<li style="margin:6px 0">As an <b>Admin</b> you also have the <a href="https://smartias.github.io/setty-pms/SettyAdmin.html" style="color:#1F3864">Admin Console</a>: users &amp; roles, permissions, backups and integrations.</li>`
    : "";
  return shell("Welcome to the Setty PMS", `
    <div style="font-size:20pt;color:#1F3864;font-weight:700;line-height:1.1">Welcome to the Setty PMS</div>
    <div style="font-size:11pt;color:#666;margin-top:6px">You've been added as <b style="color:#1F3864">${esc(role)}</b>${p.added_by ? ` by ${esc(p.added_by)}` : ""}</div>
    <hr style="border:none;border-top:2px solid #C00000;margin:14px 0" />
    <p style="font-size:11pt;color:#222">Hi ${esc(first[0].toUpperCase() + first.slice(1))},</p>
    <p style="font-size:11pt;color:#222">The PMS is Setty's home for projects: milestones, RFIs &amp; submittals, project emails, site photos and more. Your role shapes what you see, so it's already set up for how you work.</p>
    <ul style="font-size:11pt;color:#222;padding-left:20px">
      <li style="margin:6px 0"><b>Sign in once</b>: open the <a href="${PMS_URL}" style="color:#1F3864">PMS</a> and click "Sign in with Microsoft". Use your ${esc(p.email)} account; there's no separate password.</li>
      <li style="margin:6px 0"><b>Check for the Outlook add-in</b>: open any email in Outlook and look for the <b>Setty PMS</b> button on the ribbon (under the "..." / <i>Apps</i> menu if the ribbon is crowded). That is how project email gets filed, along with notes, RFIs and submittals. It is deployed centrally, so if you don't see it, ask IT to add you.</li>
      <li style="margin:6px 0"><b>Keep the add-in pinned open</b>: click the 📌 pin at the top of the Setty PMS panel once. The panel then stays open as you move from message to message and shows you what it knows about each one, including the project it belongs to, that project's recent history, and whether the email is waiting on a reply. Pinned is how it earns its keep; opened one email at a time, it is just a filing button.</li>
      <li style="margin:6px 0"><b>Start with the explainer</b>: the <a href="https://setty.sharepoint.com/sites/NYCProjects/SitePages/Project-Documentation-and-Communication.aspx" style="color:#1F3864">Project Documentation &amp; Communication</a> page covers how Setty files, documents and communicates project work. Five minutes well spent before your first project.</li>
      <li style="margin:6px 0"><b>Build "My Projects"</b>: the My Projects tab lets you join the projects you work on; joining puts you on the project's Team tab.</li>
      <li style="margin:6px 0"><b>Optional weekly digest</b>: under My Projects → ⚙ My Settings you can turn on a Monday-morning email of everything due on your projects in the next three weeks.</li>
      ${adminNote}
    </ul>
    <p style="font-size:11pt;color:#222">Questions? Reply to this email or ask Sara Arias / Danny Kang.</p>
  `, today);
}

// ── /digest ──────────────────────────────────────────────────────────────────
type Item = { type: string; label: string; dueDate?: string; owner?: string; ownerEmails?: string[] };
type ProjDigest = { projectName: string; projectNumber: string; items: Item[]; undatedActions: Item[]; overdue: Item[] };

const TYPE_LABELS: Record<string, string> = {
  milestone: "📍 Milestone", rfi: "❓ RFI", submittal: "📋 Submittal", action: "✅ Action",
};

function inLookahead(due: string | undefined, today: Date): boolean {
  if (!due) return false;
  const d = new Date(due + "T00:00:00");
  if (isNaN(d.getTime())) return false;
  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + LOOKAHEAD_DAYS);
  return d >= start && d <= end;
}
const fmtDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s + "T12:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
};

// Digest scope: awarded, active work only — no pipeline (proposal) projects,
// no On Hold, nothing closed out (Sara, 2026-07-18). Explicit allow-list so a
// future new status defaults to excluded until someone decides otherwise.
const DIGEST_STATUSES = new Set([
  "Not Started", "In Progress", "In for Review", "Top Priority",
  "In Construction Administration",
]);

function buildProjectDigest(project: any, today: Date, nameToEmail: Map<string, string>): ProjDigest | null {
  if (!project || project.archived || !DIGEST_STATUSES.has(project.status || "")) return null;
  const items: Item[] = [];
  const undatedActions: Item[] = [];
  const overdue: Item[] = [];

  const startOfToday = new Date(today); startOfToday.setHours(0, 0, 0, 0);
  const isOverdue = (due?: string) => {
    if (!due) return false;
    const d = new Date(due + "T00:00:00");
    return !isNaN(d.getTime()) && d < startOfToday;
  };
  // rfis[]/submittals[].assignedTo holds per-project teamMembers IDs (arrays,
  // possibly several people) — resolve through this project's team, falling
  // back to the staff roster by name for members without an email field.
  const idToEmail = new Map<string, string>();
  for (const tm of project.teamMembers || []) {
    const email = (tm.email || "").toLowerCase().trim() || nameToEmail.get((tm.name || "").toLowerCase().trim()) || "";
    if (tm.id && email) idToEmail.set(tm.id, email);
  }
  const assigneeEmails = (assignedTo: unknown): string[] =>
    (Array.isArray(assignedTo) ? assignedTo : [])
      .map(id => idToEmail.get(String(id)))
      .filter((e): e is string => !!e);

  // Milestones stay look-ahead only — no overdue bucket for them (Sara,
  // 2026-08-10: often closed out Monday midday, overdue would be noise).
  for (const m of project.milestones || []) {
    if (!m.cancelled && (m.pctComplete ?? 0) < 100 && inLookahead(m.dueDate, today)) {
      items.push({ type: "milestone", label: m.name || "(unnamed milestone)", dueDate: m.dueDate });
    }
  }
  for (const r of project.rfis || []) {
    if (r.status !== "Open") continue;
    const label = [r.number, r.title].filter(Boolean).join(" — ");
    if (inLookahead(r.dueDate, today)) items.push({ type: "rfi", label, dueDate: r.dueDate });
    else if (isOverdue(r.dueDate)) {
      const ownerEmails = assigneeEmails(r.assignedTo);
      if (ownerEmails.length) overdue.push({ type: "rfi", label, dueDate: r.dueDate, ownerEmails });
    }
  }
  for (const s of project.submittals || []) {
    if (s.status !== "Under Review") continue;
    const label = [s.number, s.description].filter(Boolean).join(" — ");
    if (inLookahead(s.dueDate, today)) items.push({ type: "submittal", label, dueDate: s.dueDate });
    else if (isOverdue(s.dueDate)) {
      const ownerEmails = assigneeEmails(s.assignedTo);
      if (ownerEmails.length) overdue.push({ type: "submittal", label, dueDate: s.dueDate, ownerEmails });
    }
  }
  for (const n of project.notes || []) {
    // The Outlook add-in writes owner/dueDate/status; the PMS writes
    // actionOwner/actionDueDate/actionStatus. Coalesce so add-in items
    // bucket by their real due date instead of landing in "Anytime".
    const status = String(n.actionStatus || n.status || "open").toLowerCase();
    if (!n.actionItem || ["done", "completed", "closed"].includes(status)) continue;
    const due = n.actionDueDate || n.dueDate || undefined;
    const owner = (n.actionOwner || n.owner || "").trim() || undefined;
    const ownerEmail = owner ? nameToEmail.get(owner.toLowerCase()) : undefined;
    const item: Item = {
      type: "action",
      label: (n.body || "").slice(0, 120).trim() || "(no description)",
      dueDate: due,
      owner,
      ownerEmails: ownerEmail ? [ownerEmail] : undefined,
    };
    if (!due) undatedActions.push(item);
    else if (inLookahead(due, today)) items.push(item);
    else if (isOverdue(due) && item.ownerEmails?.length) overdue.push(item);
  }
  items.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  overdue.sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  if (items.length + undatedActions.length + overdue.length === 0) return null;
  return {
    projectName: project.name || "(unnamed project)",
    projectNumber: project.projectNumber || "",
    items, undatedActions, overdue,
  };
}

// Planner-page layout (Sara, 2026-07-18): one chronological stream across all
// projects — week dividers, then a day block per due date (big date numeral in
// the margin, ruled item lines beside it, project tag on every line). Undated
// action items land in a pinned "Anytime" tray at the bottom.
type FlatItem = { date?: string; type: string; label: string; owner?: string; projectName: string; projectNumber: string };

const TYPE_CHIP: Record<string, string> = {
  milestone: "#1F3864", rfi: "#B45309", submittal: "#047857", action: "#7C3AED",
};

function itemLine(i: FlatItem, isLast: boolean, dueTag?: string): string {
  return `
    <div style="padding:4px 0;font-size:10pt;color:#222;${isLast ? "" : "border-bottom:1px dotted #e4e4e4"}">
      <span style="color:${TYPE_CHIP[i.type] || "#666"};font-weight:700;font-size:8.5pt;white-space:nowrap">${TYPE_LABELS[i.type] || i.type}</span>
      &nbsp;${esc(i.label)}${i.owner ? ` <span style="color:#888">— ${esc(i.owner)}</span>` : ""}
      <span style="color:#999;font-size:8.5pt;white-space:nowrap"> · ${esc(i.projectNumber || "")}${i.projectNumber && i.projectName ? " " : ""}${esc(i.projectName)}</span>${dueTag ? ` <span style="color:#C00000;font-size:8.5pt;font-weight:700;white-space:nowrap">· was due ${esc(dueTag)}</span>` : ""}
    </div>`;
}

function digestHtml(digests: ProjDigest[], today: Date): string {
  const dated: FlatItem[] = [];
  const undated: FlatItem[] = [];
  const overdueFlat: FlatItem[] = [];
  for (const d of digests) {
    for (const i of d.items) {
      const flat = { date: i.dueDate, type: i.type, label: i.label, owner: i.owner, projectName: d.projectName, projectNumber: d.projectNumber };
      if (i.dueDate) dated.push(flat); else undated.push(flat);
    }
    for (const i of d.undatedActions) {
      undated.push({ type: i.type, label: i.label, owner: i.owner, projectName: d.projectName, projectNumber: d.projectNumber });
    }
    for (const i of d.overdue) {
      overdueFlat.push({ date: i.dueDate, type: i.type, label: i.label, owner: i.owner, projectName: d.projectName, projectNumber: d.projectNumber });
    }
  }
  dated.sort((a, b) => a.date!.localeCompare(b.date!));
  overdueFlat.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const byDate = new Map<string, FlatItem[]>();
  for (const i of dated) {
    if (!byDate.has(i.date!)) byDate.set(i.date!, []);
    byDate.get(i.date!)!.push(i);
  }

  const start = new Date(today); start.setHours(0, 0, 0, 0);
  const weekLabel = (d: Date) => {
    const wk = Math.floor((d.getTime() - start.getTime()) / 86400000 / 7);
    if (wk <= 0) return "This week";
    if (wk === 1) return "Next week";
    const mon = new Date(d); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    return "Week of " + mon.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  };

  let lastWeek = "";
  let body = "";
  for (const [dateStr, items] of byDate) {
    const d = new Date(dateStr + "T12:00:00");
    const wl = weekLabel(d);
    if (wl !== lastWeek) {
      lastWeek = wl;
      body += `<div style="font-size:9.5pt;letter-spacing:2px;color:#C00000;font-weight:700;text-transform:uppercase;margin:24px 0 2px;border-bottom:2px solid #C00000;padding-bottom:3px">${wl}</div>`;
    }
    const isToday = d.toDateString() === today.toDateString();
    const accent = isToday ? "#C00000" : "#1F3864";
    body += `
    <table style="border-collapse:collapse;width:100%">
      <tr>
        <td style="width:56px;vertical-align:top;padding:9px 12px 9px 0;border-bottom:1px solid #e8e8e8;text-align:center">
          <div style="font-size:8pt;color:${isToday ? "#C00000" : "#999"};letter-spacing:1.5px;font-weight:700">${d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</div>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:19pt;color:${accent};line-height:1.05">${d.getDate()}</div>
          <div style="font-size:7.5pt;color:#bbb;letter-spacing:1px">${d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}${isToday ? ' · <span style="color:#C00000;font-weight:700">TODAY</span>' : ""}</div>
        </td>
        <td style="vertical-align:top;padding:9px 0 9px 4px;border-bottom:1px solid #e8e8e8">
          ${items.map((i, idx) => itemLine(i, idx === items.length - 1)).join("")}
        </td>
      </tr>
    </table>`;
  }

  // Personal overdue tray — everything here is assigned to this recipient.
  const overdueBlock = overdueFlat.length ? `
    <div style="margin-top:20px;padding:10px 14px;background:#fdf2f2;border-left:3px solid #C00000;border-radius:3px">
      <div style="font-size:9pt;color:#C00000;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">⚠ Overdue — assigned to you (${overdueFlat.length})</div>
      ${overdueFlat.map((i, idx) => itemLine(i, idx === overdueFlat.length - 1, fmtDate(i.date))).join("")}
    </div>` : "";

  const undatedBlock = undated.length ? `
    <div style="margin-top:26px;padding:10px 14px;background:#fff8e1;border-left:3px solid #f59e0b;border-radius:3px">
      <div style="font-size:9pt;color:#92400e;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">📌 Anytime — no due date set (${undated.length})</div>
      ${undated.map((i, idx) => itemLine(i, idx === undated.length - 1)).join("")}
    </div>` : "";

  const end = new Date(today); end.setDate(end.getDate() + LOOKAHEAD_DAYS);
  const range = `${today.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const total = dated.length + undated.length + overdueFlat.length;
  const projCount = digests.length;
  return shell("Your week ahead", `
    <div style="font-size:20pt;color:#1F3864;font-weight:700;line-height:1.1">Your week ahead</div>
    <div style="font-size:11pt;color:#666;margin-top:6px">${total} item${total !== 1 ? "s" : ""} across ${projCount} project${projCount !== 1 ? "s" : ""} · ${range}${overdueFlat.length ? ` · <span style="color:#C00000;font-weight:700">${overdueFlat.length} overdue</span>` : ""}</div>
    ${overdueBlock}
    ${body}
    ${undatedBlock}
    <div style="font-size:9pt;color:#999;margin-top:24px">You get this because the weekly digest is on in <a href="${PMS_URL}#myprojects" style="color:#1F3864">My Projects → ⚙ My Settings</a> — turn it off there any time.</div>
  `, today);
}

async function runDigest(opts: { dryRun: boolean; only: string | null }) {
  const today = new Date();
  const prefs = await svcAll("/pms_user_prefs?weekly_digest=eq.true&select=email,digest_scope");
  let recipients = prefs.map(p => ({ email: p.email.toLowerCase(), scope: p.digest_scope || "mine" }));
  if (opts.only) recipients = recipients.filter(r => r.email === opts.only!.toLowerCase());
  if (recipients.length === 0) return { runAt: today.toISOString(), recipients: 0, note: "nobody opted in" };

  const projectRows = await svcAll("/pms_projects?select=id,project");
  const metaRows = await svcAll("/pms_meta?select=id,data");
  const staff: any[] = metaRows.flatMap((r: any) => r?.data?.staff || []).filter(Boolean);
  const nameToEmail = new Map<string, string>();
  for (const s of staff) {
    if (s?.name && s?.email) nameToEmail.set(s.name.toLowerCase().trim(), s.email.toLowerCase().trim());
  }

  // Build each project's digest once; remember which member emails it maps to.
  const perProject: { digest: ProjDigest; memberEmails: Set<string> }[] = [];
  for (const row of projectRows) {
    const digest = buildProjectDigest(row.project, today, nameToEmail);
    if (!digest) continue;
    const memberEmails = new Set<string>();
    for (const tm of row.project.teamMembers || []) {
      const viaField = (tm.email || "").toLowerCase().trim();
      const viaName = nameToEmail.get((tm.name || "").toLowerCase().trim());
      if (viaField) memberEmails.add(viaField);
      if (viaName) memberEmails.add(viaName);
    }
    perProject.push({ digest, memberEmails });
  }

  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: { email: string; error: string }[] = [];
  const preview: Record<string, { projects: number; items: number }> = {};

  // Action items are personal: one with an owner we can resolve to a staff
  // email goes only to that person's digest. Unowned (or unresolvable-owner)
  // items still go to everyone on the project so nothing silently disappears.
  // The overdue bucket is stricter: only items assigned to the recipient.
  const forRecipient = (d: ProjDigest, email: string): ProjDigest | null => {
    const mine = (i: Item) => i.type !== "action" || !i.ownerEmails?.length || i.ownerEmails.includes(email);
    const items = d.items.filter(mine);
    const undatedActions = d.undatedActions.filter(mine);
    const overdue = d.overdue.filter(i => i.ownerEmails?.includes(email));
    if (items.length + undatedActions.length + overdue.length === 0) return null;
    return { ...d, items, undatedActions, overdue };
  };

  for (const r of recipients) {
    const digests = perProject
      .filter(p => r.scope === "all" || p.memberEmails.has(r.email))
      .map(p => forRecipient(p.digest, r.email))
      .filter((d): d is ProjDigest => d !== null);
    if (digests.length === 0) { skipped.push(r.email); continue; }
    preview[r.email] = {
      projects: digests.length,
      items: digests.reduce((a, d) => a + d.items.length + d.undatedActions.length + d.overdue.length, 0),
    };
    if (opts.dryRun) continue;
    const subject = `Your week ahead — ${today.toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;
    try {
      await sendEmail(r.email, subject, digestHtml(digests, today));
      sent.push(r.email);
    } catch (e: any) {
      failed.push({ email: r.email, error: e?.message || String(e) });
    }
  }
  return {
    runAt: today.toISOString(), dryRun: opts.dryRun, recipients: recipients.length,
    preview, sent, skipped, skippedReason: "no items in window", failed,
  };
}

// ── Router ───────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "POST" && path.endsWith("/welcome")) {
      if (!(await callerIsAdmin(req)) && !(await cronKeyValid(req))) {
        return json({ error: "Admin role required" }, 403);
      }
      const p = await req.json();
      // Batch mode: welcome everyone in pms_user_roles (minus `skip` emails).
      // For the day the Resend domain verifies and the pre-DNS onboarding
      // backlog needs its welcome emails in one shot. dryRun lists recipients.
      if (p?.batch) {
        const rows = await svcAll("/pms_user_roles?select=email,role,display_name");
        const skip = new Set((p.skip || []).map((e: string) => String(e).toLowerCase()));
        const sent: string[] = [];
        const failed: { email: string; error: string }[] = [];
        for (const r of rows) {
          if (skip.has((r.email || "").toLowerCase())) continue;
          if (p.dryRun) { sent.push(r.email); continue; }
          try {
            await sendEmail(r.email, "You've been added to the Setty PMS", welcomeHtml(r, new Date()));
            sent.push(r.email);
          } catch (e: any) {
            failed.push({ email: r.email, error: e?.message || String(e) });
          }
        }
        return json({ ok: true, batch: true, dryRun: !!p.dryRun, sent, failed });
      }
      if (!/^[^@\s]+@setty\.com$/i.test(p?.email || "")) return json({ error: "email must be @setty.com" }, 400);
      await sendEmail(p.email, "You've been added to the Setty PMS", welcomeHtml(p, new Date()));
      return json({ ok: true, sentTo: p.email });
    }
    if (req.method === "POST" && path.endsWith("/digest")) {
      const url = new URL(req.url);
      if (!(await cronKeyValid(req)) && !(await callerIsAdmin(req))) {
        return json({ error: "Not authorized (cron key or admin JWT required)" }, 403);
      }
      return json(await runDigest({
        dryRun: url.searchParams.get("dryRun") === "1",
        only: url.searchParams.get("only"),
      }));
    }
    return json({ error: "Unknown route", routes: ["POST /welcome", "POST /digest"] }, 404);
  } catch (e: any) {
    console.error("pms-user-emails failed:", e);
    return json({ error: e?.message || String(e) }, 500);
  }
});
