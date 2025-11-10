import "dotenv/config";

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL!;

const SB_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

async function embed(text: string): Promise<number[]> {
  const { data, error } = await supabase.functions.invoke('embed', {
    body: { texts: [text] }
  });
  if (error) throw error;
  const vecs = data?.vectors ?? data?.embeddings ?? data?.data;
  if (!vecs || !Array.isArray(vecs) || !vecs[0]) throw new Error('embed_invalid_response');
  return vecs[0];
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
