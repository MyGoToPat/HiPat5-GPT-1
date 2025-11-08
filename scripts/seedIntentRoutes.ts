import "dotenv/config";

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL!;

const SB_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

async function embed(text: string): Promise<number[]> {

  const res = await fetch(`${SB_URL}/functions/v1/embed`, {

    method:"POST",

    headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${SB_SERVICE_ROLE_KEY}` },

    body: JSON.stringify({ text })

  });

  const j = await res.json();

  return j.embedding;

}

(async function main(){

  const { data, error } = await supabase.from("intent_routes").select("id,name,examples,embedding");

  if (error) throw error;

  for (const r of (data||[])) {

    if (r.embedding) continue;

    const vec = await embed(r.examples || r.name);

    await supabase.from("intent_routes").update({ embedding: vec }).eq("id", r.id);

    console.log(`Seeded route ${r.name}`);

  }

})().catch(e=>{ console.error(e); process.exit(1); });
