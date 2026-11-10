import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { COLONNES_ETABLISSEMENT, COLONNES_PERSONNEL } from "./lib/colonnes.js"
import { adresseLogo } from "./lib/logo.js"
import { sessionLocale, supabase, verifier } from "./supabase.js"

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
      if (!profil && google) {
        // connecté avec Google mais sans établissement : il peut créer l'espace de son établissement
        return setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, sansEtablissement: true, proprietaire })
      }
      if (!profil || !profil.actif) {
        await supabase.auth.signOut()
        return setEtat({ pret: true, session: null, profil: null, etablissement: null, exercice: null })
      }
      const etablissement = verifier(await supabase.from("etablissements").select(COLONNES_ETABLISSEMENT).eq("id", profil.etablissement_id).single())
      const [exercice, logoUrl] = await Promise.all([
        supabase.from("exercices").select("*").eq("actif", true).maybeSingle().then(verifier),
        adresseLogo(etablissement.logo),
      ])
      const mesMatieres = await compterMesMatieres(profil, exercice)
      setEtat({ pret: true, session, profil, etablissement, exercice, logoUrl, proprietaire, mesMatieres })
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
  const valeur = { ...etat, recharger, estAdmin: role === "admin", estEnseignant: role === "enseignant", estSurveillant: role === "surveillant",
                   peutDiscipline: role === "admin" || role === "surveillant",
                   // rubrique Notes (saisie, résultats, bulletins selon le rôle) : tout le personnel ; chacun ne saisit que les matières qui lui sont confiées
                   peutNoter: ["admin", "enseignant", "surveillant", "comptable"].includes(role),
                   // Excel (import / export des notes) : l'administration, les enseignants, et toute personne à qui une matière est confiée
                   peutExcel: role === "admin" || role === "enseignant" || (etat.mesMatieres || 0) > 0,
                   estComptable: role === "comptable", peutFinance: role === "admin" || role === "comptable",
                   peutCourrier: ["admin", "surveillant", "comptable"].includes(role),
                   peutBulletins: ["admin", "surveillant", "comptable"].includes(role) }
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export const useSession = () => useContext(Contexte)
