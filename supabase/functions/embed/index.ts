/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ORIGIN = Deno.env.get("APP_ORIGIN") || "*";
const API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = Deno.env.get("EMBEDDING_MODEL") || "text-embedding-004";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires, accept",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { text } = await req.json();
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent?key=${API_KEY}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });

    const data = await res.json();

    const vec = data?.embedding?.values;
    if (!Array.isArray(vec)) {
      return new Response(JSON.stringify({ error: "No embedding" }), {
        status: 500,
        headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ embedding: vec }), {
      status: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
