// @ts-nocheck  (JavaScript standard, aussi exécuté par le banc d'essai Node)
// Paiement des abonnements NexIA School par SasPay (page de paiement hébergée : mobile money, carte).
//   POST /paiement/creer     { produit, capacite?, matiere?, nom?, retour } → { url } de la page SasPay
//       produits : etab_abonnement / etab_extension (administrateur d'établissement), se_abonnement / se_credits / se_groupe (enseignant SmartEval)
//   POST /paiement/verifier  { paiement_id? } (personne connectée) → revérifie SES paiements en attente (établissement ou compte enseignant)
//   POST /paiement/webhook   notification SasPay signée (X-Webhook-Signature) → revérifie les paiements en attente
//   POST /paiement/rappels   (tâche planifiée quotidienne) e-mails « fin d'abonnement dans N jours » de J-5 au dernier jour ; un seul par jour
// Le montant est fixé en base (paiement_preparer) et un paiement n'est validé qu'après vérification auprès de l'API
// SasPay (statut PAYÉ + montant + devise) : ni le navigateur ni le contenu d'un webhook ne suffisent à activer une offre.
// Secrets (Supabase → Edge Functions → Secrets) : SASPAY_SECRET_KEY (sk_test_… ou sk_live_…), SASPAY_WEBHOOK_SECRET.
// Reçu par e-mail à chaque paiement validé (service Resend) : RESEND_API_KEY, et facultativement RECU_EXPEDITEUR
// (défaut « NexIA School <contact@nexiaschool.com> », adresse dont le domaine doit être vérifié chez Resend). Sans clé : pas d'e-mail,
// le reçu reste téléchargeable en PDF depuis la page Abonnement.
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
const RESEND = (env("RESEND_API") || "https://api.resend.com").replace(/\/$/, "")
const CLE_RESEND = env("RESEND_API_KEY")
const EXPEDITEUR = env("RECU_EXPEDITEUR") || "NexIA School <contact@nexiaschool.com>"
const SITE = (env("NEXIA_SITE") || "https://nexiaschool.com").replace(/\/$/, "")
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
  if (!r.ok) {
    console.error("SasPay", init.method || "GET", chemin.replace(/[0-9a-f-]{36}/gi, ":id"), r.status, texte.slice(0, 500))   // diagnostic (aucune clé)
    throw new Erreur(d?.message || d?.error?.detail || `SasPay : erreur ${r.status}`, 502)
  }
  return d?.data && !d.id ? d.data : d                 // certaines réponses sont enveloppées { success, data }
}

async function creer(req, jeton) {
  const b = await req.json().catch(() => ({}))
  const retour = SITES.find((s) => String(b.retour || "").startsWith(s + "/")) ? String(b.retour) : `${SITES[0]}/abonnement`
  // produit, quantité et MONTANT fixés en base (configuration commerciale) : rien n'est repris du navigateur
  const demande = { produit: String(b.produit || ""), capacite: Number(b.capacite) || null, matiere: String(b.matiere || "").slice(0, 80), nom: String(b.nom || "").slice(0, 120) }
  const p = await rpc("paiement_preparer_produit", { p: demande }, jeton)
  if (p?.gratuit) return { gratuit: true, capacite: p.capacite }        // augmentation couverte par le montant déjà payé : appliquée sans paiement
  const sep = retour.includes("?") ? "&" : "?"
  let s
  try {
    s = await saspay("/checkout-sessions/", { method: "POST", body: JSON.stringify({
      amount: `${p.montant}.00`, currency: "XAF", country: "CM",
      description: String(p.libelle || "NexIA School").slice(0, 200),
      customer_email: p.email || "contact@nexiaschool.com", customer_name: String(p.client || "Client NexIA School").slice(0, 100),
      return_url: `${retour}${sep}paiement=${p.id}`, metadata: { paiement_id: p.id, produit: p.produit },
    }) })
  } catch (e) {
    await rpc("_paiement_echec", { p_id: p.id, p_statut: "echoue" }).catch(() => {})
    throw e
  }
  if (!s?.id || !s?.checkout_url) throw new Erreur("SasPay n'a pas renvoyé de page de paiement.", 502)
  await rpc("_paiement_session", { p_id: p.id, p_session: String(s.id), p_url: String(s.checkout_url) })
  return { id: p.id, url: s.checkout_url, montant: p.montant }
}

const echapper = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
const montantTexte = (n) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(n)).replace(/[\u202f\u00a0]/g, " ")} FCFA`
const jourTexte = (d) => new Date(d).toLocaleDateString("fr-FR", { timeZone: "Africa/Douala" })
const NOMS = { essentiel: "Premium", pro: "Premium", premium: "Premium", smarteval: "SmartEval Enseignant", credits: "Crédits SmartEval", groupe: "SmartEval Groupe" }

/** Envoie le reçu par e-mail (une seule fois par paiement). Ne bloque jamais l'activation de l'offre : toute erreur est ignorée. */
async function envoyerRecu(id) {
  if (!CLE_RESEND) return false
  try {
    const r = await rpc("_recu_a_envoyer", { p_id: id })
    if (!r?.email) return false
    const offre = r.libelle || NOMS[r.offre] || r.offre
    const duree = r.periode === "annuel" ? "12 mois / 12 months" : r.periode === "mensuel" ? "1 mois / 1 month" : "—"
    const lignes = [["Reçu / Receipt", r.numero], ["Date", jourTexte(r.date)], ["Établissement / School", r.etablissement?.nom],
      ["Offre / Plan", `${offre} (${duree})`], ["Période / Period", `${jourTexte(r.debut)} → ${jourTexte(r.fin)}`], ["Montant / Amount", montantTexte(r.montant)],
      ["Référence / Reference", r.transaction || "—"]]
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#212529">
      <h2 style="color:#0b46e5">NexIA School</h2>
      <p>Merci, votre paiement est bien reçu et votre offre <strong>${echapper(offre)}</strong> est active jusqu'au <strong>${jourTexte(r.fin)}</strong>.<br>
      <em>Thank you: your payment was received and your <strong>${echapper(offre)}</strong> plan is active until ${jourTexte(r.fin)}.</em></p>
      <table style="border-collapse:collapse;width:100%">${lignes.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #dee2e6;color:#6c757d">${echapper(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #dee2e6"><strong>${echapper(v)}</strong></td></tr>`).join("")}</table>
      ${r.code ? `<p><a href="${SITE}/recu/${encodeURIComponent(r.code)}" style="color:#0b46e5">Vérifier l'authenticité de ce reçu / Verify this receipt</a></p>` : ""}
      <p style="color:#6c757d;font-size:13px">Ce reçu vaut preuve de paiement. Vous pouvez aussi le télécharger en PDF depuis Abonnement et paiement dans votre espace.<br>
      This receipt serves as proof of payment. You can also download it as a PDF from Subscription in your account.</p>
      <p style="color:#6c757d;font-size:13px">NexIA School · contact@nexiaschool.com</p></div>`
    const rep = await envoyer(`${RESEND}/emails`, { method: "POST", headers: { Authorization: `Bearer ${CLE_RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EXPEDITEUR, to: [r.email], subject: `Reçu ${r.numero} — NexIA School / Receipt`, html }) })
    if (!rep.ok) { console.error("Resend", rep.status, (await rep.text()).slice(0, 300)); return false }
    await rpc("_recu_marquer_envoye", { p_id: id })
    return true
  } catch (e) { console.error("Reçu", e?.message); return false }
}

/** Message bref du rappel, avec le décompte des jours. */
function texteRappel(jours) {
  if (jours <= 0) return ["Votre abonnement se termine aujourd'hui. Pensez à le renouveler.", "Your subscription ends today. Remember to renew it."]
  if (jours === 1) return ["Fin d'abonnement demain. Pensez à le renouveler.", "Your subscription ends tomorrow. Remember to renew it."]
  return [`Fin d'abonnement dans ${jours} jours. Pensez à le renouveler.`, `Your subscription ends in ${jours} days. Remember to renew it.`]
}

/** Rappels du jour (appelés chaque matin par la tâche planifiée) : un e-mail par établissement concerné, une seule fois par jour. */
async function rappels() {
  if (!CLE_RESEND) return { envoyes: 0, raison: "e-mail non configuré" }
  const liste = await rpc("_rappels_a_envoyer", {})
  let envoyes = 0
  for (const x of liste || []) {
    try {
      const [fr, en] = texteRappel(Number(x.jours)), offre = NOMS[x.offre] || x.offre
      const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#212529">
        <h2 style="color:#0b46e5;margin-bottom:8px">NexIA School</h2>
        <p style="font-size:16px"><strong>${echapper(fr)}</strong><br><em style="color:#6c757d">${echapper(en)}</em></p>
        <p>${echapper(x.etablissement)} · offre ${echapper(offre)} · échéance le ${jourTexte(x.echeance)}</p>
        <p><a href="${SITE}/abonnement" style="display:inline-block;background:#0b46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Renouveler / Renew</a></p>
        <p style="color:#6c757d;font-size:12px">Sans renouvellement, l'établissement repasse en offre Découverte à l'échéance ; ses données sont conservées.</p></div>`
      const rep = await envoyer(`${RESEND}/emails`, { method: "POST", headers: { Authorization: `Bearer ${CLE_RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: EXPEDITEUR, to: x.emails, subject: `${fr} — NexIA School`, html }) })
      if (!rep.ok) { console.error("Resend rappel", rep.status, (await rep.text()).slice(0, 300)); continue }
      await rpc("_rappel_envoye", { p_etab: x.etablissement_id, p_echeance: x.echeance, p_jours: Number(x.jours) })
      envoyes++
    } catch (e) { console.error("Rappel", e?.message) }
  }
  return { envoyes, a_envoyer: (liste || []).length }
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
        const recu = await envoyerRecu(x.id)
        bilan.push({ id: x.id, statut: "paye", fin: r?.fin, numero_recu: r?.numero_recu, recu_envoye: recu })
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
  const liste = await rpc("mes_paiements", {}, jeton)       // paiements de l'établissement administré ou du compte enseignant connecté
  const miens = new Set((liste || []).map((p) => p.id))
  if (id && !miens.has(id)) throw new Erreur("Paiement introuvable.", 404)
  const ids = id ? [id] : [...miens]
  const bilan = []
  for (const x of ids) bilan.push(...(await verifierAttente(null, x)))
  // rattrapage : reçus de paiements validés des 30 derniers jours qui n'ont pas encore pu partir par e-mail (déjà envoyés : ignorés)
  const recents = (liste || []).filter((p) => p.statut === "paye" && p.paye_le && Date.now() - new Date(p.paye_le) < 30 * 864e5)
  for (const p of recents) await envoyerRecu(p.id)
  return { paiements: bilan }
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
    if (action === "rappels") return json(await rappels())          // sans danger : n'envoie que les rappels dus, une fois par jour
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
