import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import ChoixClassePeriode from "../composants/ChoixClassePeriode.jsx"
import { appreciation, competence } from "../lib/calculs.js"
import { decisionProposee, sanctionsParEleve } from "../lib/decisions.js"
import { sequencesDePeriode } from "../lib/discipline.js"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { bilansPeriode, chargerDiscipline } from "../lib/donneesDiscipline.js"
import { date, nomComplet, note } from "../lib/format.js"
import { image, nomDeFichier, telechargerBulletinsPdf } from "../lib/bulletinPdf.js"
import { emettreBulletins, filigrane as faireFiligrane, matriceQr, sitePlateforme, urlVerification } from "../lib/bulletinVerif.js"
import { siteAffiche } from "../lib/logo.js"
import { adressesPhotos } from "../lib/photos.js"
import { useSession } from "../Session.jsx"
import { supabase, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const TITRES = { sequence: "BULLETIN DE NOTES SÉQUENTIEL", trimestre: "BULLETIN DE NOTES TRIMESTRIEL", annee: "BULLETIN DE NOTES ANNUEL" }
const COLONNE_NOTE = { sequence: "Note /20", trimestre: "Note trim.", annee: "Note ann." }
const rangTexte = (rg, ex) => (rg ? `${rg}${ex ? t(" ex") : ""}` : "")
const ne = (v) => (v === null || v === undefined ? "NE" : note(v))

/** QR code vectoriel (SVG) : net à l'écran comme à l'impression. */
export function QrCode({ texte, className, titre }) {
  const m = matriceQr(texte), n = m.length, q = 2
  const d = m.flatMap((ligne, y) => ligne.map((noir, x) => (noir ? `M${x + q} ${y + q}h1v1h-1z` : ""))).join("")
  return <svg className={className} viewBox={`0 0 ${n + 2 * q} ${n + 2 * q}`} role="img" aria-label={titre} shapeRendering="crispEdges">
    <title>{titre}</title><rect width="100%" height="100%" fill="#fff" /><path d={d} fill="#000" /></svg>
}

function Bulletin({ r, donnees, periode, stats, entetes, etablissement, logo, filigrane, exercice, photo, conduite, decision, code, onPdf, enCours }) {
  const e = r.eleve, nd = entetes.length
  const moy = r.moyenne !== null ? `${note(r.moyenne)} / 20` : r.moyenneNonClassee !== null ? `${note(r.moyenneNonClassee)} / 20 (NC)` : "NC"
  return (
    <section className="bulletin card mb-4">
      <div className="card-body position-relative feuille-bulletin">
        {filigrane && <img src={filigrane} alt="" aria-hidden="true" className="filigrane-bulletin" />}
        <button type="button" className="btn btn-sm btn-outline-secondary bouton-pdf-eleve no-print" onClick={onPdf} disabled={!!enCours}
                title={t("Télécharger le bulletin de {v0} en PDF", { v0: nomComplet(e) })}>{enCours === r.inscriptionId ? "PDF…" : "PDF"}</button>
        <header className="entete-bulletin">
          <div><div className="fw-bold">{etablissement.nom}</div>
            {etablissement.devise && <div className="small fst-italic">{etablissement.devise}</div>}
            <div className="small">{[etablissement.adresse, etablissement.ville, etablissement.telephone && `${t("Tél.")} ${etablissement.telephone}`, siteAffiche(etablissement.site_web)].filter(Boolean).join(" · ")}</div></div>
          <div className="text-center">{logo && <img src={logo} alt={`Logo ${etablissement.nom}`} className="logo-bulletin" />}</div>
          <div className="text-end small">{t("Année scolaire ")}<strong>{exercice.libelle}</strong><br />{periode.libelle}</div>
        </header>
        <h2 className="titre-bulletin">{t(TITRES[periode.type])}</h2>
        <table className="table table-sm table-bordered mb-2 tableau-bulletin identite-bulletin"><tbody>
          <tr><td rowSpan={2} className="cellule-photo">{photo ? <img src={photo} alt="" className="photo-bulletin" /> : <div className="photo-bulletin vide" />}</td>
            <td>{t("Nom et prénom : ")}<strong>{nomComplet(e)}</strong></td><td>{t("Matricule : ")}<strong>{e.matricule}</strong></td><td>{t("Sexe : ")}{e.sexe || "—"}</td></tr>
          <tr><td>{t("Né(e) le : ")}{date(e.date_naissance) || "—"}{e.lieu_naissance && t(" à {v0}", { v0: e.lieu_naissance })}</td>
            <td>{t("Classe : ")}<strong>{donnees.classe.libelle}</strong></td><td>{t("Effectif : ")}{stats.effectif}</td></tr>
        </tbody></table>
        <div className="site-plateforme">{t("Bulletin généré par NexIA School · {v0}", { v0: sitePlateforme() })}</div>
        <table className="table table-sm table-bordered mb-2 tableau-bulletin">
          <thead><tr><th>{t("Matière et enseignant")}</th>{entetes.map((x) => <th key={x} className="text-center">{x}</th>)}
            <th className="text-center">{t(COLONNE_NOTE[periode.type])}</th><th className="text-center">{t("Coef.")}</th>
            <th className="text-center">{t("Note × coef.")}</th><th className="text-center">{t("Rang")}</th><th>{t("Appréciation")}</th><th>{t("Compétence")}</th></tr></thead>
          <tbody>{r.groupes.map((g) => [
            ...g.lignes.map((l) => (
              <tr key={l.attributionId}><td>{l.matiere}{l.enseignant && <div className="enseignant-bulletin">{l.enseignant}</div>}</td>
                {l.details.map((d, k) => <td key={k} className="text-end">{d === null ? "—" : note(d)}</td>)}
                <td className="text-end fw-bold">{ne(l.note)}</td><td className="text-end">{l.coefficient}</td><td className="text-end">{note(l.points)}</td>
                <td className="text-end">{rangTexte(l.rang, l.exAequo)}</td><td>{t(appreciation(l.note))}</td><td>{t(competence(l.note))}</td></tr>)),
            r.groupes.length > 1 && <tr key={`g${g.groupe}`} className="ligne-groupe"><td colSpan={nd + 2}>{t("Groupe ")}{g.groupe}</td><td className="text-end">{g.totalCoef}</td>
              <td className="text-end">{note(g.totalPoints)}</td><td colSpan={3}>{t("Moyenne du groupe : ")}<strong>{note(g.moyenne) || "—"}</strong></td></tr>,
          ])}
            <tr className="ligne-groupe fw-bold"><td colSpan={nd + 2}>{t("TOTAL")}</td><td className="text-end">{r.totalCoef}</td><td className="text-end">{note(r.totalPoints)}</td><td colSpan={3} /></tr></tbody>
        </table>
        <table className="table table-sm table-bordered mb-2 tableau-bulletin"><tbody>
          <tr><td>{t("Moyenne : ")}<strong>{moy}</strong></td><td>{t("Rang : ")}<strong>{r.rang ? rangTexte(r.rang, r.exAequo) : t("non classé")}</strong>{r.rang ? ` / ${stats.classes}` : ""}</td>
            <td>{t("Appréciation : ")}<strong>{t(r.appreciation || "—")}</strong></td></tr>
          <tr><td>{t("Moyenne de la classe : ")}{note(stats.moyenneClasse) || "—"}</td>
            <td>{t("Plus forte : ")}{note(stats.max) || "—"}{t(" · plus faible : ")}{note(stats.min) || "—"}</td>
            <td>{t("Taux de réussite : ")}{stats.tauxReussite === null ? "—" : `${note(stats.tauxReussite)} %`}</td></tr>
          {periode.type === "annee" && <tr><td colSpan={2}>{t("Moyennes trimestrielles : ")}{(r.moyennesTrimestres || []).map((m, k) => <span key={k}>{k > 0 && " · "}T{k + 1} : <strong>{m === null ? "—" : note(m)}</strong></span>)}</td>
            <td>{t("Décision proposée : ")}<strong className="decision-proposee">{decision ? t(decision.libelle) : "—"}</strong></td></tr>}
          {periode.type === "trimestre" && decision && <tr><td colSpan={3}>{t("Décision proposée : ")}<strong className="decision-proposee">{t(decision.libelle)}</strong></td></tr>}
        </tbody></table>
        {conduite && <table className="table table-sm table-bordered mb-2 tableau-bulletin text-center"><tbody>
          <tr><th colSpan={4}>{t("Discipline")}</th><th colSpan={3}>{t("Points perdus")}</th><th rowSpan={2} className="align-middle">{t("Note de discipline")}</th></tr>
          <tr><th>{t("Abs. non justifiées")}</th><th>{t("Abs. justifiées")}</th><th>{t("Retards")}</th><th>{t("Autres cas")}</th><th>{t("Ponctualité")}</th><th>{t("Assiduité")}</th><th>{t("Autres cas")}</th></tr>
          <tr><td>{conduite.nj} h</td><td>{conduite.j} h</td><td>{conduite.retards}</td><td>{conduite.incidents.join(", ") || "—"}</td>
            <td>{perdus(conduite.pointsPonctualite)}</td><td>{perdus(conduite.pointsAssiduite)}</td><td>{perdus(conduite.pointsAutres)}</td>
            <td><strong>{note(conduite.note)} / 20</strong> · {t(conduite.appreciation)}</td></tr>
        </tbody></table>}
        <table className="table table-bordered mb-1 tableau-bulletin visas-bulletin"><tbody>
          <tr><th>{t("Visa du parent")}</th><th>{t("Professeur principal")}</th>
            <th>{t("Le chef d'établissement")}{etablissement.nom_chef && <div className="fw-normal">{etablissement.nom_chef}</div>}</th></tr>
          <tr><td /><td /><td /></tr>
        </tbody></table>
        <div className="pied-bulletin">
          <p className="small mb-0">{t("NE : non évalué · NC : non classé.")}{periode.type === "trimestre" && t(" Note du trimestre = moyenne des notes séquentielles du trimestre.")}
            {periode.type === "annee" && t(" Note annuelle = moyenne des notes trimestrielles.")}</p>
          {code && <div className="qr-bulletin"><QrCode texte={urlVerification(code)} className="qr-code" titre={t("QR code de vérification du bulletin")} />
            <div>{t("Bulletin authentique ?")}<br />{t("Scannez pour vérifier.")}<br /><span className="code-bulletin">{code}</span></div></div>}
        </div>
      </div>
    </section>
  );
}

const perdus = (v) => (v ? `−${note(v)}` : "0")

function Bulletins({ classe, periode }) {
  const { exercice, etablissement, logoUrl } = useSession()
  const [donnees, erreur] = useDonnees(async () => {
    const d = await chargerClasse(classe, exercice)
    const [photos, discipline, criteres] = await Promise.all([adressesPhotos(d.eleves.map((x) => x.eleve.photo)), chargerDiscipline(d.eleves.map((x) => x.inscriptionId), exercice),
      supabase.from("criteres_decision").select("*").order("ordre").then(verifier).catch(() => [])])
    return { ...d, photos, discipline, criteres }
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

  const calcul = useMemo(() => (donnees ? resultatsPeriode(donnees, periode) : null), [donnees, periode.code])  // eslint-disable-line react-hooks/exhaustive-deps
  const [codes, setCodes] = useState(new Map())
  const [logoImage, setLogoImage] = useState(null), [fond, setFond] = useState(null)
  useEffect(() => {          // logo de l'établissement, flouté, au centre du bulletin
    let actif = true
    image(logoUrl).then(async (img) => { if (!actif) return; setLogoImage(img); const f = await faireFiligrane(img); if (actif) setFond(f) })
    return () => { actif = false }
  }, [logoUrl])
  useEffect(() => {          // un code anti-fraude par bulletin affiché (QR code)
    if (!calcul) return
    let actif = true
    emettreBulletins(periode, calcul.resultats, calcul.stats).then((c) => { if (actif) setCodes(c) })
    return () => { actif = false }
  }, [calcul])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!donnees || !calcul) return <><Alerte>{erreur}</Alerte><Chargement /></>
  const { resultats, stats, entetes } = calcul
  const conduite = bilansPeriode(donnees.discipline, donnees.eleves.map((x) => x.inscriptionId), periode, donnees.sequences)
  // Décision de fin de période d'après les critères fixés par l'administration (Paramètres → Décisions de fin de période)
  const sanctions = sanctionsParEleve(donnees.discipline.incidents, sequencesDePeriode(periode, donnees.sequences))
  const decisionDe = (r) => decisionProposee(donnees.criteres, periode.code, { moyenne: r.moyenne ?? r.moyenneNonClassee,
    conduite: conduite.get(r.inscriptionId), sanctions: sanctions.get(r.inscriptionId) })

  async function exporter(liste, cle, nom) {
    setErreurPdf(""); setPdf(cle)
    try {
      await telechargerBulletinsPdf({ etablissement, logo: logoImage, filigrane: fond, exercice, periode, classe: donnees.classe, stats, entetes,
        eleves: liste.map((r) => ({ r, photoUrl: donnees.photos[r.eleve.photo], conduite: conduite.get(r.inscriptionId), decision: decisionDe(r), code: codes.get(r.inscriptionId) })) }, nom)
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
      {resultats.map((r) => <Bulletin key={r.inscriptionId} r={r} donnees={donnees} periode={periode} stats={stats} entetes={entetes}
                                      etablissement={etablissement} logo={logoUrl} filigrane={fond} exercice={exercice} photo={donnees.photos[r.eleve.photo]}
                                      conduite={conduite.get(r.inscriptionId)} decision={decisionDe(r)} code={codes.get(r.inscriptionId)} enCours={pdf}
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
