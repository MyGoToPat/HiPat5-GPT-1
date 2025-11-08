import { expect, test } from "vitest";

async function callGeminiChat(messages:any[], tools?:any[]){
  const res = await fetch("http://localhost:54321/functions/v1/gemini-chat", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ messages, includeSources:true, tools })
  });
  return res.json();
}

test("UEFA final is grounded with uefa.com", async () => {
  const r = await callGeminiChat(
    [{ role:"user", content:"Who won the 2024 UEFA Euro final and what was the score? Include sources." }],
    [{ google_search: {} }]
  );
  expect(r.grounded).toBe(true);
  expect(r.sources.some((s:any)=> String(s.url||"").includes("uefa.com"))).toBe(true);
});

test("Friendly robot story is not grounded", async () => {
  const r = await callGeminiChat(
    [{ role:"user", content:"Write a short, 3-sentence story about a friendly robot." }],
    [{ google_search: {} }]
  );
  expect(r.grounded).toBe(false);
  expect((r.sources||[]).length).toBe(0);
});
