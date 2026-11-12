// Présentation d'un emploi du temps : par classe, par enseignant ou toutes les classes ; navigation (liste, précédent,
// suivant, recherche) ; vues synchronisées (un clic sur un enseignant ouvre son emploi du temps, et inversement) ;
// impression A4 / A3 paysage (une page par classe ou par enseignant) ; exports PDF et Excel.
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { t, locale } from "../../i18n.jsx"
import { classesDe, normaliserTexte } from "../../lib/edt/modele.js"
import { couleur, excelEmploiDuTemps, indexer, libellePeriode, nomJour, pdfEmploiDuTemps, tableauSemaine, totaux } from "../../lib/edt/vues.js"
import { Alerte } from "../../composants/Communs.jsx"

export function TableSemaine({ tab, cible, onClasse, onEnseignant, surbrillance, compacte }) {
  return (
    <div className={`table-responsive edt-conteneur${compacte ? " edt-compacte" : ""}`}>
      <table className="table table-bordered edt-table mb-0">
        <thead><tr><th className="edt-heure" scope="col">{t("Horaire")}</th>{tab.jours.map((j) => <th key={j} scope="col">{nomJour(j)}</th>)}</tr></thead>
        <tbody>
          {tab.lignes.map((l, i) => l.type === "pause"
            ? <tr key={i} className="edt-ligne-pause"><th className="edt-heure" scope="row">{l.libelle}</th><td colSpan={tab.jours.length}>{t(l.nom)}</td></tr>
            : <tr key={i}>
                <th className="edt-heure" scope="row">{l.libelle}</th>
                {l.cases.map((x, k) => <Case key={k} x={x} cible={cible} onClasse={onClasse} onEnseignant={onEnseignant}
                  marque={surbrillance?.has(`${x.c}|${tab.jours[k]}|${l.p}`)} />)}
              </tr>)}
        </tbody>
      </table>
    </div>
  )
}

function Case({ x, cible, onClasse, onEnseignant, marque }) {
  const cls = marque ? " edt-change" : ""
  if (x.type === "vide") return <td className={"edt-vide" + cls} />
  if (x.type === "ferme") return <td className="edt-ferme"><span>{x.libelle ? t(x.libelle) : t("Pas de cours")}</span></td>
  if (x.type === "pause") return <td className="edt-pause-case"><span>{x.libelle ? t(x.libelle) : ""}</span></td>
  if (x.type === "perm") return <td className={"edt-perm" + cls}><span className="edt-matiere">{t("Permanence")}</span></td>
  const c = couleur(x.discipline)
  return (
    <td className={"edt-cours" + cls} style={{ background: c.fond, borderLeft: `4px solid ${c.bord}` }}>
      <span className="edt-matiere">{x.discipline}</span>
      {cible.classe
        ? (onEnseignant ? <button type="button" className="edt-lien" onClick={() => onEnseignant(x.enseignant)} title={t("Voir l'emploi du temps de cet enseignant")}>{x.nomEnseignant}</button>
          : <span className="edt-sous">{x.nomEnseignant}</span>)
        : (onClasse ? <button type="button" className="edt-lien" onClick={() => onClasse(x.c)} title={t("Voir l'emploi du temps de cette classe")}>{x.classe}</button>
          : <span className="edt-sous">{x.classe}</span>)}
      {x.salle && <span className="edt-salle">{x.salle}</span>}
    </td>
  )
}

/** En-tête et pied de page des feuilles imprimées. */
function PageImprimee({ cfg, index, cible, entete, genere }) {
  return (
    <section className="edt-page">
      <div className="edt-page-entete">
        <div><strong>{entete.etablissement}</strong><br /><span>{t("Année scolaire")} {entete.annee} · {libellePeriode(entete.periode)}{entete.version ? ` · ${entete.version}` : ""}</span></div>
        <div className="text-end"><span className="edt-page-titre">{cible.titre}</span><br /><span>{cible.classe ? t("Emploi du temps de la classe") : t("Emploi du temps de l'enseignant")}</span></div>
      </div>
      <TableSemaine tab={tableauSemaine(cfg, index, cible)} cible={cible} />
      <div className="edt-page-pied">{t("Généré le {v0} avec NexIA School", { v0: genere })}</div>
    </section>
  )
}

/**
 * cfg, grille : emploi du temps ; entete : { etablissement, annee, periode, version } ;
 * surbrillance : cases modifiées (comparaison) ; initial : { mode, classe, enseignant }.
 */
export default function Visionneuse({ cfg, grille, entete, surbrillance, initial }) {
  const index = useMemo(() => indexer(cfg, grille), [cfg, grille])
  const classes = useMemo(() => classesDe(cfg), [cfg])
  const enseignants = useMemo(() => totaux(cfg, grille).enseignants, [cfg, grille])
  const [mode, setMode] = useState(initial?.mode || "classe")
  const [classe, setClasse] = useState(initial?.classe && classes.some((c) => c.id === initial.classe) ? initial.classe : classes[0]?.id)
  const [ens, setEns] = useState(initial?.enseignant && enseignants.some((e) => e.cle === initial.enseignant) ? initial.enseignant : enseignants[0]?.cle)
  const [recherche, setRecherche] = useState("")
  const [format, setFormat] = useState("a4")
  const [impression, setImpression] = useState(null)
  const [occupe, setOccupe] = useState(""), [erreur, setErreur] = useState("")

  const filtre = normaliserTexte(recherche)
  const classesVues = classes.filter((c) => !filtre || normaliserTexte(c.libelle).includes(filtre))
  const ensVus = enseignants.filter((e) => !filtre || normaliserTexte(e.nom).includes(filtre))
  const liste = mode === "enseignant" ? enseignants.map((e) => e.cle) : classes.map((c) => c.id)
  const courant = mode === "enseignant" ? ens : classe
  const rang = liste.indexOf(courant)
  const aller = (d) => { const v = liste[(rang + d + liste.length) % liste.length]; mode === "enseignant" ? setEns(v) : setClasse(v) }
  useEffect(() => { // la recherche sélectionne le premier résultat
    if (!filtre) return
    if (mode === "enseignant" && ensVus.length && !ensVus.some((e) => e.cle === ens)) setEns(ensVus[0].cle)
    if (mode !== "enseignant" && classesVues.length && !classesVues.some((c) => c.id === classe)) setClasse(classesVues[0].id)
  }, [filtre, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const voirEnseignant = (cle) => { setEns(cle); setMode("enseignant"); setRecherche("") }
  const voirClasse = (id) => { setClasse(id); setMode("classe"); setRecherche("") }
  const cibleClasse = (id) => ({ classe: id, titre: classes.find((c) => c.id === id)?.libelle || "" })
  const cibleEns = (cle) => ({ enseignant: cle, titre: enseignants.find((e) => e.cle === cle)?.nom || "" })
  const nomFichier = (x) => `emploi-du-temps-${x}`.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase()

  async function exporter(type, cibles, nom) {
    setErreur(""); setOccupe(type)
    try {
      if (type === "pdf") await pdfEmploiDuTemps({ cfg, grille, entete, cibles, format, nomFichier: nomFichier(nom) + ".pdf" })
      else await excelEmploiDuTemps({ cfg, grille, entete, nom: nomFichier(nom) })
    } catch (e) { setErreur(e.message || String(e)) } finally { setOccupe("") }
  }

  // impression : feuilles rendues hors de l'application, une par page, au format choisi
  useEffect(() => {
    if (!impression) return
    const style = document.createElement("style")
    style.textContent = `@media print { @page { size: ${impression.format === "a3" ? "A3" : "A4"} landscape; margin: 8mm; } }`
    document.head.appendChild(style); document.body.classList.add("edt-imprime")
    const fin = () => { style.remove(); document.body.classList.remove("edt-imprime"); setImpression(null) }
    const minuteur = setTimeout(() => { window.print(); fin() }, 80)
    return () => { clearTimeout(minuteur); style.remove(); document.body.classList.remove("edt-imprime") }
  }, [impression])

  if (!classes.length) return <div className="alert alert-info">{t("Cet emploi du temps ne contient aucune classe.")}</div>
  const genere = new Date().toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })
  const toutesClasses = classes.map((c) => cibleClasse(c.id)), tousEns = enseignants.map((e) => cibleEns(e.cle))

  return (
    <div className="edt-visionneuse">
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-2 no-print">
        <div className="btn-group" role="group" aria-label={t("Affichage")}>
          {[["classe", t("Par classe")], ["enseignant", t("Par enseignant")], ["toutes", t("Toutes les classes")]].map(([k, lib]) => (
            <button key={k} type="button" className={`btn btn-sm ${mode === k ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={mode === k} onClick={() => setMode(k)}>{lib}</button>))}
        </div>
        {mode !== "toutes" && <>
          <input type="search" className="form-control form-control-sm edt-recherche" placeholder={mode === "enseignant" ? t("Rechercher un enseignant") : t("Rechercher une classe")}
                 aria-label={t("Rechercher")} value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          <div className="input-group input-group-sm edt-choix">
            <button type="button" className="btn btn-outline-secondary" onClick={() => aller(-1)} aria-label={t("Précédent")} title={t("Précédent")}>‹</button>
            <select className="form-select form-select-sm" aria-label={mode === "enseignant" ? t("Enseignant") : t("Classe")} value={courant || ""}
                    onChange={(e) => (mode === "enseignant" ? setEns(e.target.value) : setClasse(e.target.value))}>
              {mode === "enseignant" ? ensVus.map((e) => <option key={e.cle} value={e.cle}>{e.nom} ({e.heures} h)</option>)
                : classesVues.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
            </select>
            <button type="button" className="btn btn-outline-secondary" onClick={() => aller(1)} aria-label={t("Suivant")} title={t("Suivant")}>›</button>
          </div>
          <span className="small text-muted">{rang + 1} / {liste.length}</span>
        </>}
      </div>

      <div className="d-flex flex-wrap gap-2 align-items-center mb-3 no-print edt-exports">
        <select className="form-select form-select-sm w-auto" aria-label={t("Format du papier")} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="a4">{t("A4 paysage")}</option><option value="a3">{t("A3 paysage")}</option>
        </select>
        {mode === "classe" && classe && <>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => setImpression({ cibles: [cibleClasse(classe)], format })}>{t("Imprimer cette classe")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => exporter("pdf", [cibleClasse(classe)], cibleClasse(classe).titre)}>{t("PDF de cette classe")}</button>
        </>}
        {mode === "enseignant" && ens && <>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => setImpression({ cibles: [cibleEns(ens)], format })}>{t("Imprimer cet enseignant")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => exporter("pdf", [cibleEns(ens)], cibleEns(ens).titre)}>{t("PDF de cet enseignant")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => exporter("pdf", tousEns, t("enseignants"))}>{t("PDF de tous les enseignants")}</button>
        </>}
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => setImpression({ cibles: toutesClasses, format })}>{t("Imprimer toutes les classes")}</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={!!occupe} onClick={() => exporter("pdf", toutesClasses, t("classes"))}>{t("PDF de toutes les classes")}</button>
        <button type="button" className="btn btn-sm btn-outline-success" disabled={!!occupe} onClick={() => exporter("excel", null, t("classes"))}>{t("Excel (une feuille par classe)")}</button>
        {occupe && <span className="small text-muted"><span className="spinner-border spinner-border-sm me-1" />{t("Préparation du fichier…")}</span>}
      </div>

      {mode === "classe" && classe && <>
        <h3 className="h5 mb-2">{cibleClasse(classe).titre}</h3>
        <TableSemaine tab={tableauSemaine(cfg, index, { classe })} cible={{ classe }} onEnseignant={voirEnseignant} surbrillance={surbrillance} />
      </>}
      {mode === "enseignant" && ens && <>
        <h3 className="h5 mb-2">{cibleEns(ens).titre} <span className="badge text-bg-light">{enseignants.find((e) => e.cle === ens)?.heures} h</span></h3>
        <TableSemaine tab={tableauSemaine(cfg, index, { enseignant: ens })} cible={{ enseignant: ens }} onClasse={voirClasse} />
      </>}
      {mode === "toutes" && classes.map((c) => (
        <div key={c.id} className="mb-4">
          <h3 className="h6 mb-1"><button type="button" className="edt-lien edt-lien-titre" onClick={() => voirClasse(c.id)}>{c.libelle}</button></h3>
          <TableSemaine tab={tableauSemaine(cfg, index, { classe: c.id })} cible={{ classe: c.id }} onEnseignant={voirEnseignant} surbrillance={surbrillance} compacte />
        </div>))}
      <div className="edt-legende small text-muted mt-2">{t("Cliquez sur le nom d'un enseignant ou d'une classe pour ouvrir son emploi du temps.")}</div>

      {impression && createPortal(
        <div className="edt-impression">{impression.cibles.map((c, k) => <PageImprimee key={k} cfg={cfg} index={index} cible={c} entete={entete} genere={genere} />)}</div>,
        document.body)}
    </div>
  )
}
