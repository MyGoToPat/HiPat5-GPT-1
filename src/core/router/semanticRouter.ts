function cosine(a:number[], b:number[]){ let d=0,na=0,nb=0; for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];} return d/(Math.sqrt(na)*Math.sqrt(nb)); }

import { getEmbeddings } from '@/core/router/embed';

export async function embed(text:string){
  try {
    const vectors = await getEmbeddings([text]);
    return vectors[0] || [];
  } catch (err) {
    console.error('[semanticRouter] Embed exception:', err);
    return [];
  }
}

export async function decideRoute(prompt:string, routes:any[]){

  const q = await embed(prompt);
  
  // If embedding failed, fallback to AMA
  if (!q.length) {
    return { route: "AMA", confidence: "low", sim: 0, hi: 0.85, mid: 0.60, why: "Embedding failed, defaulting to AMA" };
  }

  let best = { name:"AMA", sim:-1, hi:0.85, mid:0.60, why:"Searching my knowledge and the web for this." };

  for (const r of routes){

    if (!r.embedding || !r.embedding.length) continue;

    const sim = cosine(q, r.embedding);

    const hi = r.hi_threshold ?? 0.85;

    const mid = r.mid_threshold ?? 0.60;

    if (sim > best.sim) best = { name:r.name, sim, hi, mid, why: r.name==="TMWYA" ? "Using my nutrition tools to log this." : "Routing based on semantic match." };

  }

  const level = best.sim >= best.hi ? "high" : best.sim >= best.mid ? "mid" : "low";

  return { route: level==="low" ? "AMA" : best.name, confidence: level, sim: best.sim, hi: best.hi, mid: best.mid, why: best.why };

}
