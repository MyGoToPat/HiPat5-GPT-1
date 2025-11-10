const url = "https://jdtogitfqptdrxkczdbw.supabase.co/functions/v1/embed";

const res = await fetch(url, {
  method: "OPTIONS",
  headers: {
    "Origin": "http://localhost:5176",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization, x-client-info, apikey, content-type, cache-control"
  }
});

console.log("status", res.status);
for (const [k,v] of res.headers) {
  if (k.toLowerCase().startsWith("access-control")) console.log(k, v);
}
