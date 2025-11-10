import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ALLOWED_ORIGINS = Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:5176,http://localhost:5173,https://hipat.app";
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");

function pickOrigin(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.split(",").map(s => s.trim());
  return allowed.includes(origin) ? origin : allowed[0] || "*";
}

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": pickOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
    "Content-Type": "application/json"
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: corsHeaders(req) });
  }

  try {
    const { texts } = await req.json().catch(() => ({ texts: [] as string[] }));
    if (!Array.isArray(texts) || texts.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "No texts" }), { status: 200, headers: corsHeaders(req) });
    }
    const batch = texts.slice(0, 96);

    let vectors: number[][] = [];
    let providerUsed = '';

    // Try OpenAI first
    if (OPENAI_KEY) {
      try {
        console.log("[embed] trying OpenAI");
        const r = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "text-embedding-3-small", input: batch })
        });
        if (r.ok) {
          const j = await r.json();
          vectors = j.data.map((d: any) => d.embedding);
          providerUsed = 'openai';
          console.log("[embed] OpenAI success");
        } else {
          console.error("[embed] OpenAI failed with status", r.status);
        }
      } catch (e) {
        console.error("[embed] OpenAI exception", e);
      }
    }

    // Try Gemini as fallback if OpenAI failed or not available
    if ((!vectors.length || !providerUsed) && GEMINI_KEY) {
      try {
        console.log("[embed] trying Gemini");
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${GEMINI_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: batch.map(t => ({ model: "text-embedding-004", content: { parts: [{ text: t }] } }))
          })
        });
        if (r.ok) {
          const j = await r.json();
          vectors = j.embeddings?.map((e: any) => e.values) ?? [];
          providerUsed = 'gemini';
          console.log("[embed] Gemini success");
        } else {
          console.error("[embed] Gemini failed with status", r.status);
        }
      } catch (e) {
        console.error("[embed] Gemini exception", e);
      }
    }

    if (!vectors.length) {
      console.error("[embed] all providers failed");
      return new Response(JSON.stringify({ ok: false, error: "all_providers_failed" }), { status: 200, headers: corsHeaders(req) });
    }

    return new Response(JSON.stringify({ ok: true, vectors }), { status: 200, headers: corsHeaders(req) });
  } catch (err) {
    console.error("[embed] unhandled", err);
    return new Response(JSON.stringify({ ok: false, error: "unhandled" }), { status: 200, headers: corsHeaders(req) });
  }
});
