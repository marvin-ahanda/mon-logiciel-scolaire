// @ts-nocheck  (JavaScript standard, aussi exécuté par le banc d'essai Node)
// Fonction serveur de la console : efface les fichiers (photos, logo) d'un établissement supprimé.
// Le stockage Supabase interdit la suppression de fichiers en SQL : seule une clé serveur le peut. Cette clé
// reste ici, côté serveur ; l'appel n'est accepté que du propriétaire de la plateforme (vérifié en base avec SON
// jeton de connexion) et seulement pour un établissement qui n'existe plus.
const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process?.env?.[k])
const URL_SUPABASE = env("SUPABASE_URL")
const CLE_PUBLIQUE = env("SUPABASE_ANON_KEY")
const CLE_SERVEUR = env("SUPABASE_SERVICE_ROLE_KEY")
const COMPARTIMENTS = ["photos", "logos"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (corps, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json", ...CORS } })

async function lister(bucket, dossier) {
  const noms = []
  for (let depart = 0; ; depart += 1000) {
    const r = await fetch(`${URL_SUPABASE}/storage/v1/object/list/${bucket}`, {
      method: "POST", headers: { Authorization: `Bearer ${CLE_SERVEUR}`, apikey: CLE_SERVEUR, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: dossier, limit: 1000, offset: depart }),
    })
    if (!r.ok) throw new Error(`liste ${bucket} : ${r.status}`)
    const page = await r.json()
    noms.push(...page.filter((f) => f.id || f.metadata).map((f) => `${dossier}/${f.name}`))
    if (page.length < 1000) return noms
  }
}

export async function traiter(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405)
  if (!URL_SUPABASE || !CLE_PUBLIQUE || !CLE_SERVEUR) return json({ erreur: "Configuration serveur incomplète." }, 500)
  const jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  let corps
  try { corps = await req.json() } catch { return json({ erreur: "Requête invalide." }, 400) }
  const id = String(corps?.etablissement_id || "")
  if (!UUID.test(id)) return json({ erreur: "Identifiant d'établissement invalide." }, 400)

  // 1. Autorisation vérifiée par la base, avec le jeton de la personne connectée
  const v = await fetch(`${URL_SUPABASE}/rest/v1/rpc/console_fichiers_purgeables`, {
    method: "POST", headers: { Authorization: `Bearer ${jeton}`, apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: id }),
  })
  if (!v.ok || (await v.json()) !== true) return json({ erreur: "Réservé au propriétaire de la plateforme, pour un établissement déjà supprimé." }, 403)

  // 2. Effacement des fichiers du dossier de l'établissement dans chaque compartiment
  const bilan = {}
  for (const bucket of COMPARTIMENTS) {
    const noms = await lister(bucket, id)
    for (let k = 0; k < noms.length; k += 100) {
      const r = await fetch(`${URL_SUPABASE}/storage/v1/object/${bucket}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${CLE_SERVEUR}`, apikey: CLE_SERVEUR, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: noms.slice(k, k + 100) }),
      })
      if (!r.ok) return json({ erreur: `Suppression des fichiers (${bucket}) impossible : ${r.status}` }, 502)
    }
    bilan[bucket] = noms.length
  }
  return json({ fichiers_supprimes: bilan })
}

if (globalThis.Deno) globalThis.Deno.serve(traiter)
