// Saisies hors ligne : les notes et l'appel enregistrés sans connexion sont gardés sur l'appareil (file d'attente),
// puis envoyés automatiquement, dans l'ordre, dès que la connexion revient. Chaque saisie appartient à la personne connectée.
import { sessionLocale, supabase } from "../supabase.js"

const CLE = "nexiaschool.envois"
const EVENEMENT = "horsligne:maj"

/** Erreur due au réseau (pas de connexion, serveur injoignable), par opposition à un refus du serveur. */
export function estErreurReseau(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true
  return /Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_INTERNET_DISCONNECTED|Connexion au serveur impossible/i
    .test(`${e?.message || e} ${e?.details || ""}`)
}

function lire() {
  try { return JSON.parse(localStorage.getItem(CLE) || "[]") } catch { return [] }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)) } catch { /* stockage plein ou indisponible */ }
  window.dispatchEvent(new Event(EVENEMENT))
}
const verifier = ({ error }) => { if (error) { const e = new Error(error.message); e.details = error.details; e.code = error.code; throw e } }

// --- Opérations rejouables (les mêmes servent en ligne et à la synchronisation) -------------------------------
const OPERATIONS = {
  /** Notes d'une matière (attribution) pour une séquence : écritures et effacements par élève. */
  async notes({ attribution_id, sequence_id, ecrire: lignes, effacer }) {
    if (lignes.length) verifier(await supabase.from("notes").upsert(lignes.map((l) => ({ ...l, attribution_id, sequence_id })),
      { onConflict: "inscription_id,attribution_id,sequence_id" }))
    if (effacer.length) verifier(await supabase.from("notes").delete().eq("attribution_id", attribution_id).eq("sequence_id", sequence_id).in("inscription_id", effacer))
  },
  /** Appel d'un jour : absences (heures, motif) et retards, élève par élève. */
  async appel({ sequence_id, date, absences, effacerAbsences, retards, effacerRetards }) {
    if (absences.length) verifier(await supabase.from("absences").upsert(absences.map((a) => ({ ...a, sequence_id, date })), { onConflict: "inscription_id,date" }))
    if (effacerAbsences.length) verifier(await supabase.from("absences").delete().eq("date", date).in("inscription_id", effacerAbsences))
    if (retards.length) verifier(await supabase.from("retards").upsert(retards.map((inscription_id) => ({ inscription_id, sequence_id, date })),
      { onConflict: "inscription_id,date", ignoreDuplicates: true }))
    if (effacerRetards.length) verifier(await supabase.from("retards").delete().eq("date", date).in("inscription_id", effacerRetards))
  },
}

async function utilisateur() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id || (navigator.onLine === false ? sessionLocale()?.user?.id : null) || null
}

/**
 * Enregistre maintenant si possible ; sinon (pas de réseau) garde la saisie sur l'appareil.
 * Renvoie { enAttente: false } si c'est enregistré sur le serveur, { enAttente: true } si c'est gardé pour plus tard.
 * Une erreur venant du serveur (droits, séquence verrouillée…) est levée normalement.
 */
export async function envoyer(type, donnees, description) {
  if (typeof navigator === "undefined" || navigator.onLine !== false) {
    try { await OPERATIONS[type](donnees); return { enAttente: false } } catch (e) { if (!estErreurReseau(e)) throw e }
  }
  const liste = lire()
  liste.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, cree: new Date().toISOString(), utilisateur: await utilisateur(),
               type, donnees, description })
  ecrire(liste)
  return { enAttente: true }
}

/** Saisies en attente de la personne connectée (échecs compris). */
export function enAttente(idUtilisateur, filtre = () => true) {
  return lire().filter((x) => (!idUtilisateur || x.utilisateur === idUtilisateur) && filtre(x))
}

export function abandonner(id) { ecrire(lire().filter((x) => x.id !== id)) }

let enCours = null
/** Envoie les saisies en attente, dans l'ordre. S'arrête au premier problème de réseau ; un refus du serveur est mis de côté. */
export function synchroniser() {
  if (enCours) return enCours
  enCours = (async () => {
    const moi = await utilisateur()
    let envoyees = 0, refusees = 0
    if (!moi || (typeof navigator !== "undefined" && navigator.onLine === false)) return { envoyees, refusees }
    for (const op of lire().filter((x) => x.utilisateur === moi && !x.erreur)) {
      try {
        await OPERATIONS[op.type](op.donnees)
        ecrire(lire().filter((x) => x.id !== op.id)); envoyees++
      } catch (e) {
        if (estErreurReseau(e)) break
        ecrire(lire().map((x) => (x.id === op.id ? { ...x, erreur: e.message } : x))); refusees++
      }
    }
    if (envoyees) window.dispatchEvent(new CustomEvent("horsligne:synchro", { detail: { envoyees } }))
    return { envoyees, refusees }
  })().finally(() => { enCours = null })
  return enCours
}

export const EVENEMENT_HORS_LIGNE = EVENEMENT
