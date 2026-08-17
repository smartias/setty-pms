// proposal-draft — in-app AI proposal draft generation (Proposal Generator Phase 3).
//
// POST { action: "status" }                       -> { ok, configured }
// POST { rfpText, projectContext? }               -> { ok, draft, usage } | { ok:false, status:"not_configured" }
//
// The function reads the LIVE approved clause library on every call, so the
// generation prompt never goes stale the way the paste-import skill doc's
// catalog snapshot did. Output is proposal-draft JSON v1: the exact contract
// the Scope tab's Import AI Draft pipeline (SettyPMS.html buildDraftImport)
// validates, so generated and pasted drafts share one import path.
//
// Dark-launch: with no ANTHROPIC_API_KEY secret set, every generate call
// returns { ok:false, status:"not_configured" } and the PMS shows the
// pending-setup state. Setting the secret (Supabase dashboard -> Edge
// Functions -> proposal-draft -> secrets) turns the feature on with no deploy.
//
// Deployed with verify_jwt (default): only signed-in suite users reach it.

import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-opus-5";
const MAX_RFP_CHARS = 400_000; // ~100k tokens of RFP text; far under the 1M window

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// The drafting rules mirror PMS/ProposalDraft_Skill.md v1 (hard rules + output
// contract). The clause catalog is injected live per request instead of being
// a dated snapshot.
function buildSystemPrompt(catalog: string): string {
  return `You are drafting the structured input for a Setty & Associates (MEP/FP consulting engineers) fee proposal. You are NOT writing the proposal document. The PMS assembles the document from a governed clause library; your job is to analyze the RFP, select and parameterize clauses, and write only the short narrative sections that are genuinely project-specific.

Hard rules:
- Never write contract boilerplate. Provisions, exclusion menus, acceptance language, and terms exist in the firm library; you only SELECT them by key. If the RFP demands a term the library does not cover, put it in flaggedForReview, never in prose.
- Select, don't paraphrase. If an RFP requirement matches a catalog clause, reference the clause key and set its params. Only write authoredScope items for work the catalog does not cover (surveys, studies, assessments, Cx, agency-specific deliverables).
- Tokens named {{DISCIPLINE_LIST}}, {{DISCIPLINE_ABBR}} and {{DISCIPLINE_MEP}} are filled by the PMS from the project's discipline settings. Never set them in params. Clauses tagged for a discipline (fire suppression, lighting) are filtered by the PMS as well; select them when the RFP calls for the work and let the PMS decide.
- Written sections stay short. Understanding: 1 to 3 paragraphs. Approach: 3 to 6 short paragraphs or a compact list. Each custom assumption: one sentence.
- Language: plain AEC professional English. No em dashes anywhere; use colons, commas, or separate sentences. No marketing superlatives. Spell out agency names on first use.
- Uncertainty is data. Anything you could not map, verify, or understand goes in flaggedForReview with a one-line reason. An empty flagged list on a complex RFP is a red flag in itself.
- Fees: never invent a total. You may propose a phase percentage split in suggestedPhases (must sum to 100) and write a basisOfFeeNote describing how the fee could be benchmarked. Dollar amounts only if the RFP itself states budgets, and then only inside understanding.
- HTML fields allow only: p, h3, ul, ol, li, strong, em, u, br. Nothing else.

Output contract (schemaVersion 1) - respond with ONLY this JSON object, no commentary, no code fences:
{
  "schemaVersion": 1,
  "kind": "proposal-draft",
  "project": { "name": "", "client": "", "owner": "", "location": "", "rfpReference": "", "constructionBudget": "" },
  "understanding": "<p>HTML</p>",
  "approach": "<p>HTML</p>",
  "clauses": [ { "key": "inc-predesign-visit", "params": { "VISIT_COUNT": "Two (2)" } } ],
  "authoredScope": [ { "title": "", "html": "<p>HTML</p>" } ],
  "assumptions": { "clauseKeys": [], "custom": ["<p>HTML</p>"] },
  "exclusions": { "clauseKeys": [], "custom": ["<li>HTML list item</li>"] },
  "openItems": [""],
  "suggestedPhases": [ { "name": "", "pct": 0 } ],
  "basisOfFeeNote": "",
  "flaggedForReview": [ { "rfpDemand": "", "why": "" } ]
}

This is the LIVE approved clause catalog. Use ONLY these keys; a key not listed here does not exist:

${catalog}`;
}

async function loadCatalog(): Promise<string> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await sb
    .from("pms_proposal_clauses")
    .select("clause_key, block, title, body_html, params")
    .eq("status", "approved")
    // The Standard Terms and Conditions live in the same table (block
    // "terms") but are Attachment A boilerplate, not selectable clauses.
    .neq("block", "terms")
    .order("block")
    .order("sort");
  if (error) throw new Error("clause library read failed: " + error.message);
  return (data ?? [])
    .map((c) => {
      // Only object-valued params are fill-in tokens; strings (variant,
      // discipline, variantOf...) are metadata the PMS acts on, not tokens.
      const params = Object.entries(c.params ?? {})
        .filter(([, decl]) => decl && typeof decl === "object")
        .map(([tok, decl]: [string, any]) =>
          `{{${tok}}} (${decl?.label ?? tok}; default ${decl?.default ?? "none"})`)
        .join(", ");
      const text = String(c.body_html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return `[${c.block}] ${c.clause_key} - ${c.title}${params ? ` | params: ${params}` : ""}\n  ${text}`;
    })
    .join("\n");
}

// The model is instructed to return bare JSON, but tolerate a fenced block.
function parseDraft(text: string): any {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  const d = JSON.parse(stripped.slice(start, end + 1));
  if (d?.kind !== "proposal-draft" || d?.schemaVersion !== 1) {
    throw new Error("model output is not proposal-draft schemaVersion 1");
  }
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid JSON body" }, 400); }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

  if (body.action === "status") {
    return json({ ok: true, configured: !!apiKey, model: apiKey ? MODEL : null });
  }

  const rfpText = String(body.rfpText ?? "").trim();
  if (!rfpText) return json({ ok: false, error: "rfpText is required" }, 400);
  if (rfpText.length > MAX_RFP_CHARS) {
    return json({ ok: false, error: `RFP text exceeds ${MAX_RFP_CHARS} characters; trim to the relevant sections` }, 400);
  }
  if (!apiKey) return json({ ok: false, status: "not_configured" });

  try {
    const catalog = await loadCatalog();
    const anthropic = new Anthropic({ apiKey });

    // projectContext: optional short blob the PMS sends (project name, client,
    // agency, prior-work notes) so generation matches what the paste-path skill
    // gets from the connector.
    const userContent =
      (body.projectContext ? `Project context from the PMS:\n${String(body.projectContext).slice(0, 20_000)}\n\n` : "") +
      `RFP text:\n${rfpText}`;

    const response = await (anthropic as any).beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: buildSystemPrompt(catalog),
      messages: [{ role: "user", content: userContent }],
    });

    if (response.stop_reason === "refusal") {
      return json({ ok: false, error: "The model declined this request. Review the RFP text for content the safety filters may have flagged, or use the paste-import path." });
    }
    if (response.stop_reason === "max_tokens") {
      return json({ ok: false, error: "The draft was truncated (output limit). Trim the RFP to the relevant sections and retry." });
    }

    const text = (response.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const draft = parseDraft(text);

    return json({
      ok: true,
      draft,
      usage: {
        model: response.model,
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("proposal-draft error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
