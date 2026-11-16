// @ts-nocheck  (JavaScript standard, aussi exécuté par le banc d'essai Node)
// Paiement des abonnements NexIA School par SasPay (page de paiement hébergée : mobile money, carte).
//   POST /paiement/creer     { offre, periode, retour } (administrateur connecté) → { url } de la page SasPay
//   POST /paiement/verifier  { paiement_id? } (personne connectée) → revérifie les paiements en attente
//   POST /paiement/webhook   notification SasPay signée (X-Webhook-Signature) → revérifie les paiements en attente
// Le montant est fixé en base (paiement_preparer) et un paiement n'est validé qu'après vérification auprès de l'API
// SasPay (statut PAYÉ + montant + devise) : ni le navigateur ni le contenu d'un webhook ne suffisent à activer une offre.
// Secrets (Supabase → Edge Functions → Secrets) : SASPAY_SECRET_KEY (sk_test_… ou sk_live_…), SASPAY_WEBHOOK_SECRET.
const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process?.env?.[k])
const URL_SUPABASE = env("SUPABASE_URL")
const CLE_PUBLIQUE = env("SUPABASE_ANON_KEY")
const CLE_SERVEUR = env("SUPABASE_SERVICE_ROLE_KEY")
const SASPAY = (env("SASPAY_API") || "https://api.saspay.me/api/v1").replace(/\/$/, "")
const CLE_SASPAY = env("SASPAY_SECRET_KEY")
const SECRET_WEBHOOK = env("SASPAY_WEBHOOK_SECRET")
// adresses de retour autorisées après paiement (le client revient sur la page Abonnement du site d'où il vient)
const SITES = ["https://nexiaschool.com", "https://www.nexiaschool.com", "https://nexiaschool.pages.dev", "https://marvin-ahanda.github.io/mon-logiciel-scolaire",
  ...(env("NEXIA_SITES_SUPPL") || "").split(",").map((s) => s.trim()).filter(Boolean)]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let envoyer = (url, init) => fetch(url, init)        // remplaçable par les tests
export function remplacerFetch(f) { envoyer = f }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS" }
const json = (corps, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json", ...CORS } })

class Erreur extends Error { constructor(message, statut = 400) { super(message); this.statut = statut } }

/** Appel d'une fonction SQL, avec le jeton de la personne connectée ou la clé serveur. */
async function rpc(nom, params, jeton) {
  const cle = jeton || CLE_SERVEUR
  const r = await envoyer(`${URL_SUPABASE}/rest/v1/rpc/${nom}`, {
    method: "POST", headers: { Authorization: `Bearer ${cle}`, apikey: jeton ? CLE_PUBLIQUE : CLE_SERVEUR, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  const texte = await r.text(), d = texte ? JSON.parse(texte) : null
  if (!r.ok) throw new Erreur(d?.message || `Erreur ${r.status}`, r.status === 401 || d?.code === "42501" ? 403 : 400)
  return d
}

/** Appel de l'API SasPay (clé secrète côté serveur uniquement). */
async function saspay(chemin, init = {}) {
  if (!CLE_SASPAY) throw new Erreur("Paiement en ligne non configuré (clé SasPay absente).", 503)
  const r = await envoyer(`${SASPAY}${chemin}`, { ...init, headers: { Authorization: `Bearer ${CLE_SASPAY}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) } })
  const texte = await r.text()
  let d = null
  try { d = texte ? JSON.parse(texte) : null } catch { d = null }
  if (!r.ok) throw new Erreur(d?.message || d?.error?.detail || `SasPay : erreur ${r.status}`, 502)
  return d?.data && !d.id ? d.data : d                 // certaines réponses sont enveloppées { success, data }
}

async function creer(req, jeton) {
  const b = await req.json().catch(() => ({}))
  const retour = SITES.find((s) => String(b.retour || "").startsWith(s + "/")) ? String(b.retour) : `${SITES[0]}/abonnement`
  const p = await rpc("paiement_preparer", { p_offre: String(b.offre || ""), p_periode: String(b.periode || "") }, jeton)
  const sep = retour.includes("?") ? "&" : "?"
  let s
  try {
    s = await saspay("/checkout-sessions/", { method: "POST", body: JSON.stringify({
      amount: `${p.montant}.00`, currency: "XAF", country: "CM",
      description: `NexIA School — offre ${p.offre} (${p.periode === "annuel" ? "1 an" : "1 mois"})`,
      customer_email: p.email || "contact@nexiaschool.com", customer_name: String(p.etablissement || "Établissement").slice(0, 100),
      return_url: `${retour}${sep}paiement=${p.id}`, metadata: { paiement_id: p.id, offre: p.offre, periode: p.periode },
    }) })
  } catch (e) {
    await rpc("_paiement_echec", { p_id: p.id, p_statut: "echoue" }).catch(() => {})
    throw e
  }
  if (!s?.id || !s?.checkout_url) throw new Erreur("SasPay n'a pas renvoyé de page de paiement.", 502)
  await rpc("_paiement_session", { p_id: p.id, p_session: String(s.id), p_url: String(s.checkout_url) })
  return { id: p.id, url: s.checkout_url, montant: p.montant }
}

/** Revérifie auprès de SasPay les paiements en attente (d'un établissement, ou un seul), et valide ceux qui sont payés. */
async function verifierAttente(etab, id) {
  const liste = await rpc("_paiements_a_verifier", { p_etab: etab, p_id: id })
  const bilan = []
  for (const x of liste || []) {
    try {
      const st = await saspay(`/checkout-sessions/${encodeURIComponent(x.session_id)}/status/`)
      const statut = String(st?.status || "").toUpperCase()
      if (statut === "PAID" && String(st.transaction_status || "SUCCESS").toUpperCase() === "SUCCESS") {
        const d = await saspay(`/checkout-sessions/${encodeURIComponent(x.session_id)}/`)
        if (String(d?.currency || "").toUpperCase() !== "XAF") throw new Error(`devise inattendue ${d?.currency}`)
        const r = await rpc("_paiement_valider", { p_id: x.id, p_transaction: String(st.transaction_id || st.transaction_reference || ""), p_montant: Number(d.amount) })
        bilan.push({ id: x.id, statut: "paye", fin: r?.fin })
      } else if (["CANCELLED", "CANCELED"].includes(statut)) {
        await rpc("_paiement_echec", { p_id: x.id, p_statut: "annule" }); bilan.push({ id: x.id, statut: "annule" })
      } else if (["EXPIRED", "FAILED"].includes(statut)) {
        await rpc("_paiement_echec", { p_id: x.id, p_statut: "echoue" }); bilan.push({ id: x.id, statut: "echoue" })
      } else {
        bilan.push({ id: x.id, statut: "en_attente" })
      }
    } catch (e) { bilan.push({ id: x.id, statut: "en_attente", erreur: e.message }) }
  }
  return bilan
}

async function verifier(req, jeton) {
  const b = await req.json().catch(() => ({}))
  const id = UUID.test(String(b.paiement_id || "")) ? String(b.paiement_id) : null
  const a = await rpc("mon_abonnement", {}, jeton)          // réservé à l'administrateur ; donne l'établissement par ses paiements
  const miens = new Set((a?.paiements || []).map((p) => p.id))
  if (id && !miens.has(id)) throw new Erreur("Paiement introuvable.", 404)
  const ids = id ? [id] : [...miens]
  const bilan = []
  for (const x of ids) bilan.push(...(await verifierAttente(null, x)))
  return { paiements: bilan, abonnement: await rpc("mon_abonnement", {}, jeton) }
}

async function hmacHex(secret, texte) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const s = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texte))
  return [...new Uint8Array(s)].map((o) => o.toString(16).padStart(2, "0")).join("")
}
const egal = (a, b) => a.length === b.length && [...a].reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

async function webhook(req) {
  if (!SECRET_WEBHOOK) throw new Erreur("Webhook non configuré.", 503)
  const corps = await req.text()
  const recue = (req.headers.get("x-webhook-signature") || "").trim().toLowerCase()
  const horodatage = (req.headers.get("x-webhook-timestamp") || "").trim()
  // SasPay signe « horodatage.corps » (HMAC-SHA256 en hexadécimal) et date chaque tentative : refus au-delà de 5 minutes d'écart
  if (!/^\d{9,12}$/.test(horodatage) || Math.abs(Date.now() / 1000 - Number(horodatage)) > 300) throw new Erreur("Horodatage hors tolérance.", 401)
  if (!recue || !egal(recue, await hmacHex(SECRET_WEBHOOK, `${horodatage}.${corps}`))) throw new Erreur("Signature invalide.", 401)
  // le contenu ne fait pas foi : on revérifie auprès de SasPay les paiements en attente
  return { recu: true, paiements: await verifierAttente(null, null) }
}

export async function traiter(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ erreur: "Méthode non autorisée" }, 405)
  if (!URL_SUPABASE || !CLE_PUBLIQUE || !CLE_SERVEUR) return json({ erreur: "Configuration serveur incomplète." }, 500)
  const action = new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop()
  try {
    if (action === "webhook") return json(await webhook(req))
    const jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
    if (!jeton || jeton === CLE_PUBLIQUE) return json({ erreur: "Connexion requise." }, 401)
    if (action === "creer") return json(await creer(req, jeton))
    if (action === "verifier") return json(await verifier(req, jeton))
    return json({ erreur: "Action inconnue." }, 404)
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500)
  }
}

if (globalThis.Deno) globalThis.Deno.serve(traiter)
