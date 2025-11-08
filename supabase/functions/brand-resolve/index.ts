/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ORIGIN = Deno.env.get("APP_ORIGIN") || "*";
const API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MODEL = "gemini-2.5-flash";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APPROVED = [
  "mcdonalds.com",
  "mcdonalds.ca",
  "usda.gov",
  "fatsecret.com",
  "mynetdiary.com",
];

function cors() {
  return {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires, accept",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  try {
    const { item, market = "US" } = await req.json();
    if (!item || typeof item !== "string") {
      return new Response(JSON.stringify({ error: "Missing item" }), {
        status: 400,
        headers: { ...cors(), "Content-Type": "application/json" },
      });
    }

    const system =
      `You are a nutrition data extractor. Output ONLY a single minified JSON object.\n` +
      `Schema: {"calories":number,"protein_g":number,"carb_g":number,"fat_g":number,"fiber_g":number|null,"source_url":string,"source_title":string}.\n` +
      `Prioritize the official brand website for ${market}. If fiber is not listed, set "fiber_g": null. No prose, no markdown.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: `${item} (${market})` }] }],
      systemInstruction: { parts: [{ text: system }] }, // fixed shape
      generationConfig: { response_mime_type: "application/json" }, // strict JSON
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      return new Response(JSON.stringify({ error: "No JSON payload" }), {
        status: 502,
        headers: { ...cors(), "Content-Type": "application/json" },
      });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 502,
        headers: { ...cors(), "Content-Type": "application/json" },
      });
    }

    const {
      calories,
      protein_g,
      carb_g,
      fat_g,
      fiber_g, // may be null
      source_url,
      source_title,
    } = parsed;

    const host = (() => {
      try { return new URL(source_url).hostname.replace(/^www\./, ""); }
      catch { return ""; }
    })();

    const approved = APPROVED.some((d) => host.endsWith(d));

    const complete =
      [calories, protein_g, carb_g, fat_g].every((v) => typeof v === "number") &&
      typeof source_url === "string" &&
      typeof source_title === "string" &&
      ("fiber_g" in parsed); // presence required, value may be null

    const is_verified = approved && complete;

    if (is_verified) {
      const supabase = createClient(SB_URL, SB_SERVICE_KEY);
      await supabase.from("brand_nutrition").upsert(
        {
          brand_item: item,
          market,
          calories,
          protein_g,
          carb_g,
          fat_g,
          fiber_g,
          source_url,
          source_title,
          is_verified: true,
          last_updated: new Date().toISOString(),
        },
        { onConflict: "brand_item,market" },
      );
    }

    return new Response(JSON.stringify({ ...parsed, is_verified }), {
      status: 200,
      headers: { ...cors(), "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || "error" }), {
      status: 500,
      headers: { ...cors(), "Content-Type": "application/json" },
    });
  }
});
