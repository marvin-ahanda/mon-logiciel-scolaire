import { useEffect, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { appreciation } from "../lib/calculs.js"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "../lib/donneesDiscipline.js"
import { date, nomComplet, note } from "../lib/format.js"
import { nomDeFichier, telechargerBulletinsPdf } from "../lib/bulletinPdf.js"
import { siteAffiche } from "../lib/logo.js"
import { adressesPhotos } from "../lib/photos.js"
import { useSession } from "../Session.jsx"
import { t } from "../i18n.jsx"

function Bulletin({ r, donnees, periode, stats, etablissement, logo, exercice, photo, conduite, onPdf, enCours }) {
  const e = r.eleve
  return (
    <section className="bulletin card mb-4">
      <div className="card-body position-relative">
        <button type="button" className="btn btn-sm btn-outline-secondary bouton-pdf-eleve no-print" onClick={onPdf} disabled={!!enCours}
                title={t("Télécharger le bulletin de {v0} en PDF", {
                  v0: nomComplet(e)
                })}>{enCours === r.inscriptionId ? "PDF…" : "PDF"}</button>
        <header className="entete-bulletin">
          <div><div className="fw-bold">{etablissement.nom}</div>
            <div className="small">{[etablissement.adresse, etablissement.ville, etablissement.telephone, siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")}</div>
            {etablissement.devise && <div className="small fst-italic">{etablissement.devise}</div>}</div>
          <div className="text-center">{logo && <img src={logo} alt={`Logo ${etablissement.nom}`} className="logo-bulletin" />}</div>
          <div className="text-end small">{t("Année scolaire ")}{exercice.libelle}<br /><strong>{t("Bulletin — ")}{periode.libelle}</strong></div>
        </header>
        <div className="d-flex gap-3 align-items-center border rounded p-2 mb-2">
          {photo ? <img src={photo} alt="" className="photo-bulletin" /> : <div className="photo-bulletin vide" />}
          <div className="small flex-grow-1 row g-1">
            <div className="col-sm-6"><strong>{nomComplet(e)}</strong></div><div className="col-sm-6">{t("Matricule : ")}{e.matricule}</div>
            <div className="col-sm-6">{t("Né(e) le ")}{date(e.date_naissance)}{e.lieu_naissance && ` à ${e.lieu_naissance}`}</div>
            <div className="col-sm-6">{t("Classe : ")}{donnees.classe.libelle}{t(" · Effectif : ")}{stats.effectif}</div>
          </div>
        </div>
        <table className="table table-sm table-bordered mb-2 tableau-bulletin">
          <thead><tr><th>{t("Matière")}</th><th>{t("Enseignant")}</th><th className="text-end">{t("Note")}</th><th className="text-end">{t("Coef.")}</th>
            <th className="text-end">{t("Points")}</th><th className="text-end">{t("Rang")}</th><th>{t("Appréciation")}</th></tr></thead>
          <tbody>{r.groupes.map((g) => [
            ...g.lignes.map((l) => (
              <tr key={l.attributionId}><td>{l.matiere}</td><td className="small">{l.enseignant}</td>
                <td className="text-end">{note(l.note)}</td><td className="text-end">{l.coefficient}</td><td className="text-end">{note(l.points)}</td>
                <td className="text-end">{l.rang ? `${l.rang}${l.exAequo ? t(" ex") : ""}` : ""}</td><td>{t(appreciation(l.note))}</td></tr>)),
            r.groupes.length > 1 && <tr key={`g${g.groupe}`} className="table-light small"><td colSpan={3}>{t("Groupe ")}{g.groupe}</td><td className="text-end">{g.totalCoef}</td>
              <td className="text-end">{note(g.totalPoints)}</td><td colSpan={2}>{t("Moyenne : ")}{note(g.moyenne) || "—"}</td></tr>,
          ])}</tbody>
          <tfoot><tr className="fw-semibold"><td colSpan={3}>{t("Total")}</td><td className="text-end">{r.totalCoef}</td><td className="text-end">{note(r.totalPoints)}</td><td colSpan={2} /></tr></tfoot>
        </table>
        {conduite && <div className="small border rounded p-2 mb-2">{t("Conduite : absences non justifiées ")}<strong>{conduite.nj}{t(" h")}</strong>{t(", justifiées ")}{conduite.j}{t(" h · retards ")}<strong>{conduite.retards}</strong>{conduite.incidents.length > 0 && <>{t(" · sanctions : ")}{conduite.incidents.join(", ")}</>}{t(" · note de discipline ")}<strong>{note(conduite.note)}</strong> ({t(conduite.appreciation)})</div>}
        <div className="row g-2 small">
          <div className="col-sm-4 border rounded p-2"><div>{t("Moyenne : ")}<strong className="fs-6">{r.moyenne !== null ? note(r.moyenne) : r.moyenneNonClassee !== null ? `${note(r.moyenneNonClassee)} (NC)` : "NC"}</strong></div>
            <div>{t("Rang : ")}<strong>{r.rang ? `${r.rang}${r.exAequo ? t(" ex") : ""} / ${stats.classes}` : t("non classé")}</strong></div>
            <div>{t("Appréciation : ")}<strong>{t(r.appreciation || "—")}</strong></div></div>
          <div className="col-sm-4 border rounded p-2"><div>{t("Moyenne de la classe : ")}{note(stats.moyenneClasse) || "—"}</div>
            <div>{t("Plus forte : ")}{note(stats.max) || "—"}{t(" · Plus faible : ")}{note(stats.min) || "—"}</div>
            <div>{t("Taux de réussite : ")}{stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`}</div></div>
          <div className="col-sm-4 border rounded p-2 signature">{t("Le chef d'établissement")}<br /><span className="text-muted">{etablissement.nom_chef}</span></div>
        </div>
      </div>
    </section>
  );
}

function Bulletins({ classe, periode }) {
  const { exercice, etablissement, logoUrl } = useSession()
  const [donnees, erreur] = useDonnees(async () => {
    const d = await chargerClasse(classe, exercice)
    const [photos, discipline] = await Promise.all([adressesPhotos(d.eleves.map((x) => x.eleve.photo)), chargerDiscipline(d.eleves.map((x) => x.inscriptionId), exercice)])
    return { ...d, photos, discipline }
  }, [classe.id])
  const [pdf, setPdf] = useState(null), [erreurPdf, setErreurPdf] = useState("")      // pdf : "classe" ou inscriptionId en cours
  const titre = t("Bulletins {v0} {v1} {v2}", { v0: classe.libelle, v1: periode.libelle, v2: exercice.libelle })

  // Impression : marges de page nulles (le navigateur n'ajoute alors ni adresse, ni date, ni numéro de page) ;
  // les marges sont reportées dans chaque bulletin. Le titre du document sert de nom au PDF « Enregistrer au format PDF ».
  useEffect(() => {
    const style = document.createElement("style")
    style.textContent = "@media print { @page { size: A4; margin: 0; } }"
    document.head.appendChild(style)
    const avant = document.title
    document.title = titre
    return () => { style.remove(); document.title = avant }
  }, [titre])

  if (!donnees) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const { resultats, stats } = resultatsPeriode(donnees, periode)
  const conduite = bilansPeriode(donnees.discipline, donnees.eleves.map((x) => x.inscriptionId), periode, donnees.sequences)

  async function exporter(liste, cle, nom) {
    setErreurPdf(""); setPdf(cle)
    try {
      await telechargerBulletinsPdf({ etablissement, logoUrl, exercice, periode, classe: donnees.classe, stats,
        eleves: liste.map((r) => ({ r, photoUrl: donnees.photos[r.eleve.photo], conduite: conduite.get(r.inscriptionId) })) }, nom)
    } catch (e) { setErreurPdf(t("Création du PDF impossible : {v0}", {
      v0: e.message
    })) } finally { setPdf(null) }
  }
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 no-print">
        <span>{resultats.length}{t(" bulletin(s) — ")}{classe.libelle}, {periode.libelle}</span>
        {resultats.length > 0 && <div className="d-flex flex-wrap gap-2">
          <button className="btn btn-primary btn-sm" disabled={!!pdf} onClick={() => exporter(resultats, "classe", nomDeFichier(t("bulletins"), classe.libelle, periode.libelle, exercice.libelle))}>
            {pdf === "classe" ? <><span className="spinner-border spinner-border-sm me-1" />{t("Préparation du PDF…")}</> : t("Télécharger en PDF")}</button>
          <button className="btn btn-outline-primary btn-sm" onClick={() => window.print()}>{t("Imprimer")}</button>
        </div>}
      </div>
      <Alerte onFermer={() => setErreurPdf("")}>{erreurPdf}</Alerte>
      {resultats.map((r) => <Bulletin key={r.inscriptionId} r={r} donnees={donnees} periode={periode} stats={stats}
                                      etablissement={etablissement} logo={logoUrl} exercice={exercice} photo={donnees.photos[r.eleve.photo]}
                                      conduite={conduite.get(r.inscriptionId)} enCours={pdf}
                                      onPdf={() => exporter([r], r.inscriptionId, nomDeFichier(t("bulletin"), nomComplet(r.eleve), classe.libelle, periode.libelle, exercice.libelle))} />)}
      {!resultats.length && <p className="text-muted">{t("Aucun élève inscrit.")}</p>}
    </>
  );
}

export default function PageBulletins() {
  return (
    <><h1 className="h3 mb-3 no-print">{t("Bulletins")}</h1>
      <ChoixClassePeriode>{(classe, periode) => <Bulletins key={classe.id + periode.code} classe={classe} periode={periode} />}</ChoixClassePeriode></>
  );
}
