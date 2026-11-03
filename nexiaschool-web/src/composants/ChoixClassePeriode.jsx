import { useSearchParams } from "react-router-dom"
import { Chargement, useDonnees } from "./Communs.jsx"
import { periodes } from "../lib/periodes.js"
import { useSession } from "../Session.jsx"
import { supabase, verifier } from "../supabase.js"

/** Choix de la classe et de la période (gardés dans l'adresse) ; rend children(classe, periode). */
export default function ChoixClassePeriode({ children }) {
  const { exercice, estAdmin, profil } = useSession()
  const [params, setParams] = useSearchParams()
  const [ref] = useDonnees(async () => {
    let classes = verifier(await supabase.from("classes").select("*").order("ordre").order("libelle"))
    if (!estAdmin) {   // un enseignant ne voit que les classes où il intervient
      const a = verifier(await supabase.from("attributions").select("classe_id").eq("exercice_id", exercice.id).eq("enseignant_id", profil.id))
      const siennes = new Set(a.map((x) => x.classe_id))
      classes = classes.filter((c) => siennes.has(c.id))
    }
    const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero"))
    return { classes, periodes: periodes(sequences) }
  }, [exercice?.id])

  if (!exercice) return <div className="alert alert-warning">Aucun exercice actif.</div>
  if (!ref) return <Chargement />
  const classe = ref.classes.find((c) => c.id === params.get("classe"))
  const periode = ref.periodes.find((p) => p.code === params.get("periode"))
  const choisir = (k, v) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p) }
  return (
    <>
      <div className="row g-2 mb-3 no-print" style={{ maxWidth: 700 }}>
        <div className="col-sm-6"><select className="form-select" value={classe?.id || ""} onChange={(e) => choisir("classe", e.target.value)} aria-label="Classe">
          <option value="">Classe…</option>{ref.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-sm-6"><select className="form-select" value={periode?.code || ""} onChange={(e) => choisir("periode", e.target.value)} aria-label="Période">
          <option value="">Période…</option>{ref.periodes.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></div>
      </div>
      {!ref.classes.length && <p className="text-muted">Aucune classe disponible.</p>}
      {classe && periode && children(classe, periode)}
    </>
  )
}
