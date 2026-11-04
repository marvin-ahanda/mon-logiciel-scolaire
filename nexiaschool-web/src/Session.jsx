import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { COLONNES_ETABLISSEMENT, COLONNES_PERSONNEL } from "./lib/colonnes.js"
import { adresseLogo } from "./lib/logo.js"
import { supabase, verifier } from "./supabase.js"

const Contexte = createContext(null)

export function SessionProvider({ children }) {
  const [etat, setEtat] = useState({ pret: false, session: null, profil: null, etablissement: null, exercice: null })

  const charger = useCallback(async (session) => {
    if (!session) return setEtat({ pret: true, session: null, profil: null, etablissement: null, exercice: null })
    try {
      const profil = verifier(await supabase.from("personnels").select(COLONNES_PERSONNEL).eq("id", session.user.id).maybeSingle())
      const google = session.user.app_metadata?.provider === "google"
      if (!profil && google) {
        // connecté avec Google mais sans établissement : il peut créer l'espace de son établissement
        return setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, sansEtablissement: true })
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
      setEtat({ pret: true, session, profil, etablissement, exercice, logoUrl })
    } catch (e) {
      console.error("NexIASchool : chargement du profil impossible", e)
      setEtat({ pret: true, session, profil: null, etablissement: null, exercice: null, erreur: e?.message || "erreur" })
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => charger(data.session))
    const { data } = supabase.auth.onAuthStateChange((evenement, session) => {
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
                   peutDiscipline: role === "admin" || role === "surveillant", peutNoter: role === "admin" || role === "enseignant" }
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export const useSession = () => useContext(Contexte)
