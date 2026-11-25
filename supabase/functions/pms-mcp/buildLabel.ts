// What /health and the telemetry rows call the running copy of the connector.
//
// It used to be a hand-written constant ("2026-11-25-pdf-pagewise-cpu") that
// every change had to bump. Two changes in flight at once then both edited the
// same line and conflicted: six times on 2026-11-24 and 25. The hosted runtime
// already names the copy: DENO_DEPLOYMENT_ID is "{project_ref}_{function_id}_{version}",
// and the version goes up by one on every deploy (Supabase docs, Edge Functions
// > Environment variables). So the label is read from it, and nothing is edited
// by hand.
//
//   deploy-<version>   the hosted runtime, version as Supabase numbers it
//   deploy-<tail>      an id in some other shape: its last 12 characters
//   local              no id at all (supabase functions serve, tests)

export const LOCAL_BUILD = "local";

export function buildLabel(deploymentId: unknown): string {
  const id = String(deploymentId ?? "").trim();
  if (!id) return LOCAL_BUILD;
  const m = /_(\d+)$/.exec(id);
  if (m) return "deploy-" + m[1];
  return "deploy-" + id.replace(/[^A-Za-z0-9_-]/g, "").slice(-12);
}

// Reading the environment can throw where env access is not granted; that is a
// local run, not a failure.
export function deploymentIdFromEnv(get: (name: string) => string | undefined): string | undefined {
  try { return get("DENO_DEPLOYMENT_ID"); } catch { return undefined; }
}
