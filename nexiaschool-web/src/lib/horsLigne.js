// Saisies hors ligne (« offline-first ») : notes, appel, élèves (ajout, modification) et infractions enregistrés sans
// connexion sont gardés sur l'appareil (IndexedDB), dans une file d'attente, puis envoyés automatiquement, dans l'ordre,
// dès que la connexion revient. Chaque saisie appartient à la personne connectée.
//
// Conflits (règle simple) : une modification faite hors ligne garde la valeur de départ (« base »). Au moment de l'envoi,
// si le serveur a été modifié entre-temps par quelqu'un d'autre sur la même donnée, avec une autre valeur, rien n'est écrasé :
// la saisie passe en « conflit » et l'utilisateur choisit « garder ma version » ou « garder celle du serveur ».
// Les parties sans conflit sont envoyées normalement.
import { sessionLocale, supabase } from "../supabase.js"
import { ecrireLocal, lireLocal } from "./stockageLocal.js"

const ANCIENNE_CLE = "nexiaschool.envois"          // ancienne file (localStorage), reprise automatiquement
const CLE = "envois"
const EVENEMENT = "horsligne:maj"

/** Erreur due au réseau (pas de connexion, serveur injoignable, délai dépassé), par opposition à un refus du serveur. */
export function estErreurReseau(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  return /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET_DISCONNECTED|Connexion au serveur impossible|timeout|délai|AbortError|503|502|504/i
    .test(`${e?.message || e} ${e?.details || ""} ${e?.name || ""}`)
}

// --- File d'attente : copie en mémoire (lecture immédiate) + IndexedDB (durable) -------------------------------
let memoire = []
let chargee = false
function reprendreAncienne() {
  try {
    const a = JSON.parse(localStorage.getItem(ANCIENNE_CLE) || "null")
    if (Array.isArray(a) && a.length) {
      const ids = new Set(memoire.map((x) => x.id))
      memoire = [...memoire, ...a.filter((x) => !ids.has(x.id))]
      localStorage.removeItem(ANCIENNE_CLE)
      ecrireLocal(CLE, memoire)
    }
  } catch { /* stockage indisponible */ }
}
function lire() { reprendreAncienne(); return memoire }
function ecrire(liste) {
  memoire = liste
  ecrireLocal(CLE, liste)
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENEMENT))
}
/** Chargement de la file enregistrée (au démarrage de l'application). */
export const pret = (async () => {
  try {
    const l = await lireLocal(CLE)
    if (Array.isArray(l)) { const ids = new Set(memoire.map((x) => x.id)); memoire = [...l.filter((x) => !ids.has(x.id)), ...memoire] }
  } catch { /* indisponible */ }
  chargee = true
  reprendreAncienne()
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENEMENT))
})()
export const fileChargee = () => chargee

const verifier = ({ data, error }) => { if (error) { const e = new Error(error.message); e.details = error.details; e.code = error.code; throw e } return data }
const nouvelId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

// --- Opérations rejouables (les mêmes servent en ligne et à la synchronisation) -------------------------------
// conflits(donnees) : renvoie { conflits, reste } — conflits = données modifiées ailleurs, reste = ce qui peut partir
const OPERATIONS = {
  /** Notes d'une matière (attribution) pour une séquence : écritures et effacements par élève. base = { inscription: valeur avant | null } */
  notes: {
    async appliquer({ attribution_id, sequence_id, ecrire: lignes, effacer }) {
      if (lignes.length) verifier(await supabase.from("notes").upsert(lignes.map((l) => ({ ...l, attribution_id, sequence_id })),
        { onConflict: "inscription_id,attribution_id,sequence_id" }))
      if (effacer.length) verifier(await supabase.from("notes").delete().eq("attribution_id", attribution_id).eq("sequence_id", sequence_id).in("inscription_id", effacer))
    },
    async conflits(d) {
      if (!d.base) return { conflits: [], reste: d }
      const ids = [...d.ecrire.map((l) => l.inscription_id), ...d.effacer]
      const serveur = new Map((verifier(await supabase.from("notes").select("inscription_id, valeur").eq("attribution_id", d.attribution_id)
        .eq("sequence_id", d.sequence_id).in("inscription_id", ids)) || []).map((n) => [n.inscription_id, Number(n.valeur)]))
      const conflits = []
      const garde = (id, mien) => {
        const s = serveur.has(id) ? serveur.get(id) : null, b = d.base[id] ?? null
        if (s === b || s === mien) return true
        conflits.push({ cle: id, libelle: d.noms?.[id] || id, mien, serveur: s, base: b }); return false
      }
      return { conflits, reste: { ...d, ecrire: d.ecrire.filter((l) => garde(l.inscription_id, l.valeur)), effacer: d.effacer.filter((id) => garde(id, null)) } }
    },
  },
  /** Appel d'un jour : absences (heures, motif) et retards, élève par élève (la dernière saisie l'emporte). */
  appel: {
    async appliquer({ sequence_id, date, absences, effacerAbsences, retards, effacerRetards }) {
      if (absences.length) verifier(await supabase.from("absences").upsert(absences.map((a) => ({ ...a, sequence_id, date })), { onConflict: "inscription_id,date" }))
      if (effacerAbsences.length) verifier(await supabase.from("absences").delete().eq("date", date).in("inscription_id", effacerAbsences))
      if (retards.length) verifier(await supabase.from("retards").upsert(retards.map((inscription_id) => ({ inscription_id, sequence_id, date })),
        { onConflict: "inscription_id,date", ignoreDuplicates: true }))
      if (effacerRetards.length) verifier(await supabase.from("retards").delete().eq("date", date).in("inscription_id", effacerRetards))
    },
  },
  /**
   * Élève : ajout (identifiant créé sur l'appareil) ou modification, et inscription de l'année.
   * { id, nouveau, valeurs, base?, inscription: { id?, exercice_id, classe_id, redoublant, nouveau } | null, retirerInscription? }
   */
  eleve: {
    async appliquer({ id, nouveau, valeurs, inscription, retirerInscription }) {
      if (nouveau) verifier(await supabase.from("eleves").upsert({ id, ...valeurs }, { onConflict: "id" }))
      else if (Object.keys(valeurs).length) verifier(await supabase.from("eleves").update(valeurs).eq("id", id))
      if (inscription?.id) verifier(await supabase.from("inscriptions").update({ classe_id: inscription.classe_id, redoublant: inscription.redoublant, nouveau: inscription.nouveau }).eq("id", inscription.id))
      else if (inscription) verifier(await supabase.from("inscriptions").upsert({ exercice_id: inscription.exercice_id, eleve_id: id, classe_id: inscription.classe_id,
        redoublant: inscription.redoublant, nouveau: inscription.nouveau }, { onConflict: "exercice_id,eleve_id" }))
      else if (retirerInscription) verifier(await supabase.from("inscriptions").delete().eq("id", retirerInscription))
    },
    async conflits(d) {
      if (d.nouveau || !d.base) return { conflits: [], reste: d }
      const s = verifier(await supabase.from("eleves").select("*").eq("id", d.id).maybeSingle())
      if (!s) { const e = new Error("Élève supprimé entre-temps sur le serveur."); throw e }
      const conflits = [], valeurs = {}
      for (const [k, v] of Object.entries(d.valeurs)) {
        const sv = s[k] ?? null, b = d.base[k] ?? null
        if (sv === b || sv === v) valeurs[k] = v
        else conflits.push({ cle: k, libelle: k, mien: v, serveur: sv, base: b })
      }
      return { conflits, reste: { ...d, valeurs } }
    },
  },
  /** Infraction (incident de discipline) : ajout, identifiant créé sur l'appareil (pas de doublon si l'envoi est rejoué). */
  incident: {
    async appliquer({ ligne }) { verifier(await supabase.from("incidents").upsert(ligne, { onConflict: "id", ignoreDuplicates: true })) },
  },
}

async function utilisateur() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id || (typeof navigator !== "undefined" && navigator.onLine === false ? sessionLocale()?.user?.id : null) || null
}

/**
 * Enregistre maintenant si possible ; sinon (pas de réseau, réseau trop lent) garde la saisie sur l'appareil.
 * Renvoie { enAttente: false } si c'est enregistré sur le serveur, { enAttente: true } si c'est gardé pour plus tard.
 * Une erreur venant du serveur (droits, séquence verrouillée…) est levée normalement.
 */
export async function envoyer(type, donnees, description) {
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    try { await OPERATIONS[type].appliquer(donnees); return { enAttente: false } } catch (e) { if (!estErreurReseau(e)) throw e }
  }
  await pret
  const liste = lire()
  liste.push({ id: nouvelId(), cree: new Date().toISOString(), utilisateur: await utilisateur(), type, donnees, description })
  ecrire([...liste])
  return { enAttente: true }
}

/** Saisies en attente de la personne connectée (échecs et conflits compris). */
export function enAttente(idUtilisateur, filtre = () => true) {
  return lire().filter((x) => (!idUtilisateur || x.utilisateur === idUtilisateur) && filtre(x))
}

export function abandonner(id) { ecrire(lire().filter((x) => x.id !== id)) }

/** Conflit : « garder ma version » (envoi forcé au prochain passage) ou « garder celle du serveur » (saisie abandonnée). */
export function resoudreConflit(id, garderMaVersion) {
  if (!garderMaVersion) return abandonner(id)
  ecrire(lire().map((x) => (x.id === id ? { ...x, force: true, conflits: undefined, erreur: undefined } : x)))
  return synchroniser()
}

let enCours = null
/**
 * Envoie les saisies en attente, dans l'ordre. S'arrête au premier problème de réseau ;
 * un refus du serveur ou un conflit est mis de côté (affiché), sans bloquer les suivantes.
 */
export function synchroniser() {
  if (enCours) return enCours
  enCours = (async () => {
    await pret
    const moi = await utilisateur()
    let envoyees = 0, refusees = 0, conflits = 0
    if (!moi || (typeof navigator !== "undefined" && navigator.onLine === false)) return { envoyees, refusees, conflits }
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("horsligne:etat", { detail: { synchro: true } }))
    try {
      for (const op of lire().filter((x) => x.utilisateur === moi && !x.erreur && !x.conflits)) {
        try {
          const o = OPERATIONS[op.type]
          let donnees = op.donnees
          if (o.conflits && !op.force) {
            const r = await o.conflits(donnees)
            if (r.conflits.length) {
              await o.appliquer(r.reste)
              ecrire(lire().map((x) => (x.id === op.id ? { ...x, donnees: { ...x.donnees, ...conserverConflits(op.type, x.donnees, r.conflits) }, conflits: r.conflits } : x)))
              conflits++; continue
            }
            donnees = r.reste
          }
          await o.appliquer(donnees)
          ecrire(lire().filter((x) => x.id !== op.id)); envoyees++
        } catch (e) {
          if (estErreurReseau(e)) break
          ecrire(lire().map((x) => (x.id === op.id ? { ...x, erreur: e.message } : x))); refusees++
        }
      }
    } finally {
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("horsligne:etat", { detail: { synchro: false } }))
    }
    if (envoyees && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("horsligne:synchro", { detail: { envoyees } }))
    return { envoyees, refusees, conflits }
  })().finally(() => { enCours = null })
  return enCours
}

/** Après un envoi partiel, la saisie ne garde que les parties en conflit (pour « garder ma version »). */
function conserverConflits(type, d, conflits) {
  const cles = new Set(conflits.map((c) => c.cle))
  if (type === "notes") return { ecrire: d.ecrire.filter((l) => cles.has(l.inscription_id)), effacer: d.effacer.filter((id) => cles.has(id)) }
  if (type === "eleve") return { valeurs: Object.fromEntries(Object.entries(d.valeurs).filter(([k]) => cles.has(k))), inscription: null, retirerInscription: null }
  return {}
}

/** Vide la file en mémoire (tests). */
export function reinitialiser() { memoire = [] }

export const EVENEMENT_HORS_LIGNE = EVENEMENT
export const nouvelIdentifiant = nouvelId
