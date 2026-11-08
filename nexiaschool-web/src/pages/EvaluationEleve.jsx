// Page publique d'une évaluation SmartEval : ouverte par le lien que l'enseignant envoie aux élèves (groupe WhatsApp…).
import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { Chargement } from "../composants/Communs.jsx"
import FormulaireEvaluation from "../composants/FormulaireEvaluation.jsx"
import { dateHeure } from "../lib/format.js"
import { rpc } from "../supabase.js"
import { ChoixLangue, t, traduireErreur } from "../i18n.jsx"

function Cadre({ children }) {
  return (
    <div className="se-page">
      <div className="se-colonne">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="small text-muted d-flex align-items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="22" height="22" className="rounded-1" />{t("SmartEval · NexIA School")}</span>
          <ChoixLangue />
        </div>
        {children}
      </div>
    </div>
  )
}

export default function EvaluationEleve() {
  const { jeton = "" } = useParams()
  const [etat, setEtat] = useState({ chargement: true })
  useEffect(() => {
    rpc("smarteval_formulaire", { p_jeton: jeton }).then((ev) => setEtat({ ev })).catch(() => setEtat({ erreur: true }))
  }, [jeton])
  useEffect(() => { if (etat.ev?.titre) document.title = `${etat.ev.titre} — SmartEval` }, [etat.ev])

  if (etat.chargement) return <Cadre><Chargement /></Cadre>
  if (etat.erreur) return <Cadre><div className="se-carte"><div className="alert alert-warning mb-0">{t("Connexion impossible pour le moment. Vérifiez votre connexion Internet puis rechargez la page.")}</div></div></Cadre>
  const ev = etat.ev
  if (!ev) return <Cadre><div className="se-carte se-introuvable"><h1 className="h5">{t("Lien invalide")}</h1><p className="mb-0">{t("Cette évaluation n'existe pas ou n'est plus disponible. Vérifiez le lien envoyé par votre enseignant.")}</p></div></Cadre>
  if (ev.statut !== "ouverte") return (
    <Cadre><div className="se-carte se-close"><h1 className="h5">{ev.titre}</h1>
      <p className="mb-0">{ev.statut === "close" ? t("Cette évaluation est close depuis le {v0} : les réponses ne sont plus acceptées.", { v0: dateHeure(ev.ferme_le) })
                                                 : t("Cette évaluation n'est pas encore ouverte.")}</p></div></Cadre>)
  return (
    <Cadre>
      <FormulaireEvaluation evaluation={ev} mode="eleve" brouillon={`smarteval-brouillon:${jeton}`}
        onEnvoyer={async (identite, reponses) => {
          try { return await rpc("smarteval_soumettre", { p_jeton: jeton, p: { ...identite, reponses } }) }
          catch (e) { throw new Error(traduireErreur(e.message)) }
        }} />
      <p className="small text-muted text-center mb-4">{t("Ouvert jusqu'au {v0}", { v0: dateHeure(ev.ferme_le) })}</p>
    </Cadre>
  )
}
