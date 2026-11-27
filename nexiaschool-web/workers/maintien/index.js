// Cloudflare Worker planifié (chaque heure) : maintien du projet Supabase, automatisations du personnel, courriers programmés,
// relances de paiement et rappels de fin d'abonnement.
// Un projet Supabase gratuit sans aucune requête pendant 7 jours est mis en pause : ce Worker appelle à chaque passage
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

/** Relances de paiement des établissements qui ont activé l'envoi automatique (fonction idempotente : une exécution par jour
 *  et par établissement ; elle ne renvoie que des compteurs). */
async function relances(env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/relances_quotidiennes`, {
    method: "POST", headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, "Content-Type": "application/json" }, body: "{}",
  })
  console.log("relances de paiement :", r.status, await r.text())
  return r.status
}

/** Automatisations personnelles du personnel dont l'heure est venue (ne renvoie que des compteurs). */
async function automatisations(env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/automatisations_executer`, {
    method: "POST", headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, "Content-Type": "application/json" }, body: "{}",
  })
  console.log("automatisations :", r.status, await r.text())
  return r.status
}

/** Alertes du pilotage institutionnel (ouverture, échéances, retards) : notifications internes, idempotentes. */
async function alertesInstitution(env) {
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/inst_alertes_quotidiennes`, {
    method: "POST", headers: { apikey: env.SUPABASE_CLE_PUBLIQUE, "Content-Type": "application/json" }, body: "{}",
  })
  console.log("alertes institutionnelles :", r.status, await r.text())
  return r.status
}

export default {
  // déclenchement planifié chaque heure (voir [triggers] dans wrangler.toml). relances_quotidiennes distribue chaque heure les
  // courriers programmés et n'envoie les relances qu'une fois par jour (pas avant 6 h à Douala) ; rappels d'abonnement à 06:17.
  async scheduled(evenement, env, contexte) {
    const heureUtc = new Date(evenement.scheduledTime || Date.now()).getUTCHours()
    const taches = [ping(env), automatisations(env), relances(env)]
    if (heureUtc === 5) taches.push(rappels(env), alertesInstitution(env))
    contexte.waitUntil(Promise.allSettled(taches))
  },
  // appel manuel : renvoie seulement l'état du dernier ping (aucune donnée)
  async fetch(requete, env) {
    try { return new Response(`Supabase : ${await ping(env)}`, { headers: { "Content-Type": "text/plain; charset=utf-8" } }) }
    catch (e) { return new Response(String(e.message), { status: 502 }) }
  },
}
