// Consultation des emplois du temps publiés, pour tout le personnel (lecture seule, utilisable sur téléphone).
// Un enseignant présent dans l'emploi du temps voit d'abord le sien.
import { useEffect, useMemo, useState } from "react"
import { t } from "../../i18n.jsx"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { completerConfig } from "../../lib/edt/modele.js"
import { libellePeriode } from "../../lib/edt/vues.js"
import Visionneuse from "./Visionneuse.jsx"
import "./edt.css"

export default function Consultation() {
  const { exercice, etablissement, profil } = useSession()
  const [liste, erreur] = useDonnees(async () => (exercice ? (await rpc("edt_versions", { p_exercice: exercice.id })).filter((v) => v.publie) : []), [exercice?.id])
  const [id, setId] = useState(null), [version, setVersion] = useState(null), [err, setErr] = useState("")
  useEffect(() => { if (liste?.length && !id) setId(liste[0].id) }, [liste, id])
  useEffect(() => {
    if (!id) return
    let actif = true
    setVersion(null)
    rpc("edt_lire", { p_id: id }).then((v) => actif && setVersion(v)).catch((e) => actif && setErr(e.message))
    return () => { actif = false }
  }, [id])
  const cfg = useMemo(() => (version ? completerConfig(version.config) : null), [version])
  const moi = cfg?.enseignants.find((e) => e.personnel_id === profil?.id)

  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  return (
    <>
      <h1 className="h3 mb-3">{t("Emploi du temps")}</h1>
      {!liste.length ? <div className="alert alert-info">{t("Aucun emploi du temps n'a encore été publié par l'administration pour cette année scolaire.")}</div> : <>
        {liste.length > 1 && <div className="mb-3"><label className="form-label small" htmlFor="c-ver">{t("Période")}</label>
          <select className="form-select form-select-sm w-auto" id="c-ver" value={id || ""} onChange={(e) => setId(e.target.value)}>
            {liste.map((v) => <option key={v.id} value={v.id}>{libellePeriode(v.periode)} — {v.nom}</option>)}</select></div>}
        <Alerte>{err}</Alerte>
        {!version ? <Chargement /> : <Visionneuse key={version.id} cfg={cfg} grille={version.grille}
          initial={moi ? { mode: "enseignant", enseignant: moi.cle } : undefined}
          entete={{ etablissement: etablissement.nom, annee: version.exercice, periode: version.periode, version: version.nom }} />}
      </>}
    </>
  )
}
