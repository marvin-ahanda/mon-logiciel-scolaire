// Paramètres → Récompenses et distinctions (administration) :
//  1. Distinctions : types configurables (période, élèves concernés, critères, sélection, modèle de certificat, visibilité)
//  2. Attribuer : présélection automatique, validation / retrait / ajout motivés, publication, réouverture tracée,
//     génération du tableau d'honneur et des certificats PDF (QR code de vérification)
//  3. Historique : distinctions obtenues par chaque élève, toutes années confondues
import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { CATEGORIES, MODELES, PERIODICITES, PORTEES, preselection, resumeCriteres } from "../lib/distinctions.js"
import { DEFAUTS_MODELES, certificatsPdf, reglages, tableauHonneurPdf, texteParDefaut, urlVerificationDistinction } from "../lib/certificatPdf.js"
import { situationsEleves } from "../lib/donneesDistinctions.js"
import { signaturesEnService } from "../lib/signatures.js"
import { image, nomDeFichier } from "../lib/bulletinPdf.js"
import { periodes as listePeriodes } from "../lib/periodes.js"
import { comparerNoms, date, dateHeure, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const STATUTS = { brouillon: ["Brouillon", "secondary"], validee: ["Validée", "success"], publiee: ["Publiée (parents)", "primary"] }
const nombreOuNull = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")))

export default function ParametresDistinctions() {
  const [vue, setVue] = useState("types")
  const { exercice } = useSession()
  const [ref, erreur, recharger] = useDonnees(async () => {
    const [distinctions, classes, sections, matieres, perso, sequences] = await Promise.all([
      supabase.from("distinctions").select("*").order("ordre").order("nom").then(verifier),
      supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier),
      supabase.from("sections").select("id, libelle").order("libelle").then(verifier),
      supabase.from("matieres").select("code, libelle").order("libelle").then(verifier),
      supabase.from("periodes_personnalisees").select("*").order("ordre").then(verifier),
      exercice ? supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero").then(verifier) : [],
    ])
    return { distinctions, classes, sections, matieres, perso, sequences, periodes: listePeriodes(sequences, perso) }
  }, [exercice?.id])
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <div className="distinctions">
      <p className="text-muted small">{t("Configurez vos récompenses (tableau d'honneur, félicitations, prix…), puis attribuez-les : la présélection est calculée d'après vos critères, l'administration valide, retire ou ajoute un élève avec un motif, publie aux parents et imprime tableaux d'honneur et certificats. Chaque distinction porte un QR code vérifiable.")}</p>
      <ul className="nav nav-pills mb-3">
        {[["types", "Distinctions"], ["attribuer", "Attribuer et générer"], ["historique", "Historique des élèves"]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => setVue(k)}>{t(l)}</button></li>))}
      </ul>
      {vue === "types" && <Types reference={ref} recharger={recharger} />}
      {vue === "attribuer" && (exercice ? <Attribuer reference={ref} /> : <div className="alert alert-warning">{t("Activez d'abord un exercice.")}</div>)}
      {vue === "historique" && <Historique reference={ref} />}
    </div>
  )
}

// --- 1. Types de distinctions ---------------------------------------------------------------------------------
function Types({ reference, recharger }) {
  const [edition, setEdition] = useState(null), [msg, setMsg] = useState({})
  const action = async (f, ok) => { setMsg({}); try { await f(); setMsg({ ok }); recharger() } catch (e) { setMsg({ erreur: e.message }) } }
  if (edition) return <Editeur initial={edition} reference={reference} onFin={(ok) => { setEdition(null); if (ok) { setMsg({ ok }); recharger() } }} />
  const d = reference.distinctions
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <button className="btn btn-primary" onClick={() => setEdition({})}>＋ {t("Nouvelle distinction")}</button>
        {!d.length && <button className="btn btn-outline-primary" onClick={() => action(() => rpc("distinctions_initialiser", {}), t("Distinctions usuelles créées : adaptez-les à votre établissement."))}>
          {t("Créer les distinctions usuelles")}</button>}
      </div>
      {!d.length && <div className="alert alert-info small">{t("Aucune distinction. Créez les distinctions usuelles (tableau d'honneur, encouragements, félicitations, mentions, prix d'excellence, majors, meilleure progression) puis adaptez-les, ou créez les vôtres.")}</div>}
      <div className="row g-3">
        {d.map((x) => (
          <div className="col-md-6 col-xl-4" key={x.id}><div className={`card h-100 carte-distinction${x.active ? "" : " opacity-50"}`} data-distinction={x.nom}>
            <div className="card-body d-flex flex-column">
              <div className="d-flex align-items-start gap-2 mb-1">
                <span className="pastille-distinction" style={{ background: x.personnalisation?.couleur || DEFAUTS_MODELES[x.modele]?.couleur }} aria-hidden="true" />
                <h2 className="h6 mb-0 flex-grow-1">{x.nom}</h2>
                {!x.active && <span className="badge text-bg-secondary">{t("masquée")}</span>}
              </div>
              <div className="small text-muted mb-2">{t(CATEGORIES[x.categorie])} · {t(PERIODICITES[x.periodicite])}</div>
              <div className="small mb-1"><strong>{t("Critères :")}</strong> {resumeCriteres(x.criteres, t)}</div>
              <div className="small mb-1"><strong>{t("Sélection :")}</strong> {x.selection?.mode === "meilleurs"
                ? t("les {v0} meilleur(s) {v1}, à la {v2}", { v0: x.selection.nombre || 1, v1: t(PORTEES[x.selection.portee || "classe"]), v2: t(x.selection.par === "progression" ? "progression" : "moyenne") })
                : t("tous les élèves qui remplissent les critères")}</div>
              <div className="small text-muted mb-2">{t("Certificat : modèle {v0}", { v0: t(MODELES[x.modele]) })}
                {" · "}{x.visible_parents ? t("visible des parents") : t("non publié aux parents")}{!x.imprimable && <> · {t("non imprimable")}</>}</div>
              <div className="mt-auto d-flex flex-wrap gap-2">
                <button className="btn btn-sm btn-outline-primary" onClick={() => setEdition(x)}>{t("Modifier")}</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => action(() => rpc("distinction_enregistrer", { p: { ...x, active: !x.active } }),
                  x.active ? t("Distinction masquée.") : t("Distinction réactivée."))}>{x.active ? t("Masquer") : t("Réactiver")}</button>
                <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => confirm(t("Supprimer la distinction « {v0} » ?", { v0: x.nom }))
                  && action(() => rpc("distinction_supprimer", { p_id: x.id }), t("Distinction supprimée."))}>{t("Supprimer")}</button>
              </div>
            </div></div></div>))}
      </div>
    </>
  )
}

function Cases({ titre, options, valeurs, onChange }) {
  if (!options.length) return null
  const sel = new Set((valeurs || []).map(String))
  return (
    <div className="mb-2"><div className="small fw-semibold">{titre}</div>
      <div className="d-flex flex-wrap gap-2">{options.map(([v, l]) => (
        <label key={v} className="form-check form-check-inline small mb-0"><input type="checkbox" className="form-check-input" checked={sel.has(String(v))}
          onChange={(e) => onChange(e.target.checked ? [...(valeurs || []), v] : (valeurs || []).filter((x) => String(x) !== String(v)))} /> {l}</label>))}</div>
    </div>
  )
}

function Editeur({ initial, reference, onFin }) {
  const { etablissement, logoUrl } = useSession()
  const [f, setF] = useState(() => ({
    id: initial.id, nom: initial.nom || "", categorie: initial.categorie || "tableau_honneur", periodicite: initial.periodicite || "trimestre",
    cible: initial.cible || {}, criteres: initial.criteres || {}, selection: initial.selection || { mode: "seuils" }, modele: initial.modele || "classique",
    personnalisation: initial.personnalisation || {}, visible_parents: initial.visible_parents ?? true, imprimable: initial.imprimable ?? true, active: initial.active ?? true,
  }))
  const [msg, setMsg] = useState(""), [occupe, setOccupe] = useState(false), [apercu, setApercu] = useState(null)
  const c = f.criteres, s = f.selection, p = f.personnalisation
  const majC = (k, v) => setF({ ...f, criteres: { ...c, [k]: v } })
  const majS = (k, v) => setF({ ...f, selection: { ...s, [k]: v } })
  const majP = (k, v) => setF({ ...f, personnalisation: { ...p, [k]: v } })
  const r = reglages(f, etablissement)
  const niveaux = [...new Set(reference.classes.map((x) => x.niveau).filter(Boolean))].sort(comparerNoms)
  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu) }, [apercu])

  const nettoyer = () => {
    const crit = {}
    for (const [k, v] of Object.entries(c)) {
      if (["matieres", "groupes"].includes(k)) { const l = (v || []).filter((x) => x.code !== "" && nombreOuNull(x.min) !== null && (k === "groupes" ? x.groupe : x.code)); if (l.length) crit[k] = l.map((x) => ({ ...x, min: nombreOuNull(x.min) })) }
      else if (typeof v === "boolean") { if (k === "classe_requise" ? v === false : v) crit[k] = v }
      else if (k === "paiement") { if (v && v !== "indifferent") crit[k] = v }
      else if (nombreOuNull(v) !== null) crit[k] = nombreOuNull(v)
    }
    const perso = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== "" && v !== undefined))
    return { ...f, nom: f.nom.trim(), criteres: crit, personnalisation: perso, selection: { ...s, nombre: Math.max(1, Number(s.nombre) || 1) } }
  }
  async function enregistrer(e) {
    e.preventDefault(); setMsg(""); setOccupe(true)
    try { await rpc("distinction_enregistrer", { p: nettoyer() }); onFin(t("Distinction « {v0} » enregistrée.", { v0: f.nom.trim() })) }
    catch (x) { setMsg(x.message) } finally { setOccupe(false) }
  }
  async function voirApercu() {
    const logo = r.afficherLogo ? await image(logoUrl) : null
    const url = await certificatsPdf([{ eleve: "NGONO Marie-Claire", matricule: "2026-0142", classe: "3e A", periode: t("Trimestre 1"), annee: "2026-2027",
      valeurs: { moyenne: 15.75, rang: 1, progression: 1.5 }, emis_le: new Date().toISOString() }], { distinction: { ...nettoyer(), nom: f.nom || t("Distinction") }, etablissement, logo, mode: "url" })
    if (apercu) URL.revokeObjectURL(apercu)
    setApercu(url)
  }
  const nb = (k, lib, max = 20, pas = "0.25") => (
    <div className="col-6 col-md-4 col-xl-3"><label className="form-label small mb-0" htmlFor={`c-${k}`}>{lib}</label>
      <input id={`c-${k}`} type="number" min={k === "progression_min" ? -20 : 0} max={max} step={pas} className="form-control form-control-sm" value={c[k] ?? ""} onChange={(e) => majC(k, e.target.value)} /></div>)

  return (
    <form className="editeur-distinction" onSubmit={enregistrer}>
      <Alerte onFermer={() => setMsg("")}>{msg}</Alerte>
      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("1. La distinction")}</h2>
        <div className="row g-2">
          <div className="col-md-5"><label className="form-label small mb-0" htmlFor="d-nom">{t("Nom affiché")}</label>
            <input id="d-nom" className="form-control" required maxLength={80} value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder={t("ex. Tableau d'honneur")} /></div>
          <div className="col-md-4"><label className="form-label small mb-0" htmlFor="d-cat">{t("Catégorie")}</label>
            <select id="d-cat" className="form-select" value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value })}>
              {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          <div className="col-md-3"><label className="form-label small mb-0" htmlFor="d-per">{t("Période concernée")}</label>
            <select id="d-per" className="form-select" value={f.periodicite} onChange={(e) => setF({ ...f, periodicite: e.target.value })}>
              {Object.entries(PERIODICITES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        </div>
        {f.periodicite === "perso" && !reference.perso.length && <div className="small text-warning-emphasis mt-2">{t("Aucune période personnalisée : créez-en (ex. semestres) dans")} <Link to="/parametres/exercices">{t("Exercices et séquences")}</Link>.</div>}
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("2. Élèves concernés")} <span className="fw-normal small text-muted">{t("(aucune case cochée = tous)")}</span></h2>
        <Cases titre={t("Cycles")} options={[[1, t("Premier cycle")], [2, t("Second cycle")]]} valeurs={f.cible.cycles} onChange={(v) => setF({ ...f, cible: { ...f.cible, cycles: v } })} />
        <Cases titre={t("Sections")} options={reference.sections.map((x) => [x.id, x.libelle])} valeurs={f.cible.sections} onChange={(v) => setF({ ...f, cible: { ...f.cible, sections: v } })} />
        <Cases titre={t("Niveaux")} options={niveaux.map((x) => [x, x])} valeurs={f.cible.niveaux} onChange={(v) => setF({ ...f, cible: { ...f.cible, niveaux: v } })} />
        <Cases titre={t("Classes")} options={reference.classes.map((x) => [x.id, x.libelle])} valeurs={f.cible.classes} onChange={(v) => setF({ ...f, cible: { ...f.cible, classes: v } })} />
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("3. Critères d'éligibilité")} <span className="fw-normal small text-muted">{t("(case vide = non prise en compte)")}</span></h2>
        <div className="row g-2 mb-2">
          {nb("moyenne_min", t("Moyenne ≥"))}{nb("moyenne_max", t("Moyenne <"))}{nb("note_min_toutes", t("Aucune note sous"))}
          {nb("discipline_min", t("Note de discipline ≥"))}{nb("nj_max", t("Absences non justifiées ≤ (h)"), 2000, "1")}
          {nb("retards_max", t("Retards ≤"), 2000, "1")}{nb("progression_min", t("Progression ≥ (points)"), 20)}
          <div className="col-6 col-md-4 col-xl-3"><label className="form-label small mb-0" htmlFor="c-pai">{t("Frais de scolarité")}</label>
            <select id="c-pai" className="form-select form-select-sm" value={c.paiement || "indifferent"} onChange={(e) => majC("paiement", e.target.value)}>
              <option value="indifferent">{t("Sans condition")}</option><option value="en_regle">{t("En règle à la date du calcul")}</option><option value="solde">{t("Pension entièrement soldée")}</option></select></div>
        </div>
        <div className="d-flex flex-wrap gap-3 mb-2 small">
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={!!c.sans_sanction} onChange={(e) => majC("sans_sanction", e.target.checked)} /> {t("Aucune sanction disciplinaire sur la période")}</label>
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={c.classe_requise !== false} onChange={(e) => majC("classe_requise", e.target.checked)} /> {t("Seuls les élèves classés (coefficients suffisants)")}</label>
        </div>
        <div className="row g-3">
          <div className="col-md-6"><div className="small fw-semibold">{t("Seuils par matière")}</div>
            {(c.matieres || []).map((x, k) => (
              <div className="d-flex gap-2 mb-1" key={k}>
                <select className="form-select form-select-sm" value={x.code} onChange={(e) => majC("matieres", c.matieres.map((y, i) => (i === k ? { ...y, code: e.target.value } : y)))} aria-label={t("Matière")}>
                  <option value="">{t("Matière…")}</option>{reference.matieres.map((m) => <option key={m.code} value={m.code}>{m.libelle}</option>)}</select>
                <input type="number" min={0} max={20} step="0.25" className="form-control form-control-sm" style={{ maxWidth: 90 }} placeholder="≥" value={x.min ?? ""}
                  onChange={(e) => majC("matieres", c.matieres.map((y, i) => (i === k ? { ...y, min: e.target.value } : y)))} aria-label={t("Note minimale")} />
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => majC("matieres", c.matieres.filter((_, i) => i !== k))} aria-label={t("Retirer")}>×</button></div>))}
            <button type="button" className="btn btn-sm btn-link px-0" onClick={() => majC("matieres", [...(c.matieres || []), { code: "", min: "" }])}>＋ {t("Ajouter une matière")}</button></div>
          <div className="col-md-6"><div className="small fw-semibold">{t("Seuils par groupe de matières")}</div>
            {(c.groupes || []).map((x, k) => (
              <div className="d-flex gap-2 mb-1" key={k}>
                <select className="form-select form-select-sm" value={x.groupe} onChange={(e) => majC("groupes", c.groupes.map((y, i) => (i === k ? { ...y, groupe: Number(e.target.value) } : y)))} aria-label={t("Groupe")}>
                  {[1, 2, 3].map((g) => <option key={g} value={g}>{t("Groupe ")}{g}</option>)}</select>
                <input type="number" min={0} max={20} step="0.25" className="form-control form-control-sm" style={{ maxWidth: 90 }} placeholder="≥" value={x.min ?? ""}
                  onChange={(e) => majC("groupes", c.groupes.map((y, i) => (i === k ? { ...y, min: e.target.value } : y)))} aria-label={t("Moyenne minimale du groupe")} />
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => majC("groupes", c.groupes.filter((_, i) => i !== k))} aria-label={t("Retirer")}>×</button></div>))}
            <button type="button" className="btn btn-sm btn-link px-0" onClick={() => majC("groupes", [...(c.groupes || []), { groupe: 1, min: "" }])}>＋ {t("Ajouter un groupe")}</button></div>
        </div>
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("4. Sélection")}</h2>
        <div className="d-flex flex-wrap gap-3 align-items-center small">
          <label className="form-check mb-0"><input type="radio" className="form-check-input" checked={s.mode !== "meilleurs"} onChange={() => majS("mode", "seuils")} /> {t("Tous les élèves qui remplissent les critères")}</label>
          <label className="form-check mb-0"><input type="radio" className="form-check-input" checked={s.mode === "meilleurs"} onChange={() => majS("mode", "meilleurs")} /> {t("Seulement les meilleurs")}</label>
          {s.mode === "meilleurs" && <>
            <input type="number" min={1} max={100} className="form-control form-control-sm" style={{ width: 80 }} value={s.nombre ?? 1} onChange={(e) => majS("nombre", e.target.value)} aria-label={t("Nombre")} />
            <select className="form-select form-select-sm w-auto" value={s.portee || "classe"} onChange={(e) => majS("portee", e.target.value)} aria-label={t("Portée")}>
              {Object.entries(PORTEES).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
            <select className="form-select form-select-sm w-auto" value={s.par || "moyenne"} onChange={(e) => majS("par", e.target.value)} aria-label={t("Classement")}>
              <option value="moyenne">{t("à la moyenne")}</option><option value="progression">{t("à la progression")}</option></select>
            <span className="text-muted">{t("(ex æquo inclus)")}</span></>}
        </div>
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("5. Certificat")}</h2>
        <div className="d-flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label={t("Modèle de certificat")}>
          {Object.entries(MODELES).map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={f.modele === k} className={`btn modele-certificat modele-${k}${f.modele === k ? " active" : ""}`}
              onClick={() => setF({ ...f, modele: k })} style={{ "--c1": DEFAUTS_MODELES[k].couleur, "--c2": DEFAUTS_MODELES[k].couleur2 }}>
              <span className="miniature" aria-hidden="true" /><span className="small">{t(l)}</span></button>))}
        </div>
        <div className="row g-2">
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="p-titre">{t("Titre")}</label>
            <input id="p-titre" className="form-control form-control-sm" maxLength={60} placeholder={f.nom || t("Nom de la distinction")} value={p.titre || ""} onChange={(e) => majP("titre", e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="p-st">{t("Formule d'introduction")}</label>
            <input id="p-st" className="form-control form-control-sm" maxLength={80} placeholder={t("est décerné(e) à")} value={p.sous_titre || ""} onChange={(e) => majP("sous_titre", e.target.value)} /></div>
          <div className="col-12"><label className="form-label small mb-0" htmlFor="p-texte">{t("Texte")}</label>
            <textarea id="p-texte" className="form-control form-control-sm" rows={2} maxLength={400} placeholder={texteParDefaut(p.afficher_moyenne !== false)} value={p.texte || ""} onChange={(e) => majP("texte", e.target.value)} />
            <div className="form-text">{t("Variables : {eleve} {classe} {periode} {annee} {moyenne} {rang} {progression} {distinction} {etablissement} {ville} {date} {matricule}")}</div></div>
          <div className="col-6 col-md-2"><label className="form-label small mb-0" htmlFor="p-c1">{t("Couleur principale")}</label>
            <input id="p-c1" type="color" className="form-control form-control-color w-100" value={r.couleur} onChange={(e) => majP("couleur", e.target.value)} /></div>
          <div className="col-6 col-md-2"><label className="form-label small mb-0" htmlFor="p-c2">{t("Couleur d'accent")}</label>
            <input id="p-c2" type="color" className="form-control form-control-color w-100" value={r.couleur2} onChange={(e) => majP("couleur2", e.target.value)} /></div>
          <div className="col-6 col-md-2"><label className="form-label small mb-0" htmlFor="p-pol">{t("Police")}</label>
            <select id="p-pol" className="form-select form-select-sm" value={r.police} onChange={(e) => majP("police", e.target.value)}>
              <option value="serif">{t("Classique (à empattements)")}</option><option value="sans">{t("Moderne (sans empattements)")}</option></select></div>
          <div className="col-6 col-md-3"><label className="form-label small mb-0" htmlFor="p-sig">{t("Signataire")}</label>
            <input id="p-sig" className="form-control form-control-sm" maxLength={60} placeholder={t("Le chef d'établissement")} value={p.signataire || ""} onChange={(e) => majP("signataire", e.target.value)} /></div>
          <div className="col-6 col-md-3"><label className="form-label small mb-0" htmlFor="p-nsig">{t("Nom du signataire")}</label>
            <input id="p-nsig" className="form-control form-control-sm" maxLength={80} placeholder={etablissement.nom_chef || ""} value={p.nom_signataire ?? ""} onChange={(e) => majP("nom_signataire", e.target.value)} /></div>
        </div>
        <div className="d-flex flex-wrap gap-3 mt-2 small align-items-center">
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={p.afficher_logo !== false} onChange={(e) => majP("afficher_logo", e.target.checked)} /> {t("Logo de l'établissement")}</label>
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={p.afficher_moyenne !== false} onChange={(e) => majP("afficher_moyenne", e.target.checked)} /> {t("Moyenne de l'élève")}</label>
          <button type="button" className="btn btn-sm btn-outline-primary ms-auto" onClick={voirApercu}>{t("Aperçu du certificat")}</button>
          <button type="button" className="btn btn-sm btn-link" onClick={() => setF({ ...f, personnalisation: {} })}>{t("Revenir aux réglages du modèle")}</button>
        </div>
        {apercu && <iframe src={apercu} title={t("Aperçu du certificat")} className="apercu-certificat mt-3" />}
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("6. Visibilité")}</h2>
        <div className="d-flex flex-wrap gap-3 small">
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={f.visible_parents} onChange={(e) => setF({ ...f, visible_parents: e.target.checked })} /> {t("Publiable dans l'espace parents")}</label>
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={f.imprimable} onChange={(e) => setF({ ...f, imprimable: e.target.checked })} /> {t("Certificats imprimables")}</label>
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t("Active (sinon masquée)")}</label>
        </div>
      </div></div>
      <div className="d-flex gap-2 mb-4">
        <button className="btn btn-primary" disabled={occupe}>{t("Enregistrer la distinction")}</button>
        <button type="button" className="btn btn-outline-secondary" onClick={() => onFin(null)}>{t("Annuler")}</button>
      </div>
    </form>
  )
}

// --- 2. Attribution ------------------------------------------------------------------------------------------
function Attribuer({ reference }) {
  const { exercice, etablissement, logoUrl } = useSession()
  const actives = reference.distinctions.filter((x) => x.active)
  const [choix, setChoix] = useState({ distinction: actives[0]?.id || "", periode: "" })
  const distinction = actives.find((x) => x.id === choix.distinction)
  const periodes = useMemo(() => reference.periodes.filter((p) => p.type === distinction?.periodicite), [distinction, reference.periodes])
  const periode = periodes.find((p) => p.code === choix.periode) || null
  const [msg, setMsg] = useState({}), [calcul, setCalcul] = useState(null), [cle, setCle] = useState(0)
  const [d, erreur] = useDonnees(async () => {
    if (!distinction || !periode) return { session: null, laureats: [], journal: [] }
    const session = await supabase.from("distinctions_sessions").select("*").eq("distinction_id", distinction.id).eq("exercice_id", exercice.id).eq("periode", periode.code).maybeSingle().then(verifier)
    if (!session) return { session: null, laureats: [], journal: [] }
    const [laureats, journal] = await Promise.all([
      toutCharger(() => supabase.from("distinctions_attribuees").select("*").eq("session_id", session.id)),
      supabase.from("distinctions_journal").select("*").eq("session_id", session.id).order("le", { ascending: false }).limit(100).then(verifier)])
    return { session, laureats: laureats.sort((a, b) => comparerNoms(a.classe, b.classe) || (b.valeurs?.moyenne ?? -1) - (a.valeurs?.moyenne ?? -1)), journal }
  }, [distinction?.id, periode?.code, cle])
  const recharger = () => setCle((k) => k + 1)
  const agir = async (f, ok) => { setMsg({}); try { await f(); if (ok) setMsg({ ok }); recharger() } catch (e) { setMsg({ erreur: e.message }) } }

  async function calculer() {
    setMsg({}); setCalcul({ fait: 0, total: 0 })
    try {
      const situations = await situationsEleves(distinction, reference.classes, periode, reference.periodes, exercice, (fait, total) => setCalcul({ fait, total }))
      const retenus = preselection(distinction, situations)
      const r = await rpc("distinctions_preselection", { p_distinction: distinction.id, p_periode: periode.code, p_libelle: periode.libelle,
        p_candidats: retenus.map((x) => ({ inscription_id: x.situation.inscriptionId, valeurs: x.valeurs })) })
      setMsg({ ok: t("{v0} élève(s) présélectionné(s) sur {v1} examiné(s). Vérifiez la liste, retirez ou ajoutez un élève si nécessaire, puis validez.", { v0: r.candidats, v1: situations.length }) })
      recharger()
    } catch (e) { setMsg({ erreur: e.message }) } finally { setCalcul(null) }
  }
  const motif = (question) => { const m = prompt(question); return m === null ? null : m.trim() }
  const retenus = (d?.laureats || []).filter((x) => x.retenu)

  async function pdfTableau(regroupement, mode = "telecharger") {
    const classes = new Map(reference.classes.map((c) => [c.id, c]))
    const cle = (l) => { const c = classes.get(l.classe_id) || {}; return regroupement === "classe" ? l.classe : regroupement === "niveau" ? (c.niveau || l.classe)
      : regroupement === "cycle" ? (c.cycle ? t(c.cycle === 1 ? "Premier cycle" : "Second cycle") : t("Cycle non précisé")) : t("Tout l'établissement") }
    const groupes = new Map()
    for (const l of retenus) { const k = cle(l); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(l) }
    const r = reglages(distinction, etablissement)
    await tableauHonneurPdf({ titre: distinction.nom, sousTitre: `${periode.libelle} · ${t("Année scolaire")} ${exercice.libelle}`, etablissement,
      logo: r.afficherLogo ? await image(logoUrl) : null, couleur: r.couleur, afficherMoyenne: r.afficherMoyenne, afficherProgression: distinction.selection?.par === "progression",
      groupes: [...groupes.entries()].sort((a, b) => comparerNoms(a[0], b[0])).map(([titre, lignes]) => ({ titre, lignes: lignes.map((l) => ({ ...l, moyenne: l.valeurs?.moyenne, progression: l.valeurs?.progression })) })),
      nom: nomDeFichier(distinction.nom, periode.libelle, exercice.libelle), mode })
  }
  async function pdfCertificats(liste) {
    const r = reglages(distinction, etablissement)
    await certificatsPdf(liste.map((l) => ({ ...l, periode: periode.libelle, annee: exercice.libelle })), { distinction, etablissement,
      logo: r.afficherLogo ? await image(logoUrl) : null, signatures: await signaturesEnService(), nom: nomDeFichier(t("certificats"), distinction.nom, liste.length === 1 ? liste[0].eleve : periode.libelle) })
  }

  if (!actives.length) return <div className="alert alert-info">{t("Créez d'abord une distinction dans l'onglet « Distinctions ».")}</div>
  const s = d?.session, brouillon = !s || s.statut === "brouillon"
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur || erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="row g-2 mb-3" style={{ maxWidth: 760 }}>
        <div className="col-sm-7"><select className="form-select" value={choix.distinction} onChange={(e) => setChoix({ distinction: e.target.value, periode: "" })} aria-label={t("Distinction")}>
          {actives.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></div>
        <div className="col-sm-5"><select className="form-select" value={choix.periode} onChange={(e) => setChoix({ ...choix, periode: e.target.value })} aria-label={t("Période")}>
          <option value="">{t("Période…")}</option>{periodes.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></div>
      </div>
      {distinction && <p className="small text-muted">{t("Critères :")} {resumeCriteres(distinction.criteres, t)}</p>}
      {periode && !d && <Chargement />}
      {periode && d && <>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          {s && <span className={`badge text-bg-${STATUTS[s.statut][1]} fs-6`}>{t(STATUTS[s.statut][0])}</span>}
          {s?.reouvertures > 0 && <span className="small text-muted">{t("rouverte {v0} fois", { v0: s.reouvertures })}</span>}
          {brouillon && <button className="btn btn-primary" disabled={!!calcul} onClick={calculer}>
            {calcul ? t("Calcul… {v0}/{v1} classe(s)", { v0: calcul.fait, v1: calcul.total || "…" }) : s ? t("Recalculer la présélection") : t("Calculer la présélection")}</button>}
          {brouillon && s && <AjoutEleve session={s} exercice={exercice} dejaLa={new Set(d.laureats.filter((x) => x.retenu).map((x) => x.inscription_id))} onAjout={(id, m) => agir(() => rpc("distinctions_ajouter", { p_session: s.id, p_inscription: id, p_motif: m }), t("Élève ajouté."))} />}
          {brouillon && s && <button className="btn btn-success" disabled={!retenus.length} onClick={() => confirm(t("Valider la liste de {v0} lauréat(s) ? Chaque lauréat recevra son code de vérification ; la liste sera figée.", { v0: retenus.length }))
            && agir(() => rpc("distinctions_valider", { p_session: s.id }), t("Liste validée : codes de vérification attribués."))}>{t("Valider la liste")}</button>}
          {s?.statut === "validee" && distinction.visible_parents && <button className="btn btn-primary" onClick={() => agir(async () => rpc("distinctions_publier", { p_session: s.id, p_publier: true, p_logo: (await image(logoUrl))?.donnees || null }), t("Publiée dans l'espace parents."))}>{t("Publier aux parents")}</button>}
          {s?.statut === "publiee" && <button className="btn btn-outline-primary" onClick={() => agir(() => rpc("distinctions_publier", { p_session: s.id, p_publier: false }), t("Retirée de l'espace parents."))}>{t("Retirer de l'espace parents")}</button>}
          {s && !brouillon && <button className="btn btn-outline-warning" onClick={() => { const m = motif(t("Motif de la modification (obligatoire, conservé dans le journal) :")); if (m !== null) agir(() => rpc("distinctions_rouvrir", { p_session: s.id, p_motif: m }), t("Distinction rouverte pour modification.")) }}>{t("Rouvrir pour modifier")}</button>}
          {brouillon && s && !s.valide_le && <button className="btn btn-outline-danger ms-auto" onClick={() => confirm(t("Supprimer ce brouillon ?")) && agir(() => rpc("distinctions_supprimer_session", { p_session: s.id }), t("Brouillon supprimé."))}>{t("Supprimer le brouillon")}</button>}
        </div>
        {s && !brouillon && distinction.imprimable && retenus.length > 0 && <Generation onTableau={pdfTableau} onCertificats={() => pdfCertificats(retenus.filter((l) => l.code && !l.revoque_le))} />}
        {!s && <div className="alert alert-light border small">{t("Aucune présélection pour cette période. Lancez le calcul : les moyennes, la conduite et, si demandé, la situation de paiement de chaque élève concerné sont examinées.")}</div>}
        {s && <div className="table-responsive mb-3"><table className="table table-sm align-middle tableau-laureats">
          <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th className="text-end">{t("Moyenne")}</th><th className="text-end">{t("Rang")}</th>
            <th className="text-end">{t("Progression")}</th><th>{t("Origine")}</th><th>{t("Statut")}</th><th /></tr></thead>
          <tbody>{d.laureats.map((l) => (
            <tr key={l.id} className={l.retenu ? "" : "table-secondary text-decoration-line-through-soft"}>
              <td><strong>{l.eleve}</strong><div className="small text-muted">{l.matricule}</div></td><td>{l.classe}</td>
              <td className="text-end">{l.valeurs?.moyenne === null || l.valeurs?.moyenne === undefined ? "—" : note(Number(l.valeurs.moyenne))}</td>
              <td className="text-end">{l.valeurs?.rang ?? "—"}</td>
              <td className="text-end">{l.valeurs?.progression === null || l.valeurs?.progression === undefined ? "—" : `${l.valeurs.progression > 0 ? "+" : ""}${note(Number(l.valeurs.progression))}`}</td>
              <td>{l.origine === "manuel" ? <span className="badge text-bg-warning" title={l.motif}>{t("ajout manuel")}</span> : <span className="badge text-bg-light">{t("calcul")}</span>}</td>
              <td>{l.retenu ? (l.revoque_le ? <span className="badge text-bg-danger">{t("révoquée")}</span> : <span className="badge text-bg-success">{t("retenu")}</span>)
                : <><span className="badge text-bg-secondary">{t("retiré")}</span>{l.revoque_le && <span className="badge text-bg-danger ms-1">{t("code révoqué")}</span>}</>}
                {l.motif && <div className="small text-muted">{l.motif}</div>}
                {l.code && <div className="small"><a href={urlVerificationDistinction(l.code)} target="_blank" rel="noopener noreferrer"><code>{l.code}</code></a></div>}</td>
              <td className="text-end text-nowrap">
                {brouillon && (l.retenu
                  ? <button className="btn btn-sm btn-outline-danger" onClick={() => { const m = motif(t("Motif du retrait de {v0} :", { v0: l.eleve })); if (m !== null) agir(() => rpc("distinctions_decider", { p_attribution: l.id, p_retenu: false, p_motif: m })) }}>{t("Retirer")}</button>
                  : <button className="btn btn-sm btn-outline-success" onClick={() => agir(() => rpc("distinctions_decider", { p_attribution: l.id, p_retenu: true, p_motif: "" }))}>{t("Rétablir")}</button>)}
                {!brouillon && l.retenu && l.code && distinction.imprimable && <button className="btn btn-sm btn-outline-secondary" onClick={() => pdfCertificats([l])}>{t("Certificat")}</button>}
              </td></tr>))}
            {!d.laureats.length && <tr><td colSpan={8} className="text-center text-muted py-3">{t("Aucun élève ne remplit les critères pour cette période.")}</td></tr>}</tbody>
        </table></div>}
        {s && d.journal.length > 0 && <details className="small"><summary>{t("Journal ({v0})", { v0: d.journal.length })}</summary>
          <ul className="list-unstyled mt-2 journal-distinctions">{d.journal.map((j) => (
            <li key={j.id}><span className="text-muted">{dateHeure(j.le)}</span> · <strong>{t(ACTIONS[j.action] || j.action)}</strong>
              {j.details?.eleve && <> · {j.details.eleve}</>}{j.details?.candidats !== undefined && <> · {t("{v0} candidat(s)", { v0: j.details.candidats })}</>}
              {j.motif && <> · <em>{j.motif}</em></>}</li>))}</ul></details>}
      </>}
    </>
  )
}

const ACTIONS = { preselection: "Présélection calculée", retire: "Élève retiré", retenu: "Élève rétabli", ajoute: "Élève ajouté", validation: "Liste validée",
  publication: "Publiée aux parents", depublication: "Retirée de l'espace parents", reouverture: "Rouverte pour modification" }

function AjoutEleve({ session, exercice, dejaLa, onAjout }) {
  const [ouvert, setOuvert] = useState(false), [q, setQ] = useState(""), [liste, setListe] = useState(null)
  useEffect(() => {
    if (!ouvert || liste) return
    toutCharger(() => supabase.from("inscriptions").select("id, eleves(nom, prenom, matricule), classes(libelle)").eq("exercice_id", exercice.id))
      .then((l) => setListe(l.map((i) => ({ id: i.id, nom: nomComplet(i.eleves), matricule: i.eleves.matricule, classe: i.classes?.libelle || "" })).sort((a, b) => comparerNoms(a.nom, b.nom))))
      .catch(() => setListe([]))
  }, [ouvert, liste, exercice.id])
  if (!ouvert) return <button className="btn btn-outline-secondary" onClick={() => setOuvert(true)}>＋ {t("Ajouter un élève")}</button>
  const filtre = q.trim().toLowerCase(), resultats = (liste || []).filter((x) => !dejaLa.has(x.id) && (!filtre || `${x.nom} ${x.matricule} ${x.classe}`.toLowerCase().includes(filtre))).slice(0, 8)
  return (
    <div className="card p-2 w-100 ajout-eleve-distinction" data-session={session.id}>
      <div className="d-flex gap-2 mb-1"><input className="form-control form-control-sm" autoFocus placeholder={t("Nom, matricule ou classe…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Rechercher un élève")} />
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setOuvert(false)}>{t("Fermer")}</button></div>
      {!liste ? <Chargement /> : resultats.map((x) => (
        <button key={x.id} className="btn btn-sm btn-light text-start" onClick={() => { const m = prompt(t("Motif de l'ajout de {v0} (dérogation, décision du conseil…) :", { v0: x.nom })); if (m !== null) { onAjout(x.id, m.trim()); setOuvert(false) } }}>
          {x.nom} <span className="text-muted">· {x.matricule} · {x.classe}</span></button>))}
    </div>
  )
}

function Generation({ onTableau, onCertificats }) {
  const [regroupement, setRegroupement] = useState("classe"), [occupe, setOccupe] = useState(""), [erreur, setErreur] = useState("")
  const lancer = async (k, f) => { setOccupe(k); setErreur(""); try { await f() } catch (e) { setErreur(e.message) } finally { setOccupe("") } }
  return (
    <div className="card mb-3 generation-distinctions"><div className="card-body py-2 d-flex flex-wrap gap-2 align-items-center">
      <strong className="small me-1">{t("Générer :")}</strong>
      <select className="form-select form-select-sm w-auto" value={regroupement} onChange={(e) => setRegroupement(e.target.value)} aria-label={t("Regroupement du tableau d'honneur")}>
        <option value="classe">{t("Tableau d'honneur par classe")}</option><option value="niveau">{t("par niveau")}</option>
        <option value="cycle">{t("par cycle")}</option><option value="etablissement">{t("pour tout l'établissement")}</option></select>
      <button className="btn btn-sm btn-outline-primary" disabled={!!occupe} onClick={() => lancer("t", () => onTableau(regroupement))}>{occupe === "t" ? "PDF…" : t("Tableau d'honneur (PDF)")}</button>
      <button className="btn btn-sm btn-outline-primary" disabled={!!occupe} onClick={() => lancer("i", () => onTableau(regroupement, "imprimer"))}>{t("Imprimer")}</button>
      <button className="btn btn-sm btn-primary" disabled={!!occupe} onClick={() => lancer("c", onCertificats)}>{occupe === "c" ? "PDF…" : t("Tous les certificats (PDF)")}</button>
      {erreur && <span className="text-danger small">{erreur}</span>}
    </div></div>
  )
}

// --- 3. Historique -------------------------------------------------------------------------------------------
function Historique() {
  const { etablissement, logoUrl } = useSession()
  const [q, setQ] = useState("")
  const [d, erreur] = useDonnees(async () => {
    const [att, sessions, distinctions, exercices] = await Promise.all([
      toutCharger(() => supabase.from("distinctions_attribuees").select("*").not("code", "is", null)),
      toutCharger(() => supabase.from("distinctions_sessions").select("id, distinction_id, exercice_id, periode_libelle, statut, configuration")),
      supabase.from("distinctions").select("*").then(verifier),
      supabase.from("exercices").select("id, libelle").then(verifier)])
    const S = new Map(sessions.map((s) => [s.id, s])), D = new Map(distinctions.map((x) => [x.id, x])), X = new Map(exercices.map((x) => [x.id, x.libelle]))
    return att.map((a) => { const s = S.get(a.session_id); return { ...a, session: s, distinction: D.get(s?.distinction_id), annee: X.get(s?.exercice_id) } })
      .filter((a) => a.session && a.distinction).sort((a, b) => comparerNoms(a.eleve, b.eleve) || String(b.emis_le).localeCompare(String(a.emis_le)))
  }, [])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const f = q.trim().toLowerCase(), liste = d.filter((a) => !f || `${a.eleve} ${a.matricule} ${a.classe}`.toLowerCase().includes(f))
  const parEleve = new Map()
  for (const a of liste) { if (!parEleve.has(a.eleve_id)) parEleve.set(a.eleve_id, []); parEleve.get(a.eleve_id).push(a) }
  return (
    <>
      <input className="form-control mb-3" style={{ maxWidth: 420 }} placeholder={t("Rechercher un élève (nom, matricule, classe)…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Rechercher un élève")} />
      {!d.length && <p className="text-muted">{t("Aucune distinction validée pour le moment.")}</p>}
      {[...parEleve.values()].slice(0, 100).map((l) => (
        <div className="card mb-2" key={l[0].eleve_id}><div className="card-body py-2">
          <div className="fw-semibold">{l[0].eleve} <span className="text-muted small">· {l[0].matricule}</span></div>
          <ul className="list-unstyled small mb-0">{l.map((a) => (
            <li key={a.id} className="d-flex flex-wrap gap-2 align-items-center py-1 border-top">
              <span>🏅 <strong>{a.session.configuration?.nom || a.distinction.nom}</strong> · {a.session.periode_libelle} {a.annee} · {a.classe}</span>
              {a.valeurs?.moyenne !== undefined && a.valeurs?.moyenne !== null && <span className="text-muted">{note(Number(a.valeurs.moyenne))}/20</span>}
              {!a.retenu || a.revoque_le ? <span className="badge text-bg-danger">{t("révoquée")}</span> : <span className={`badge text-bg-${STATUTS[a.session.statut][1]}`}>{t(STATUTS[a.session.statut][0])}</span>}
              <span className="text-muted">{date(a.emis_le)}</span>
              <a className="ms-auto" href={urlVerificationDistinction(a.code)} target="_blank" rel="noopener noreferrer"><code>{a.code}</code></a>
              {a.retenu && !a.revoque_le && a.distinction.imprimable && <button className="btn btn-sm btn-outline-secondary py-0" onClick={async () => {
                const r = reglages(a.distinction, etablissement)
                await certificatsPdf([{ ...a, periode: a.session.periode_libelle, annee: a.annee }], { distinction: { ...a.distinction, nom: a.session.configuration?.nom || a.distinction.nom }, etablissement,
                  logo: r.afficherLogo ? await image(logoUrl) : null, signatures: await signaturesEnService(), nom: nomDeFichier(t("certificat"), a.eleve, a.session.periode_libelle) })
              }}>{t("Certificat")}</button>}
            </li>))}</ul>
        </div></div>))}
    </>
  )
}
