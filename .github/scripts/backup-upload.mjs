// Uploader for the off-site backup (.github/scripts/backup.sh).
//
//   node backup-upload.mjs put <local file> <remote path>   upload one file
//   node backup-upload.mjs list <emails|history|core>      print file names
//
// Env: PMS_MCP_URL (…/functions/v1/pms-mcp) and PMS_BACKUP_TOKEN.
// The connector creates a Graph upload session in the backup folder and
// returns its pre-authenticated uploadUrl; this script PUTs the file to it in
// chunks. No Microsoft credentials are involved here.
import { open, stat } from "node:fs/promises";

const BASE = (process.env.PMS_MCP_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.PMS_BACKUP_TOKEN || "";
// Graph wants chunks in multiples of 320 KiB; 32 of them = 10 MiB.
const CHUNK = 320 * 1024 * 32;

async function api(route, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}/admin/backup/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pms-backup": TOKEN },
      body: JSON.stringify(body),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 400);
    // 400/403 will not get better by retrying.
    if (res.status === 400 || res.status === 403 || attempt >= 4) {
      throw new Error(`connector ${route} answered ${res.status}: ${text}`);
    }
    await sleep(2000 * attempt);
  }
}

async function put(local, remote) {
  const { size } = await stat(local);
  if (!size) throw new Error(`${local} is empty`);
  const { uploadUrl } = await api("upload-session", { path: remote, size });
  const fh = await open(local, "r");
  let item = null;
  try {
    for (let start = 0; start < size; start += CHUNK) {
      const end = Math.min(start + CHUNK, size) - 1;
      const buf = Buffer.alloc(end - start + 1);
      await fh.read(buf, 0, buf.length, start);
      for (let attempt = 1; ; attempt++) {
        // The session URL is pre-authenticated: no Authorization header.
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(buf.length) },
          body: buf,
        }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
        if (res.ok) {
          if (res.status === 200 || res.status === 201) item = await res.json();
          break;
        }
        const text = (await res.text()).slice(0, 300);
        if (attempt >= 5 || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
          await fetch(uploadUrl, { method: "DELETE" }).catch(() => {});
          throw new Error(`upload of ${remote} failed at bytes ${start}-${end}: ${res.status} ${text}`);
        }
        await sleep(3000 * attempt);
      }
    }
  } finally {
    await fh.close();
  }
  if (!item?.id) throw new Error(`upload of ${remote} ended without SharePoint confirming the file`);
  if (Number(item.size) !== size) throw new Error(`upload of ${remote}: SharePoint has ${item.size} bytes, expected ${size}`);
  console.log(JSON.stringify({ path: remote, bytes: size }));
}

async function list(folder) {
  const { files } = await api("list", { folder });
  for (const f of files) console.log(f.name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, a, b] = process.argv.slice(2);
if (!BASE || !TOKEN) {
  console.error("PMS_MCP_URL and PMS_BACKUP_TOKEN must be set");
  process.exit(2);
}
try {
  if (cmd === "put" && a && b) await put(a, b);
  else if (cmd === "list" && a) await list(a);
  else { console.error("usage: backup-upload.mjs put <file> <remote path> | list <folder>"); process.exit(2); }
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
