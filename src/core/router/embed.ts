import { supabase } from '@/lib/supabase';

export type EmbedResponse = { 
  ok?: boolean;
  vectors?: number[][]; 
  embeddings?: number[][]; 
  data?: number[][];
  error?: string;
};

export async function getEmbeddings(texts: string[]) {
  const { data, error } = await supabase.functions.invoke<EmbedResponse>('embed', { body: { texts } });
  if (error) throw error;
  if (data && !data.ok) {
    throw new Error(data.error || 'embed_failed');
  }
  const vecs = data?.vectors ?? data?.embeddings ?? data?.data;
  if (!vecs || !Array.isArray(vecs)) throw new Error('embed_invalid_response');
  return vecs as number[][];
}

