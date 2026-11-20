// Affichage d'un PV de performances individuelles (administration, enseignants et espace parents). Le contenu est la
// copie autonome produite par le moteur : il ne contient que les données de l'élève et des moyennes de groupe.
import { note } from "../../lib/format.js"
import { syntheseIndividuelle, texteRecommandation } from "../../lib/pv/textes.js"
import { t } from "../../i18n.jsx"
import { Courbes, Tuiles } from "./Graphiques.jsx"

const n2 = (v) => (v === null || v === undefined ? "—" : note(v))
const signe = (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${note(v)}`)
const present = (v) => v !== null && v !== undefined

export default function PvIndividuelVue({ c }) {
  const avecCycle = c.matieres.some((m) => present(m.moyenneCycle))
  const alertes = [...(c.alerteGenerale ? [t("Baisse de la moyenne générale : {v0} point(s).", { v0: note(c.variationGenerale) })] : []),
    ...c.alertes.map((a) => t("Baisse en {v0} : {v1} point(s).", { v0: a.matiere, v1: note(a.variation) }))]
  return (
    <article className="pv-individuel">
      <header className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-2">
        <div><h3 className="h5 mb-0">{[c.eleve.nom?.toUpperCase(), c.eleve.prenom].filter(Boolean).join(" ")}</h3>
          <div className="small text-muted">{[c.eleve.matricule, c.classe, c.periode?.libelle, c.annee].filter(Boolean).join(" · ")}</div></div>
      </header>
      <Tuiles elements={[
        { libelle: t("Moyenne"), valeur: n2(c.moyenne), ton: present(c.moyenne) && c.moyenne < c.seuil ? "danger" : "succes" },
        { libelle: t("Moyenne de la classe"), valeur: n2(c.moyenneClasse) },
        present(c.moyenneCycle) ? { libelle: t("Moyenne du cycle"), valeur: n2(c.moyenneCycle) } : null,
        { libelle: t("Évolution"), valeur: signe(c.variationGenerale), ton: c.alerteGenerale ? "danger" : "", aide: present(c.moyennePrecedente) ? t("avant : {v0}", { v0: note(c.moyennePrecedente) }) : null },
        { libelle: t("Absences"), valeur: `${c.absences.nj} h`, aide: t("non justifiées · {v0} h justifiées", { v0: c.absences.j }) },
        { libelle: t("Retards"), valeur: c.absences.retards },
      ]} />
      <div className="table-responsive mb-3"><table className="table table-sm small align-middle">
        <thead className="table-light"><tr><th>{t("Matière")}</th>{(c.entetes || []).map((e) => <th key={e} className="text-center">{e}</th>)}
          <th className="text-center">{t("Note")}</th><th className="text-center">{t("Moy. classe")}</th>{avecCycle && <th className="text-center">{t("Moy. cycle")}</th>}
          <th className="text-center">{t("Écart")}</th><th className="text-center">{t("Évolution")}</th></tr></thead>
        <tbody>{c.matieres.map((m) => (
          <tr key={m.matiere}><td>{m.matiere}{m.enseignant && <div className="text-muted" style={{ fontSize: ".75em" }}>{m.enseignant}</div>}</td>
            {(m.details || []).map((d, k) => <td key={k} className="text-center text-muted">{n2(d)}</td>)}
            <td className={`text-center fw-semibold ${present(m.note) && m.note < c.seuil ? "text-danger" : ""}`}>{n2(m.note)}</td>
            <td className="text-center">{n2(m.moyenneClasse)}</td>{avecCycle && <td className="text-center">{n2(m.moyenneCycle)}</td>}
            <td className={`text-center ${m.ecartClasse > 0 ? "text-success" : m.ecartClasse < 0 ? "text-danger" : ""}`}>{signe(m.ecartClasse)}</td>
            <td className="text-center">{m.tendance === "hausse" ? <span className="text-success" aria-label={t("En progression")}>↗ {signe(m.variation)}</span>
              : m.tendance === "baisse" ? <span className="text-danger" aria-label={t("En baisse")}>↘ {signe(m.variation)}</span>
                : m.tendance === "stable" ? "=" : "—"}</td></tr>))}
        </tbody></table></div>
      {c.evolution?.length > 1 && (
        <Courbes titre={t("Évolution des performances")} libelles={c.evolution.map((p) => p.libelle)} series={[
          { nom: t("Élève"), valeurs: c.evolution.map((p) => p.eleve) },
          { nom: t("Moyenne de la classe"), valeurs: c.evolution.map((p) => p.classe) },
          ...(c.evolution.some((p) => present(p.cycle)) ? [{ nom: t("Moyenne du cycle"), valeurs: c.evolution.map((p) => p.cycle ?? null) }] : []),
        ]} />)}
      <div className="row g-3">
        <div className="col-md-6"><h4 className="h6">{t("Synthèse")}</h4><ul className="small">{syntheseIndividuelle(c).map((s, k) => <li key={k}>{s}</li>)}</ul></div>
        <div className="col-md-6">
          {alertes.length > 0 && <div className="alert alert-warning small py-2"><strong>{t("Alertes")}</strong><ul className="mb-0">{alertes.map((a, k) => <li key={k}>{a}</li>)}</ul></div>}
          {c.recommandations.length > 0 && <><h4 className="h6">{t("Recommandations et actions de suivi")}</h4>
            <ul className="small">{c.recommandations.map((r, k) => <li key={k}>{texteRecommandation(r)}</li>)}</ul></>}
          {c.decision && <p className="small"><strong>{t("Décision :")}</strong> {c.decision}</p>}
          {c.paiement && <p className="small"><strong>{t("Situation financière :")}</strong> {c.paiement.en_regle ? t("à jour") : t("non à jour")}</p>}
        </div>
      </div>
      {(c.commentaires || []).map((x, k) => (
        <blockquote key={k} className="pv-commentaire small mb-2"><p className="mb-1">{x.texte}</p>
          <footer className="text-muted">— {x.auteur}{x.fonction ? `, ${t(x.fonction)}` : ""}</footer></blockquote>))}
    </article>
  )
}
