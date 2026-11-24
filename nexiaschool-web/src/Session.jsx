import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { COLONNES_ETABLISSEMENT, COLONNES_PERSONNEL } from "./lib/colonnes.js"
import { adresseLogo } from "./lib/logo.js"
import { droitEffectif, offreEffective } from "./lib/offres.js"
import { rpc, sessionLocale, supabase, verifier } from "./supabase.js"

const Contexte = createContext(null)

/** Nombre de matières confiées à la personne cette année (gardé sur l'appareil pour le mode hors ligne). */
async function compterMesMatieres(profil, exercice) {
  const cle = `nexiaschool.mesMatieres.${profil.id}`
  if (!exercice) return 0
  try {
    if (navigator.onLine === false) throw new Error("hors ligne")
    // simple lecture (servie aussi par le cache hors ligne) : il suffit de savoir s'il y en a au moins une
    const { data, error } = await supabase.from("attributions").select("id").eq("exercice_id", exercice.id).eq("enseignant_id", profil.id).limit(1)
    if (error) throw error
    const n = data?.length || 0
    try { localStorage.setItem(cle, String(n)) } catch { /* stockage indisponible */ }
    return n
  } catch {
    try { return Number(localStorage.getItem(cle)) || 0 } catch { return 0 }
  }
}

/** Espace de l'enseignant indépendant (null : pas de compte SmartEval). */
async function lireEnseignant() {
  const { data, error } = await supabase.rpc("enseignant_contexte")
  if (error) return null
  return data
}

/** Droits effectifs de l'établissement, fonction par fonction (offre + réglages de la plateforme), gardés sur l'appareil. */
async function lireFonctions(etablissementId) {
  const cle = `nexiaschool.fonctions.${etablissementId}`
  try {
    if (navigator.onLine === false) throw new Error("hors ligne")
    const { data, error } = await supabase.rpc("mes_fonctions")
    if (error || !data) throw error || new Error("vide")
    try { localStorage.setItem(cle, JSON.stringify(data)) } catch { /* stockage indisponible */ }
    return data
  } catch {
    try { return JSON.parse(localStorage.getItem(cle) || "null") } catch { return null }
  }
}

export function SessionProvider({ children }) {
  const [etat, setEtat] = useState({ pret: false, session: null, profil: null, etablissement: null, exercice: null })

  const charger = useCallback(async (session) => {
    if (!session) return setEtat({ pret: true, session: null, profil: null, etablissement: null, exercice: null })
    try {
      const [profil, compte] = await Promise.all([
        supabase.from("personnels").select(COLONNES_PERSONNEL).eq("id", session.user.id).maybeSingle().then(verifier),
        supabase.rpc("mon_compte").then(({ data }) => data || {}),
      ])
      const proprietaire = !!compte.proprietaire
      const google = session.user.app_metadata?.provider === "google"
      if (compte.suspendu) {
        // établissement suspendu par la plateforme : plus aucun accès aux données, message explicite
        return setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, proprietaire,
                         suspendu: { etablissement: compte.etablissement, motif: compte.motif } })
      }
      if (!profil) {
        // enseignant indépendant (SmartEval) : compte sans établissement
        const enseignant = await lireEnseignant()
        if (enseignant?.compte) return setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, enseignant, proprietaire })
        const email = session.user.email || ""
        const verifiee = google || (!!session.user.email_confirmed_at && !!email && !email.endsWith(".invalid"))
        // adresse vérifiée sans espace : création de l'espace de l'établissement (Google) ou du compte SmartEval
        if (verifiee) return setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, sansEtablissement: google, sansCompte: true, proprietaire })
      }
      if (!profil || !profil.actif) {
        await supabase.auth.signOut()
        return setEtat({ pret: true, session: null, profil: null, etablissement: null, exercice: null })
      }
      const etablissement = verifier(await supabase.from("etablissements").select(COLONNES_ETABLISSEMENT).eq("id", profil.etablissement_id).single())
      const [exercice, logoUrl, fonctions, droitsFinance] = await Promise.all([
        supabase.from("exercices").select("*").eq("actif", true).maybeSingle().then(verifier),
        adresseLogo(etablissement.logo),
        lireFonctions(etablissement.id),
        // droits financiers de la personne (vérifiés côté serveur à chaque action) ; à défaut, ceux de son rôle
        rpc("mes_droits_finance").catch(() => null),
      ])
      const mesMatieres = await compterMesMatieres(profil, exercice)
      setEtat({ pret: true, session, profil, etablissement, exercice, logoUrl, proprietaire, mesMatieres, fonctions, droitsFinance })
    } catch (e) {
      console.error("NexIASchool : chargement du profil impossible", e)
      setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, erreur: e?.message || "erreur" })
    }
  }, [])

  useEffect(() => {
    // hors ligne, une session expirée ne peut pas être renouvelée : on garde celle de l'appareil jusqu'au retour du réseau
    supabase.auth.getSession().then(({ data }) => charger(data.session || (navigator.onLine === false ? sessionLocale() : null)))
    const { data } = supabase.auth.onAuthStateChange((evenement, session) => {
      if (evenement === "SIGNED_OUT" && navigator.onLine === false && sessionLocale()) return
      if (evenement === "SIGNED_IN" || evenement === "SIGNED_OUT") setTimeout(() => charger(session), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [charger])

  const recharger = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await charger(data.session)
  }, [charger])

  const role = etat.profil?.role
  const offre = offreEffective(etat.etablissement, Date.now(), etat.fonctions?.__offre)
  const aOffre = (fonction) => droitEffectif(etat.fonctions, offre, fonction)
  const offertes = etat.fonctions?.__offertes || []                      // fonctions offertes en plus de l'offre (avec échéance)
  const valeur = { ...etat, recharger, estIndependant: !!etat.enseignant?.compte, offre, aOffre, offertes, estAdmin: role === "admin", estEnseignant: role === "enseignant", estSurveillant: role === "surveillant",
                   peutDiscipline: role === "admin" || role === "surveillant",
                   // rubrique Notes (saisie, résultats, bulletins selon le rôle) : tout le personnel ; chacun ne saisit que les matières qui lui sont confiées
                   peutNoter: ["admin", "enseignant", "surveillant", "comptable"].includes(role),
                   // Excel (import / export des notes) : l'administration, les enseignants, et toute personne à qui une matière est confiée
                   peutExcel: role === "admin" || role === "enseignant" || (etat.mesMatieres || 0) > 0,
                   estComptable: role === "comptable", droitsFinance: droitsFinanceDe(etat.droitsFinance, role),
                   peutFinance: droitsFinanceDe(etat.droitsFinance, role).length > 0,
                   peutCourrier: ["admin", "surveillant", "comptable"].includes(role),
                   peutBulletins: ["admin", "surveillant", "comptable"].includes(role) }
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

/** Droits financiers : ceux renvoyés par le serveur, sinon les droits par défaut du rôle (ancienne base). */
function droitsFinanceDe(droits, role) {
  if (Array.isArray(droits)) return droits
  if (role === "admin") return ["caisse", "facturation", "depenses", "validation", "tresorerie", "paie", "rapports", "assistant"]
  if (role === "comptable") return ["caisse", "facturation", "depenses", "tresorerie", "rapports", "assistant"]
  return []
}

export const useSession = () => useContext(Contexte)
