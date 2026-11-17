// Cloudflare Worker planifié : maintien du projet Supabase (plan Free) et rappels de fin d'abonnement.
// Un projet Supabase gratuit sans aucune requête pendant 7 jours est mis en pause : ce Worker appelle une fois par jour
// la fonction publique « ping » (aucune donnée lue ni écrite). Remplace la fonction planifiée Netlify (netlify/functions/maintien.mjs).
// Variables (publiques, voir wrangler.toml) : SUPABASE_URL, SUPABASE_CLE_PUBLIQUE.

async function ping(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_CLE_PUBLIQUE) throw new Error("maintien : variables Supabase absentes")
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/ping`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, "Content-Type": "application/json" },
    body: "{}",
  })
  console.log("maintien Supabase :", r.status)
  if (!r.ok) throw new Error(`maintien Supabase : statut ${r.status}`)
  return r.status
}

/** Rappels quotidiens « fin d'abonnement dans N jours » (fonction Supabase « paiement », qui n'envoie que les rappels dus). */
async function rappels(env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/paiement/rappels`, {
    method: "POST", headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, "Content-Type": "application/json" }, body: "{}",
  })
  console.log("rappels d'abonnement :", r.status, await r.text())
  return r.status
}

export default {
  // déclenchement planifié (voir [triggers] dans wrangler.toml)
  async scheduled(evenement, env, contexte) {
    contexte.waitUntil(Promise.allSettled([ping(env), rappels(env)]))
  },
  // appel manuel : renvoie seulement l'état du dernier ping (aucune donnée)
  async fetch(requete, env) {
    try { return new Response(`Supabase : ${await ping(env)}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } }) }
    catch (e) { return new Response(String(e.message), { status: 502 }) }
  },
}
