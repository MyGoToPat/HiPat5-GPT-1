import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires, accept",
  "Content-Type": "application/json",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing GEMINI_API_KEY" }),
        { status: 500, headers: cors }
      );
    }

    const { prompt, systemPrompt } = await req.json().catch(() => ({ 
      prompt: "", 
      systemPrompt: "" 
    }));
    
    const contents = [];
    
    if (systemPrompt) {
      contents.push({ role: "user", parts: [{ text: systemPrompt }] });
      contents.push({ role: "model", parts: [{ text: "Understood. I will follow these instructions." }] });
    }
    
    contents.push({ role: "user", parts: [{ text: String(prompt ?? "") }] });
    
    const body = {
      contents,
      tools: [{ google_search: {} }],
    };

    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        encodeURIComponent(GEMINI_API_KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      console.error("[gemini-chat] Google API error:", resp.status, detail);
      return new Response(
        JSON.stringify({ ok: false, error: "Gemini call failed", detail }),
        { status: 502, headers: cors }
      );
    }

    const data = await resp.json();

    // Flatten text parts (answer-first)
    const parts =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text)?.filter(Boolean) ?? [];
    const text = parts.length ? parts.join("\n").trim() : "No content";

    // Correct citation extraction from grounding chunks
    const firstChunk =
      data?.candidates?.[0]?.groundingMetadata?.groundingChunks?.[0] ?? null;
    const cite = firstChunk?.web?.uri ?? "";
    const citeTitle = firstChunk?.web?.title ?? "";

    return new Response(JSON.stringify({ ok: true, text, cite, citeTitle }), {
      headers: cors,
      status: 200,
    });
  } catch (e) {
    console.error("[gemini-chat] crash:", e);
    return new Response(
      JSON.stringify({ ok: false, error: "Function crashed", detail: String(e) }),
      { status: 500, headers: cors }
    );
  }
});
