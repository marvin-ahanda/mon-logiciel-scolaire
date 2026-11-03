// @ts-nocheck  (JavaScript standard, aussi exécuté par le banc d'essai Node)
// Serveur MCP de NexIA School (Supabase Edge Function, transport « Streamable HTTP » sans état, réponses JSON)
// + serveur d'autorisation OAuth 2.1 (métadonnées, enregistrement dynamique, jetons) pour les connecteurs Claude.ai.
// Toute la sécurité (clé, établissement, rôle, droits d'écriture, limite d'appels, journal) est appliquée en base
// par les fonctions SQL « api_* » ; ce serveur traduit les appels MCP et calcule moyennes, rangs et statistiques.
import { appreciation, calculerResultats, notePeriode } from "./calculs.js"
import { calculerBilans, sequencesDePeriode } from "./discipline.js"
import { statistiquesClasse } from "./statistiques.js"

const env = (k) => (globalThis.Deno ? globalThis.Deno.env.get(k) : globalThis.process?.env?.[k])
const BASE = env("NEXIA_BASE_URL") || "https://nexiaschool.netlify.app"
const SUPABASE_URL = env("SUPABASE_URL") || "https://woxdqzocwqnrpfmxlsbq.supabase.co"
const CLE_PUBLIQUE = env("SUPABASE_ANON_KEY") || "sb_publishable_wfw2lxWPuDSEYWDvIh2BPg_BhO55ZfX"
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
const METADONNEES_RESSOURCE = `${BASE}/.well-known/oauth-protected-resource`

let fetchRpc = (url, init) => fetch(url, init)          // remplaçable par les tests
export function remplacerFetch(f) { fetchRpc = f }

class ErreurApi extends Error {
  constructor(message, code) { super(message); this.code = code }
}

async function rpc(nom, params) {
  const r = await fetchRpc(`${SUPABASE_URL}/rest/v1/rpc/${nom}`, {
    method: "POST", headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(params),
  })
  const texte = await r.text()
  const donnees = texte ? JSON.parse(texte) : null
  if (!r.ok) throw new ErreurApi(donnees?.message || `Erreur ${r.status}`, donnees?.code)
  return donnees
}

// --- Réponses HTTP ----------------------------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
}
const json = (corps, statut = 200, entetes = {}) =>
  new Response(JSON.stringify(corps), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...entetes } })
const nonAutorise = (message) => json({ jsonrpc: "2.0", error: { code: -32001, message } }, 401,
  { "WWW-Authenticate": `Bearer resource_metadata="${METADONNEES_RESSOURCE}", error="invalid_token", error_description="${message.replace(/"/g, "'")}"` })

// --- Outils ------------------------------------------------------------------------------------------------
const P_CLASSE = { type: "string", description: "Libellé de la classe, ex. « 6e A » (voir lister_classes)" }
const P_PERIODE = { type: "string", description: "Période : s1 à s6 (séquence), t1 à t3 (trimestre) ou annee (bilan annuel)", default: "t1" }
const P_CONFIRMER = { type: "boolean", description: "false (par défaut) : renvoie un aperçu sans rien enregistrer. true : enregistre. Demandez toujours l'accord de l'utilisateur avant de passer true.", default: false }

const OUTILS = [
  { name: "contexte_etablissement", title: "Contexte de l'établissement",
    description: "Établissement, exercice actif, séquences (verrouillées ou non), utilisateur connecté et ses droits. À appeler en premier.",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "lister_classes", title: "Classes", description: "Liste des classes avec leur effectif (et les matières que l'utilisateur y enseigne).",
    inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "lister_eleves", title: "Élèves d'une classe", description: "Élèves inscrits dans une classe : matricule, nom, prénom, sexe, date de naissance.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE }, required: ["classe"] }, annotations: { readOnlyHint: true } },
  { name: "resultats_classe", title: "Résultats et classement",
    description: "Classement d'une classe pour une période : rang, moyenne générale, appréciation, et statistiques de la classe. details=true ajoute les notes par matière.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, periode: P_PERIODE, details: { type: "boolean", default: false } }, required: ["classe"] },
    annotations: { readOnlyHint: true } },
  { name: "bulletin_eleve", title: "Bulletin d'un élève",
    description: "Bulletin d'un élève pour une période : notes, coefficients, rangs et appréciations par matière, moyenne, rang, conduite.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, matricule: { type: "string" }, periode: P_PERIODE }, required: ["classe", "matricule"] },
    annotations: { readOnlyHint: true } },
  { name: "eleves_en_difficulte", title: "Élèves en difficulté",
    description: "Élèves dont la moyenne est sous un seuil (10 par défaut), avec leurs matières les plus faibles.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, periode: P_PERIODE, seuil: { type: "number", default: 10 } }, required: ["classe"] },
    annotations: { readOnlyHint: true } },
  { name: "statistiques_classe", title: "Statistiques d'une classe",
    description: "Répartition des moyennes par tranche et par sexe, résultats par sexe, statistiques par matière.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, periode: P_PERIODE }, required: ["classe"] }, annotations: { readOnlyHint: true } },
  { name: "discipline_classe", title: "Suivi disciplinaire",
    description: "Pour chaque élève : heures d'absence (justifiées ou non), retards, sanctions et note de discipline sur la période.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, periode: P_PERIODE }, required: ["classe"] }, annotations: { readOnlyHint: true } },
  { name: "saisir_notes", title: "Saisir des notes",
    description: "Enregistre des notes /20 pour une matière, une classe et une séquence (droit d'écriture requis ; un enseignant ne note que ses matières). Une note absente n'efface rien. Toujours faire d'abord un aperçu (confirmer=false).",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, matiere: { type: "string", description: "Code ou nom de la matière" },
      sequence: { type: "integer", minimum: 1, maximum: 6 },
      notes: { type: "array", items: { type: "object", properties: { matricule: { type: "string" }, note: { type: "number", minimum: 0, maximum: 20 } }, required: ["matricule", "note"] } },
      confirmer: P_CONFIRMER }, required: ["classe", "matiere", "sequence", "notes"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: "enregistrer_appel", title: "Faire l'appel",
    description: "Absences (heures non justifiées / justifiées, motif) et retards d'une classe pour une date (administration ou surveillant général). Remplace l'appel déjà saisi pour les élèves listés. Toujours faire d'abord un aperçu.",
    inputSchema: { type: "object", properties: { classe: P_CLASSE, date: { type: "string", description: "AAAA-MM-JJ (aujourd'hui par défaut)" },
      sequence: { type: "integer", minimum: 1, maximum: 6 },
      lignes: { type: "array", items: { type: "object", properties: { matricule: { type: "string" }, heures_non_justifiees: { type: "integer", minimum: 0, maximum: 24 },
        heures_justifiees: { type: "integer", minimum: 0, maximum: 24 }, motif: { type: "string" }, retard: { type: "boolean" } }, required: ["matricule"] } },
      confirmer: P_CONFIRMER }, required: ["classe", "sequence", "lignes"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: "ajouter_eleve", title: "Ajouter un élève",
    description: "Crée un élève et l'inscrit dans une classe de l'exercice actif (administration, droit d'écriture). Toujours faire d'abord un aperçu.",
    inputSchema: { type: "object", properties: { matricule: { type: "string" }, nom: { type: "string" }, prenom: { type: "string" }, sexe: { type: "string", enum: ["M", "F"] },
      date_naissance: { type: "string", description: "AAAA-MM-JJ" }, classe: P_CLASSE, confirmer: P_CONFIRMER }, required: ["matricule", "nom", "sexe"] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
]

// --- Calculs à partir des données d'une classe --------------------------------------------------------------
function periodeDe(code, sequences) {
  const c = String(code || "t1").toLowerCase().replace(/\s/g, "")
  let m = c.match(/^s(?:equence)?([1-6])$/)
  if (m) { const s = sequences.find((x) => x.numero === Number(m[1])); return { type: "sequence", sequenceId: s.id, libelle: `Séquence ${m[1]}` } }
  m = c.match(/^t(?:rimestre)?([1-3])$/)
  if (m) return { type: "trimestre", trimestre: Number(m[1]), libelle: `Trimestre ${m[1]}` }
  if (["a", "annee", "année", "an", "annuel"].includes(c)) return { type: "annee", libelle: "Bilan annuel" }
  throw new ErreurApi(`Période « ${code} » inconnue : utilisez s1 à s6, t1 à t3 ou annee.`)
}

function resultats(d, periode) {
  const parCle = new Map()
  for (const n of d.notes) {
    const cle = `${n.inscription_id}|${n.attribution_id}`
    if (!parCle.has(cle)) parCle.set(cle, new Map())
    parCle.get(cle).set(n.sequence_id, Number(n.valeur))
  }
  const notes = new Map()
  for (const [cle, seqs] of parCle) { const v = notePeriode(periode, seqs, d.sequences); if (v !== null) notes.set(cle, v) }
  const attributions = [...d.attributions].sort((a, b) => a.groupe - b.groupe || a.matiere.localeCompare(b.matiere, "fr"))
  const eleves = d.eleves.map((e) => ({ inscriptionId: e.inscription_id, eleve: e }))
  return { attributions, ...calculerResultats(eleves, attributions, notes, d.classe.coef_min || 0) }
}

const nom = (e) => `${e.nom} ${e.prenom || ""}`.trim()
const rang = (r, ex) => (r ? `${r}${r === 1 ? "er" : "e"}${ex ? " ex æquo" : ""}` : "non classé")

function bilans(d, periode) {
  const seqs = new Set(sequencesDePeriode(periode, d.sequences).map((s) => s.id))
  const dans = (x) => seqs.has(x.sequence_id)
  return calculerBilans(d.eleves.map((e) => e.inscription_id), d.absences.filter(dans), d.retards.filter(dans),
    d.incidents.filter(dans).map((x) => ({ inscription_id: x.inscription_id, libelle: `${x.libelle} (${x.date})`, points: x.points })),
    d.bareme || { note_max: 20, points_par_retard: 0.25, points_par_heure: 0.25 })
}

async function executer(outil, a, cle) {
  const donnees = (classe) => rpc("api_donnees_classe", { p_cle: cle, p_classe: classe })
  switch (outil) {
    case "contexte_etablissement": return rpc("api_contexte", { p_cle: cle })
    case "lister_classes": return rpc("api_classes", { p_cle: cle })
    case "lister_eleves": {
      const d = await donnees(a.classe)
      return { classe: d.classe.libelle, effectif: d.eleves.length,
               eleves: d.eleves.map((e) => ({ matricule: e.matricule, nom: e.nom, prenom: e.prenom, sexe: e.sexe, date_naissance: e.date_naissance, redoublant: e.redoublant })) }
    }
    case "resultats_classe": {
      const d = await donnees(a.classe), p = periodeDe(a.periode, d.sequences), r = resultats(d, p)
      return { classe: d.classe.libelle, periode: p.libelle, exercice: d.exercice, statistiques: r.stats,
        classement: [...r.resultats].sort((x, y) => (x.rang ?? 1e9) - (y.rang ?? 1e9)).map((x) => ({
          rang: rang(x.rang, x.exAequo), eleve: nom(x.eleve), matricule: x.eleve.matricule, moyenne: x.moyenne ?? x.moyenneNonClassee,
          classe: x.moyenne !== null, appreciation: x.appreciation,
          ...(a.details ? { notes: Object.fromEntries(x.lignes.map((l) => [l.matiere, l.note])) } : {}) })) }
    }
    case "bulletin_eleve": {
      const d = await donnees(a.classe), p = periodeDe(a.periode, d.sequences), r = resultats(d, p)
      const x = r.resultats.find((y) => y.eleve.matricule === String(a.matricule).trim())
      if (!x) throw new ErreurApi(`Aucun élève de matricule « ${a.matricule} » en ${d.classe.libelle}.`)
      const b = bilans(d, p).get(x.inscriptionId)
      return { eleve: nom(x.eleve), matricule: x.eleve.matricule, classe: d.classe.libelle, periode: p.libelle, exercice: d.exercice,
        matieres: x.lignes.map((l) => ({ matiere: l.matiere, enseignant: l.enseignant, note: l.note, coefficient: l.coefficient, points: l.points,
          rang: l.rang ? rang(l.rang, l.exAequo) : null, appreciation: appreciation(l.note) })),
        total_coefficients: x.totalCoef, total_points: x.totalPoints, moyenne: x.moyenne ?? x.moyenneNonClassee, rang: rang(x.rang, x.exAequo),
        effectif_classe: r.stats.classes, appreciation: x.appreciation, moyenne_classe: r.stats.moyenneClasse,
        conduite: { heures_non_justifiees: b.nj, heures_justifiees: b.j, retards: b.retards, sanctions: b.incidents, note_discipline: b.note } }
    }
    case "eleves_en_difficulte": {
      const d = await donnees(a.classe), p = periodeDe(a.periode, d.sequences), r = resultats(d, p), seuil = Number(a.seuil ?? 10)
      const liste = r.resultats.filter((x) => x.moyenne !== null && x.moyenne < seuil).sort((x, y) => x.moyenne - y.moyenne)
      return { classe: d.classe.libelle, periode: p.libelle, seuil, nombre: liste.length, effectif_classe: r.stats.classes,
        eleves: liste.map((x) => ({ eleve: nom(x.eleve), matricule: x.eleve.matricule, moyenne: x.moyenne, rang: rang(x.rang, x.exAequo),
          matieres_faibles: x.lignes.filter((l) => l.note !== null && l.note < 10).sort((u, v) => u.note - v.note).map((l) => `${l.matiere} (${l.note})`) })) }
    }
    case "statistiques_classe": {
      const d = await donnees(a.classe), p = periodeDe(a.periode, d.sequences), r = resultats(d, p), s = statistiquesClasse(r.resultats, r.attributions)
      return { classe: d.classe.libelle, periode: p.libelle, ensemble: s.global, par_sexe: { garcons: s.parSexe.M, filles: s.parSexe.F },
        repartition: s.repartition.map((l) => ({ tranche: l.libelle, garcons: l.parSexe.M, filles: l.parSexe.F, total: l.total, pourcentage: l.pourcentage })),
        par_matiere: s.matieres.map((m) => ({ matiere: m.attribution.matiere, enseignant: m.attribution.enseignant, ...m.tous,
          moyenne_garcons: m.parSexe.M.moyenne, moyenne_filles: m.parSexe.F.moyenne })) }
    }
    case "discipline_classe": {
      const d = await donnees(a.classe), p = periodeDe(a.periode, d.sequences), b = bilans(d, p)
      return { classe: d.classe.libelle, periode: p.libelle, bareme: d.bareme,
        eleves: d.eleves.map((e) => { const x = b.get(e.inscription_id); return { eleve: nom(e), matricule: e.matricule, heures_non_justifiees: x.nj,
          heures_justifiees: x.j, retards: x.retards, sanctions: x.incidents, note_discipline: x.note, appreciation: x.appreciation } }) }
    }
    case "saisir_notes": {
      if (!a.confirmer) {
        const d = await donnees(a.classe)
        const att = d.attributions.find((x) => [x.code, x.matiere].some((v) => v.toLowerCase() === String(a.matiere).toLowerCase()))
        if (!att) throw new ErreurApi(`Matière « ${a.matiere} » non enseignée en ${d.classe.libelle}.`)
        const seq = d.sequences.find((s) => s.numero === Number(a.sequence))
        if (!seq) throw new ErreurApi("Séquence inexistante (1 à 6).")
        const actuelles = new Map(d.notes.filter((n) => n.attribution_id === att.id && n.sequence_id === seq.id).map((n) => [n.inscription_id, Number(n.valeur)]))
        const parMat = new Map(d.eleves.map((e) => [e.matricule, e]))
        return { apercu: true, message: "Rien n'a été enregistré. Montrez ce récapitulatif à l'utilisateur, puis rappelez saisir_notes avec confirmer=true s'il est d'accord.",
          classe: d.classe.libelle, matiere: att.matiere, sequence: seq.numero, sequence_verrouillee: seq.verrouillee,
          lignes: (a.notes || []).map((l) => { const e = parMat.get(String(l.matricule).trim())
            return e ? { eleve: nom(e), matricule: e.matricule, note_actuelle: actuelles.get(e.inscription_id) ?? null, nouvelle_note: l.note }
                     : { matricule: l.matricule, erreur: "élève absent de la classe" } }) }
      }
      return rpc("api_saisir_notes", { p_cle: cle, p_classe: a.classe, p_matiere: a.matiere, p_sequence: Number(a.sequence), p_notes: a.notes || [] })
    }
    case "enregistrer_appel": {
      const jour = a.date || new Date().toISOString().slice(0, 10)
      if (!a.confirmer) {
        const d = await donnees(a.classe), parMat = new Map(d.eleves.map((e) => [e.matricule, e]))
        return { apercu: true, message: "Rien n'a été enregistré. Montrez ce récapitulatif à l'utilisateur, puis rappelez enregistrer_appel avec confirmer=true s'il est d'accord.",
          classe: d.classe.libelle, date: jour, sequence: Number(a.sequence),
          lignes: (a.lignes || []).map((l) => { const e = parMat.get(String(l.matricule).trim())
            return e ? { eleve: nom(e), heures_non_justifiees: l.heures_non_justifiees || 0, heures_justifiees: l.heures_justifiees || 0, motif: l.motif || "", retard: !!l.retard }
                     : { matricule: l.matricule, erreur: "élève absent de la classe" } }) }
      }
      return rpc("api_enregistrer_appel", { p_cle: cle, p_classe: a.classe, p_date: jour, p_sequence: Number(a.sequence), p_lignes: a.lignes || [] })
    }
    case "ajouter_eleve": {
      if (!a.confirmer) {
        await rpc("api_contexte", { p_cle: cle })
        return { apercu: true, message: "Rien n'a été enregistré. Rappelez ajouter_eleve avec confirmer=true si l'utilisateur confirme.",
          eleve: { matricule: a.matricule, nom: String(a.nom).toUpperCase(), prenom: a.prenom || "", sexe: a.sexe, date_naissance: a.date_naissance || null, classe: a.classe || null } }
      }
      return rpc("api_ajouter_eleve", { p_cle: cle, p_matricule: a.matricule, p_nom: a.nom, p_prenom: a.prenom || "", p_sexe: a.sexe,
        p_date_naissance: a.date_naissance || null, p_classe: a.classe || "" })
    }
  }
  throw new ErreurApi(`Outil inconnu : ${outil}`)
}

// --- Protocole MCP (JSON-RPC) -------------------------------------------------------------------------------
const INSTRUCTIONS = "Serveur de NexIA School, logiciel de gestion scolaire (notes, bulletins, discipline). Commencez par contexte_etablissement. " +
  "Les données concernent des élèves mineurs : n'en partagez que le nécessaire. Pour toute écriture (saisir_notes, enregistrer_appel, ajouter_eleve), " +
  "faites d'abord un aperçu (confirmer=false), montrez-le à l'utilisateur et n'appelez avec confirmer=true qu'après son accord explicite. " +
  "Les notes sont sur 20 ; périodes : s1 à s6, t1 à t3, annee."

async function traiterMessage(m, cle) {
  const reponse = (resultat) => ({ jsonrpc: "2.0", id: m.id, result: resultat })
  const erreur = (code, message) => ({ jsonrpc: "2.0", id: m.id, error: { code, message } })
  if (m.id === undefined || m.id === null) return null                       // notification : pas de réponse
  switch (m.method) {
    case "initialize": {
      await rpc("api_contexte", { p_cle: cle })                               // vérifie la clé dès la connexion
      const demandee = m.params?.protocolVersion
      return reponse({ protocolVersion: VERSIONS.includes(demandee) ? demandee : VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nexiaschool", title: "NexIA School", version: "1.0.0", websiteUrl: BASE }, instructions: INSTRUCTIONS })
    }
    case "ping": return reponse({})
    case "tools/list": return reponse({ tools: OUTILS })
    case "tools/call": {
      const nomOutil = m.params?.name
      if (!OUTILS.some((o) => o.name === nomOutil)) return erreur(-32602, `Outil inconnu : ${nomOutil}`)
      try {
        const resultat = await executer(nomOutil, m.params?.arguments || {}, cle)
        return reponse({ content: [{ type: "text", text: JSON.stringify(resultat, null, 2) }] })
      } catch (e) {
        if (e.code === "28000") throw e                                         // jeton expiré : 401 pour que le client le renouvelle
        return reponse({ content: [{ type: "text", text: `Erreur : ${e.message}` }], isError: true })
      }
    }
    default: return erreur(-32601, `Méthode non prise en charge : ${m.method}`)
  }
}

async function mcp(req) {
  const auth = req.headers.get("authorization") || ""
  const cle = (auth.match(/^Bearer\s+(\S+)$/i)?.[1] || req.headers.get("x-api-key") || "").trim()
  if (!/^nx[so]_[0-9a-f]{48}$/.test(cle)) return nonAutorise("Authentification requise : clé API NexIA School ou autorisation OAuth.")
  let corps
  try { corps = await req.json() } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } }, 400) }
  const messages = Array.isArray(corps) ? corps : [corps]
  try {
    const reponses = (await Promise.all(messages.map((m) => traiterMessage(m, cle)))).filter(Boolean)
    if (!reponses.length) return new Response(null, { status: 202, headers: CORS })
    return json(Array.isArray(corps) ? reponses : reponses[0])
  } catch (e) {
    if (e.code === "28000" || e.code === "42501" && /désactivé/.test(e.message)) return nonAutorise(e.message)
    return json({ jsonrpc: "2.0", id: messages[0]?.id ?? null, error: { code: -32000, message: e.message } }, 200)
  }
}

// --- OAuth 2.1 ---------------------------------------------------------------------------------------------
const metaRessource = () => ({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ["lecture", "ecriture"],
  bearer_methods_supported: ["header"], resource_name: "NexIA School", resource_documentation: `${BASE}/developpeurs` })
const metaServeur = () => ({ issuer: BASE, authorization_endpoint: `${BASE}/oauth/autoriser`, token_endpoint: `${BASE}/oauth/token`,
  registration_endpoint: `${BASE}/oauth/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["lecture", "ecriture"],
  service_documentation: `${BASE}/developpeurs` })

async function enregistrer(req) {
  let b
  try { b = await req.json() } catch { return json({ error: "invalid_client_metadata", error_description: "JSON invalide" }, 400) }
  try {
    return json(await rpc("oauth_enregistrer_client", { p_nom: b.client_name || "Application", p_redirect_uris: b.redirect_uris || [] }), 201)
  } catch (e) { return json({ error: "invalid_redirect_uri", error_description: e.message }, 400) }
}

async function jeton(req) {
  const type = req.headers.get("content-type") || ""
  const p = type.includes("application/json") ? await req.json() : Object.fromEntries(new URLSearchParams(await req.text()))
  let r
  if (p.grant_type === "authorization_code") {
    r = await rpc("oauth_echanger_code", { p_code: p.code || "", p_verifier: p.code_verifier || "", p_client_id: p.client_id || "", p_redirect_uri: p.redirect_uri || "" })
  } else if (p.grant_type === "refresh_token") {
    r = await rpc("oauth_rafraichir", { p_refresh: p.refresh_token || "", p_client_id: p.client_id || "" })
  } else {
    return json({ error: "unsupported_grant_type" }, 400)
  }
  return r.error ? json(r, 400) : json(r, 200, { Pragma: "no-cache" })
}

export async function traiter(req) {
  const url = new URL(req.url)
  const i = url.pathname.indexOf("/mcp")
  const chemin = (i >= 0 ? url.pathname.slice(i + 4) : url.pathname).replace(/\/+$/, "") || "/"
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
    if (req.method === "GET" && chemin.startsWith("/.well-known/oauth-protected-resource")) return json(metaRessource())
    if (req.method === "GET" && (chemin.startsWith("/.well-known/oauth-authorization-server") || chemin.startsWith("/.well-known/openid-configuration"))) return json(metaServeur())
    if (req.method === "POST" && chemin === "/oauth/register") return await enregistrer(req)
    if (req.method === "POST" && chemin === "/oauth/token") return await jeton(req)
    if (chemin === "/" && req.method === "POST") return await mcp(req)
    if (chemin === "/" && req.method === "GET") return new Response("Serveur MCP NexIA School : utilisez POST (Streamable HTTP).", { status: 405, headers: { Allow: "POST", ...CORS } })
    return json({ error: "not_found" }, 404)
  } catch (e) {
    return json({ error: "server_error", error_description: e.message }, 500)
  }
}

if (globalThis.Deno) globalThis.Deno.serve(traiter)
