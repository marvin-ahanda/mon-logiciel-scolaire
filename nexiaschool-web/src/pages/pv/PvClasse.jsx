// PV de classe : notes obtenues par chaque élève dans chaque matière, pour une ou plusieurs périodes, sans calcul
// obligatoire des moyennes. Sélection fine (matières, élèves), contrôles de complétude, PDF / Excel / CSV numérotés.
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { chargerClasse, resultatsPeriode } from "../../lib/donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "../../lib/donneesDiscipline.js"
import { sequencesDePeriode } from "../../lib/discipline.js"
import { completude, pvClasse } from "../../lib/pv/moteur.js"
import { pvClassePdf } from "../../lib/pv/pdf.js"
import { feuillesPvClasse, telechargerCsv, telechargerExcel } from "../../lib/pv/export.js"
import { syntheseClasse, texteControle } from "../../lib/pv/textes.js"
import { comparerNoms, nomComplet, note, pourcentage } from "../../lib/format.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"
import { Barres, libelleSeuil, Tuiles } from "./Graphiques.jsx"
import { ChoixPeriode, classesFiltrees, Coches, Commentaire, contexteDocument, Controles, Filtres, Generation, nomFichierPv, useReferencePv } from "./Outils.jsx"

export function observation(l) {
  if (!l.presentes) return t("Aucune note")
  if (l.enDifficulte) return t("En difficulté")
  if (!l.echecs) return t("Toutes les notes atteignent le seuil")
  return t("{v0} note(s) sous le seuil", { v0: l.echecs })
}

export default function PvClasse() {
  const ref = useReferencePv()
  const { exercice } = useSession()
  const [params] = useSearchParams()
  const [filtres, setFiltres] = useState({ cycle: "", section: "", niveau: "" })
  const [classeId, setClasseId] = useState(params.get("classe") || "")
  const [codes, setCodes] = useState(() => new Set((params.get("periodes") || "").split(",").filter(Boolean)))
  const classes = classesFiltrees(ref.classes, filtres)
  const classe = ref.classes.find((c) => c.id === classeId)
  const [donnees, erreur] = useDonnees(async () => {
    if (!classe || !exercice) return null
    const d = await chargerClasse(classe, exercice)
    const discipline = await chargerDiscipline(d.eleves.map((e) => e.inscriptionId), exercice).catch(() => null)
    return { ...d, discipline }
  }, [classeId, exercice?.id])

  return (
    <section aria-labelledby="pv-classe-titre">
      <h2 className="h5" id="pv-classe-titre">{t("PV de classe")}</h2>
      <p className="text-muted small">{t("Notes obtenues par chaque élève dans chaque matière à la fin d'une ou plusieurs périodes. Les moyennes ne sont pas calculées, sauf si vous le demandez.")}</p>
      <div className="row g-2 mb-3">
        <Filtres valeur={filtres} onChange={setFiltres} />
        <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Classe")}</label>
          <select className="form-select form-select-sm" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">{t("Classe…")}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
      </div>
      <div className="mb-3" style={{ maxWidth: 760 }}>
        <Coches titre={t("Périodes")} elements={ref.periodes.map((p) => ({ id: p.code, libelle: p.libelle }))} choisis={codes} onChange={setCodes} hauteur={130} />
      </div>
      <Alerte>{erreur}</Alerte>
      {!classe && <p className="text-muted">{t("Choisissez une classe et au moins une période.")}</p>}
      {classe && donnees?.classe?.id !== classe.id && !erreur && <Chargement />}
      {classe && donnees?.classe?.id === classe.id && (codes.size
        ? <Apercu classe={classe} donnees={donnees} periodes={ref.periodes.filter((p) => codes.has(p.code))} key={classe.id} />
        : <p className="text-muted">{t("Cochez au moins une période.")}</p>)}
    </section>
  )
}

function Apercu({ classe, donnees, periodes }) {
  const ref = useReferencePv()
  const session = useSession()
  const [matieres, setMatieres] = useState(() => new Set(donnees.attributions.map((a) => a.id)))
  const [eleves, setEleves] = useState(() => new Set(donnees.eleves.map((e) => e.inscriptionId)))
  const [options, setOptions] = useState({ moyennes: false, incomplets: true, observations: false })
  const [commentaire, setCommentaire] = useState(""), [accepte, setAccepte] = useState(false)
  useEffect(() => setAccepte(false), [periodes.length, matieres, eleves, options.incomplets])

  const pv = useMemo(() => {
    const notes = new Map(), moyennes = new Map()
    for (const p of periodes) {
      for (const r of resultatsPeriode(donnees, p).resultats) {
        r.lignes.forEach((l) => notes.set(`${r.inscriptionId}|${l.attributionId}|${p.code}`, l.note))
        moyennes.set(`${r.inscriptionId}|${p.code}`, r.moyenne ?? r.moyenneNonClassee ?? null)
      }
    }
    const numeros = [...new Set(periodes.flatMap((p) => sequencesDePeriode(p, donnees.sequences).map((s) => s.numero)))]
    const bilans = donnees.discipline
      ? bilansPeriode(donnees.discipline, donnees.eleves.map((e) => e.inscriptionId), { type: "perso", numeros }, donnees.sequences) : new Map()
    return pvClasse({
      eleves: donnees.eleves.filter((e) => eleves.has(e.inscriptionId)), attributions: donnees.attributions.filter((a) => matieres.has(a.id)),
      periodes, notes, moyennes: options.moyennes ? moyennes : null, bilans, reglages: ref.reglages, incomplets: options.incomplets,
    })
  }, [donnees, periodes, matieres, eleves, options, ref.reglages])
  const controle = completude(pv)
  const g = pv.global
  const titre = `${t("PV de classe")} — ${classe.libelle}`
  const sousTitre = `${periodes.map((p) => p.libelle).join(", ")} · ${session.exercice?.libelle || ""}`
  const avertissements = controle.avertissements.map(texteControle)
  const plusieurs = periodes.length > 1

  async function produire({ format, reference, genereLe, ressources }) {
    const nom = nomFichierPv(t("pv-classe"), classe.libelle, periodes.map((p) => p.code).join("-"), reference)
    if (format === "xlsx") return telechargerExcel(feuillesPvClasse(pv, { titre: `${titre} · ${sousTitre} · ${reference}`, moyennes: options.moyennes, observationDe: options.observations ? observation : null }), nom)
    if (format === "csv") return telechargerCsv(feuillesPvClasse(pv, { titre: `${titre} · ${sousTitre} · ${reference}`, moyennes: options.moyennes, observationDe: options.observations ? observation : null }), nom)
    return pvClassePdf(pv, { ...contexteDocument(session, ref, { titre, sousTitre, reference, genereLe, ressources, commentaire }),
      moyennes: options.moyennes, observations: options.observations, observationDe: observation, avertissements }, nom)
  }

  return (
    <>
      <div className="row g-3 mb-3">
        <div className="col-md-6"><Coches titre={t("Matières")} elements={donnees.attributions.map((a) => ({ id: a.id, libelle: a.matiere }))} choisis={matieres} onChange={setMatieres} /></div>
        <div className="col-md-6"><Coches titre={t("Élèves")} elements={[...donnees.eleves].sort((a, b) => comparerNoms(nomComplet(a.eleve), nomComplet(b.eleve)))
          .map((e) => ({ id: e.inscriptionId, libelle: nomComplet(e.eleve) }))} choisis={eleves} onChange={setEleves} /></div>
      </div>
      <div className="d-flex flex-wrap gap-3 mb-3 small">
        {[["moyennes", t("Afficher aussi les moyennes")], ["incomplets", t("Inclure les élèves aux notes manquantes")], ["observations", t("Ajouter une colonne d'observations")]].map(([k, l]) => (
          <div className="form-check" key={k}><input className="form-check-input" type="checkbox" id={`pv-opt-${k}`} checked={options[k]}
            onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} /><label className="form-check-label" htmlFor={`pv-opt-${k}`}>{l}</label></div>))}
        <span className="text-muted">{libelleSeuil(pv.seuil)}</span>
      </div>
      <Controles controle={controle} accepte={accepte} onAccepter={setAccepte} />
      {!controle.bloquants.length && (
        <>
          <Tuiles elements={[
            { libelle: t("Élèves"), valeur: g.effectif },
            { libelle: t("Notes saisies"), valeur: `${g.notesPresentes}/${g.notesAttendues}`, aide: t("{v0} manquantes", { v0: pourcentage(g.tauxManquantes) }) },
            { libelle: t("Réussite"), valeur: pourcentage(g.tauxReussite), ton: "succes" },
            { libelle: t("Échec"), valeur: pourcentage(g.tauxEchec), ton: "danger" },
            { libelle: t("Élèves absents"), valeur: pourcentage(g.tauxAbsents), aide: t("{v0} h NJ · {v1} h J", { v0: g.heuresNJ, v1: g.heuresJ }) },
            { libelle: t("En difficulté"), valeur: pv.enDifficulte.length, ton: pv.enDifficulte.length ? "alerte" : "" },
          ]} />
          <div className="table-responsive mb-3 pv-tableau">
            <table className="table table-sm table-bordered align-middle small mb-0">
              <thead className="table-light"><tr><th>#</th><th>{t("Élève")}</th>
                {pv.colonnes.map((c) => <th key={`${c.attributionId}-${c.periode}`} className="text-center">{c.matiere}{plusieurs && <div className="fw-normal text-muted">{c.periodeLibelle}</div>}</th>)}
                {options.moyennes && periodes.map((p) => <th key={p.code} className="text-center">{t("Moy.")} {p.libelle}</th>)}
                <th className="text-center">{t("Échecs")}</th>{options.observations && <th>{t("Observation")}</th>}</tr></thead>
              <tbody>{pv.lignes.map((l, k) => (
                <tr key={l.inscriptionId} className={l.enDifficulte ? "table-warning" : ""}><td>{k + 1}</td><td className="text-nowrap">{nomComplet(l.eleve)}</td>
                  {l.notes.map((n, j) => <td key={j} className={`text-center ${n !== null && n < pv.seuil ? "text-danger fw-semibold" : ""}`}>{n === null ? "—" : note(n)}</td>)}
                  {options.moyennes && (l.moyennes || []).map((m, j) => <td key={`m${j}`} className="text-center fw-semibold">{m === null ? "—" : note(m)}</td>)}
                  <td className="text-center">{l.echecs}/{l.presentes}</td>{options.observations && <td>{observation(l)}</td>}</tr>))}
              </tbody>
            </table>
          </div>
          <div className="row g-3">
            <div className="col-lg-6"><Barres titre={t("Taux de réussite par matière")} seuil={50}
              elements={pv.matieres.map((m) => ({ libelle: plusieurs ? `${m.matiere} · ${m.periodeLibelle}` : m.matiere, valeur: m.tauxReussite }))} /></div>
            <div className="col-lg-6">
              <h3 className="h6">{t("Meilleures performances")}</h3>
              <ol className="small">{pv.meilleures.map((x, k) => <li key={k}>{nomComplet(x.eleve)} — {x.matiere}{plusieurs ? ` (${x.periode})` : ""} : <strong>{note(x.note)}</strong></li>)}</ol>
              <h3 className="h6">{t("Élèves en difficulté")}</h3>
              {pv.enDifficulte.length
                ? <ul className="small">{pv.enDifficulte.map((l) => <li key={l.inscriptionId}>{nomComplet(l.eleve)} — {t("{v0} note(s) sous le seuil sur {v1}", { v0: l.echecs, v1: l.presentes })}</li>)}</ul>
                : <p className="small text-muted">{t("Aucun élève en difficulté selon les seuils de l'établissement.")}</p>}
            </div>
          </div>
          <div className="pv-synthese mb-3"><h3 className="h6">{t("Synthèse")}</h3><ul className="small mb-0">{syntheseClasse(pv).map((s, k) => <li key={k}>{s}</li>)}</ul></div>
          <Commentaire valeur={commentaire} onChange={setCommentaire} />
          <Generation desactive={controle.partiel && !accepte} produire={produire}
            document={{ type: "classe", titre: `${titre} · ${sousTitre}`, commentaire, partiel: controle.partiel, avertissements,
              perimetre: { classe_id: classe.id, classe: classe.libelle, periodes: periodes.map((p) => p.code), matieres: matieres.size, eleves: eleves.size, options } }} />
        </>)}
    </>
  )
}
