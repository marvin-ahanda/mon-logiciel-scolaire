// Paramètres → Transition d'année (administration) : passage des élèves d'une année scolaire à la suivante.
// 1. Préparer (année cible, structures dupliquées) · 2. Analyser et réviser les décisions · 3. Simuler ·
// 4. Appliquer (inscriptions) · 5. Clôturer ; retour arrière avant clôture, annulation tracée après ; rapport,
// historique d'un élève, journal. Aucune modification sans validation explicite.
import { useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { DECISIONS, libelleDestination, mentionDe } from "../lib/parcours.js"
import { propositionsClasse } from "../lib/donneesParcours.js"
import { listePdf } from "../lib/financePdf.js"
import { telechargerClasseur } from "../lib/excel.js"
import { nomDeFichier } from "../lib/bulletinPdf.js"
import { comparerNoms, dateHeure, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const INSCRIT = ["promu", "redoublant", "admis_sous_condition", "oriente", "transfere", "change_cycle", "change_serie"]
const STATUTS = { preparation: ["En préparation", "secondary"], appliquee: ["Appliquée", "primary"], cloturee: ["Clôturée", "success"] }
const ETAPES = [["preparation", "1. Préparer"], ["decisions", "2. Analyser et réviser"], ["simulation", "3. Simuler"], ["application", "4. Appliquer et clôturer"]]
const anneeSuivante = (l) => { const a = Number(String(l || "").slice(0, 4)); return a ? `${a + 1}-${a + 2}` : "" }

export default function ParametresTransition() {
  const { exercice, aOffre, recharger: rechargerSession } = useSession()
  const [cle, setCle] = useState(0), [sourceId, setSourceId] = useState(""), [msg, setMsg] = useState({}), [vue, setVue] = useState("preparation")
  const [ref, erreur] = useDonnees(async () => {
    const lire = (table, ordre = "libelle") => supabase.from(table).select("*").order(ordre).then(verifier)
    const [exercices, transitions, classes, niveaux, series, regles, config] = await Promise.all([lire("exercices"), supabase.from("transitions").select("*").then(verifier),
      supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier), lire("niveaux", "ordre"), lire("series", "code"), lire("regles_passage", "ordre"),
      supabase.from("parcours_config").select("*").maybeSingle().then(verifier)])
    return { exercices, transitions, classes, niveaux, series, regles, mentions: config?.mentions || {} }
  }, [cle])
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  // par défaut : la transition qui a mené à l'année active (après clôture), sinon l'année active elle-même
  const parDefaut = ref.transitions.find((x) => x.exercice_cible_id === exercice?.id)?.exercice_source_id || exercice?.id
  const source = ref.exercices.find((x) => x.id === (sourceId || parDefaut)) || ref.exercices.find((x) => x.actif)
  const tr = source && ref.transitions.find((x) => x.exercice_source_id === source.id)
  const cible = tr && ref.exercices.find((x) => x.id === tr.exercice_cible_id)
  const recharger = () => setCle((k) => k + 1)
  const agir = async (f, ok) => { setMsg({}); try { const r = await f(); setMsg({ ok: typeof ok === "function" ? ok(r) : ok }); recharger(); rechargerSession?.() } catch (e) { setMsg({ erreur: e.message }) } }
  if (!source) return <div className="alert alert-warning">{t("Créez d'abord une année scolaire (onglet « Exercices et séquences »).")}</div>
  return (
    <div className="transition-annee">
      <p className="text-muted small">{t("Faites passer les élèves de l'année qui se termine à la suivante. Rien n'est modifié sans votre validation : préparez l'année suivante, vérifiez la décision de chaque élève, lancez la simulation, puis appliquez. Tant que la transition n'est pas clôturée, vous pouvez revenir en arrière.")}</p>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <label className="small text-muted mb-0" htmlFor="tr-source">{t("Année qui se termine")}</label>
        <select id="tr-source" className="form-select w-auto" value={source.id} onChange={(e) => setSourceId(e.target.value)}>
          {ref.exercices.map((x) => <option key={x.id} value={x.id}>{x.libelle}{x.actif ? ` (${t("active")})` : ""}</option>)}</select>
        {tr && <><span className="mx-1">→</span><strong>{cible?.libelle}</strong>
          <span className={`badge text-bg-${STATUTS[tr.statut][1]} etat-transition`} data-statut={tr.statut}>{t(STATUTS[tr.statut][0])}</span></>}
      </div>
      <ul className="nav nav-pills mb-3">
        {[...ETAPES, ["rapport", "Rapport"], ["historique", "Historique d'un élève"], ["journal", "Journal"]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} disabled={!tr && !["preparation", "historique"].includes(k)}
            onClick={() => setVue(k)}>{t(l)}</button></li>))}
      </ul>
      {vue === "preparation" && <Preparation source={source} tr={tr} agir={agir} />}
      {vue === "decisions" && tr && <Decisions tr={tr} source={source} reference={ref} avecCriteres={aOffre("decisions")} setMsg={setMsg} />}
      {vue === "simulation" && tr && <Simulation tr={tr} />}
      {vue === "application" && tr && <Application tr={tr} cible={cible} agir={agir} />}
      {vue === "rapport" && tr && <Rapport tr={tr} source={source} cible={cible} reference={ref} />}
      {vue === "historique" && <Historique reference={ref} />}
      {vue === "journal" && tr && <Journal tr={tr} />}
    </div>
  )
}

// --- 1. Préparation -------------------------------------------------------------------------------------------
function Preparation({ source, tr, agir }) {
  const [cible, setCible] = useState(anneeSuivante(source.libelle)), [o, setO] = useState({ programme: true, bareme: true, frais: true })
  const verrouillee = tr && tr.statut !== "preparation"
  return (
    <div className="card mb-3"><div className="card-body">
      <div className="row g-2 align-items-end mb-2" style={{ maxWidth: 640 }}>
        <div className="col-sm-5"><label className="form-label small mb-0" htmlFor="tr-cible">{t("Nouvelle année scolaire")}</label>
          <input id="tr-cible" className="form-control" pattern="[0-9]{4}-[0-9]{4}" value={cible} disabled={verrouillee} onChange={(e) => setCible(e.target.value)} /></div>
      </div>
      <div className="small fw-semibold">{t("Reprendre dans la nouvelle année :")}</div>
      {[["programme", "Programme : matières, coefficients et enseignants de chaque classe"], ["bareme", "Barème de la note de discipline"], ["frais", "Frais de scolarité et échéancier (dates décalées d'un an)"]].map(([k, l]) => (
        <label key={k} className="form-check small"><input type="checkbox" className="form-check-input" checked={o[k]} disabled={verrouillee} onChange={(e) => setO({ ...o, [k]: e.target.checked })} /> {t(l)}</label>))}
      <p className="small text-muted mb-2">{t("Cycles, niveaux, classes, sections, filières, séries, options et règles de passage sont communs à toutes les années : ils sont conservés tels quels. La nouvelle année est créée sans être activée.")}</p>
      <button className="btn btn-primary" disabled={verrouillee} onClick={() => agir(() => rpc("transition_preparer", { p_source: source.id, p_cible: cible, p_options: o }),
        (r) => t("Année {v0} prête : {v1} matière(s) par classe et {v2} échéance(s) reprises.", { v0: r.cible, v1: r.programme, v2: r.echeances }))}>
        {tr ? t("Mettre à jour la préparation") : t("Préparer la transition")}</button>
      {verrouillee && <div className="small text-muted mt-2">{t("La transition a été appliquée : la préparation ne peut plus être modifiée.")}</div>}
    </div></div>
  )
}

// --- 2. Décisions ---------------------------------------------------------------------------------------------------
function Decisions({ tr, source, reference: r, avecCriteres, setMsg }) {
  const [cle, setCle] = useState(0), [modifs, setModifs] = useState({}), [calcul, setCalcul] = useState(null), [classeFiltre, setClasseFiltre] = useState(""), [occupe, setOccupe] = useState(false)
  const [d, erreur] = useDonnees(async () => {
    const [lignes, inscriptions] = await Promise.all([toutCharger(() => supabase.from("transition_lignes").select("*").eq("transition_id", tr.id)),
      toutCharger(() => supabase.from("inscriptions").select("id, classe_id, eleves(nom, prenom, matricule)").eq("exercice_id", source.id))])
    return { lignes: new Map(lignes.map((l) => [l.inscription_id, l])), inscriptions }
  }, [tr.id, cle])
  const modifiable = tr.statut === "preparation"
  const destLib = (l) => libelleDestination({ classe: r.classes.find((x) => x.id === l.classe_destination_id), niveau: r.niveaux.find((x) => x.id === l.niveau_destination_id),
    serie: r.series.find((x) => x.id === l.serie_destination_id) })
  const mentionAuto = (l) => mentionDe(l.decision, destLib(l), { modeles: r.mentions, t })
  const classesAvec = useMemo(() => (d ? r.classes.filter((c) => d.inscriptions.some((i) => i.classe_id === c.id)) : []), [d, r.classes])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>

  async function analyser() {
    setMsg({}); setCalcul({ fait: 0, total: classesAvec.length })
    try {
      let n = 0
      for (const [k, c] of classesAvec.entries()) {
        const liste = await propositionsClasse(c, r, source, { avecCriteres })
        const lignes = liste.map(({ existante, proposition: p, inscription_id }) => {
          const base = existante?.statut === "validee" ? existante : p
          const l = { inscription_id, decision: base.decision, niveau_destination_id: base.niveau_destination_id || null, serie_destination_id: base.serie_destination_id || null,
            classe_destination_id: base.classe_destination_id || (base.decision === "redoublant" ? c.id : null), source: existante?.statut === "validee" ? "passage_valide" : "calcul" }
          return { ...l, mention: existante?.statut === "validee" && existante.mention ? existante.mention : mentionAuto(l) }
        })
        if (lignes.length) n += await rpc("transition_enregistrer", { p_transition: tr.id, p_lignes: lignes })
        setCalcul({ fait: k + 1, total: classesAvec.length })
      }
      setMsg({ ok: t("{v0} décision(s) proposée(s). Vérifiez-les, corrigez si besoin, puis lancez la simulation.", { v0: n }) })
      setModifs({}); setCle((x) => x + 1)
    } catch (e) { setMsg({ erreur: e.message }) } finally { setCalcul(null) }
  }
  const ligne = (i) => ({ ...(d.lignes.get(i.id) || { inscription_id: i.id, decision: "", classe_destination_id: null, source: "" }), ...(modifs[i.id] || {}) })
  const changer = (i, champs) => { const l = { ...ligne(i), ...champs, source: "manuel" }; setModifs({ ...modifs, [i.id]: { ...modifs[i.id], ...champs, source: "manuel", mention: mentionAuto(l) } }) }
  async function enregistrer() {
    setOccupe(true); setMsg({})
    try {
      const lignes = Object.keys(modifs).map((id) => { const l = ligne({ id }); return { inscription_id: id, decision: l.decision, niveau_destination_id: l.niveau_destination_id || null,
        serie_destination_id: l.serie_destination_id || null, classe_destination_id: l.classe_destination_id || null, mention: l.mention || mentionAuto(l), source: "manuel", motif: l.motif || "" } })
        .filter((l) => l.decision)
      const n = await rpc("transition_enregistrer", { p_transition: tr.id, p_lignes: lignes })
      setMsg({ ok: t("{v0} décision(s) enregistrée(s).", { v0: n }) }); setModifs({}); setCle((x) => x + 1)
    } catch (e) { setMsg({ erreur: e.message }) } finally { setOccupe(false) }
  }
  const liste = d.inscriptions.filter((i) => !classeFiltre || i.classe_id === classeFiltre)
    .sort((a, b) => comparerNoms(r.classes.find((c) => c.id === a.classe_id)?.libelle || "", r.classes.find((c) => c.id === b.classe_id)?.libelle || "") || comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves)))
  return (
    <>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        {modifiable && <button className="btn btn-primary" disabled={!!calcul} onClick={analyser}>
          {calcul ? t("Analyse… {v0}/{v1} classe(s)", { v0: calcul.fait, v1: calcul.total }) : d.lignes.size ? t("Analyser de nouveau tous les élèves") : t("Analyser tous les élèves")}</button>}
        <select className="form-select w-auto" value={classeFiltre} onChange={(e) => setClasseFiltre(e.target.value)} aria-label={t("Classe")}>
          <option value="">{t("Toutes les classes")}</option>{classesAvec.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
        <span className="small text-muted">{t("{v0} élève(s) analysé(s) sur {v1}", { v0: d.lignes.size, v1: d.inscriptions.length })}</span>
        {modifiable && Object.keys(modifs).length > 0 && <button className="btn btn-success ms-auto" disabled={occupe} onClick={enregistrer}>{t("Enregistrer {v0} modification(s)", { v0: Object.keys(modifs).length })}</button>}
      </div>
      {d.lignes.size > 0 && <p className="small text-muted">{t("Une nouvelle analyse remplace les décisions calculées ; les décisions de passage déjà validées sont reprises telles quelles.")}</p>}
      <div className="table-responsive"><table className="table table-sm align-middle tableau-transition">
        <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Décision")}</th><th>{t("Classe de destination")}</th><th>{t("Mention")}</th><th>{t("Origine")}</th></tr></thead>
        <tbody>{liste.map((i) => { const l = ligne(i); return (
          <tr key={i.id} data-eleve={nomComplet(i.eleves)} className={modifs[i.id] ? "table-warning" : ""}>
            <td><strong>{nomComplet(i.eleves)}</strong><div className="small text-muted">{i.eleves.matricule}</div></td>
            <td>{r.classes.find((c) => c.id === i.classe_id)?.libelle}</td>
            <td><select className="form-select form-select-sm" disabled={!modifiable} value={l.decision || ""} onChange={(e) => changer(i, { decision: e.target.value })} aria-label={t("Décision")}>
              <option value="">{t("— à analyser —")}</option>{Object.entries(DECISIONS).map(([k, lib]) => <option key={k} value={k}>{t(lib)}</option>)}</select></td>
            <td><select className="form-select form-select-sm" disabled={!modifiable || !INSCRIT.includes(l.decision)} value={l.classe_destination_id || ""}
              onChange={(e) => { const c = r.classes.find((x) => x.id === e.target.value); changer(i, { classe_destination_id: e.target.value || null, niveau_destination_id: c?.niveau_id || null, serie_destination_id: c?.serie_id || null }) }}
              aria-label={t("Classe de destination")}>
              <option value="">{INSCRIT.includes(l.decision) ? t("à choisir…") : "—"}</option>{r.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></td>
            <td className="small">{l.mention || (l.decision ? mentionAuto(l) : "")}</td>
            <td className="small">{l.source ? t({ passage_valide: "décision validée", calcul: "calcul", manuel: "manuelle" }[l.source]) : ""}</td></tr>) })}
          {!liste.length && <tr><td colSpan={6} className="text-muted text-center py-3">{t("Aucun élève inscrit dans cette année.")}</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// --- 3. Simulation --------------------------------------------------------------------------------------------------
const TYPES_ANOMALIE = { sans_destination: "Sans classe de destination", contradictoire: "Décision contradictoire", deja_inscrit: "Déjà inscrit(e) ailleurs",
  incomplet: "Information incomplète", non_analyse: "Non analysé(e)" }
function Simulation({ tr }) {
  const [cle, setCle] = useState(0)
  const [s, erreur] = useDonnees(() => rpc("transition_simulation", { p_transition: tr.id }), [tr.id, tr.statut, cle])
  if (!s) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const tuiles = [["Élèves analysés", `${s.analyses} / ${s.inscrits}`], ["Promus", s.promus], ["Redoublants", s.redoublants], ["Transferts", s.transferts],
    ["Sortants", s.sortants], ["Décision manuelle à prendre", s.manuels], ["À inscrire en {v0}", s.a_inscrire]]
  return (
    <div className="simulation-transition">
      <div className="row g-2 mb-3">{tuiles.map(([l, v]) => (
        <div className="col-6 col-md-3 col-xl" key={l}><div className="card h-100 tuile-simulation"><div className="card-body py-2">
          <div className="small text-muted">{t(l, { v0: s.cible })}</div><div className="fs-4 fw-semibold">{v}</div></div></div></div>))}</div>
      <div className={`alert ${s.bloquantes ? "alert-danger" : "alert-success"} d-flex flex-wrap align-items-center gap-2`}>
        <span className="me-auto">{s.bloquantes ? t("{v0} anomalie(s) bloquante(s) : corrigez-les dans « Analyser et réviser » avant d'appliquer.", { v0: s.bloquantes })
          : t("Aucune anomalie bloquante : la transition peut être appliquée.")}</span>
        <button className="btn btn-sm btn-outline-dark" onClick={() => setCle((k) => k + 1)}>{t("Relancer la simulation")}</button>
      </div>
      {s.anomalies.length > 0 && <div className="table-responsive"><table className="table table-sm anomalies-transition">
        <thead className="table-light"><tr><th>{t("Type")}</th><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Problème")}</th></tr></thead>
        <tbody>{s.anomalies.map((a, k) => (
          <tr key={k}><td><span className={`badge text-bg-${a.bloquante ? "danger" : "warning"}`}>{t(TYPES_ANOMALIE[a.type] || a.type)}</span></td><td>{a.eleve}</td><td>{a.classe}</td><td className="small">{t(a.probleme)}</td></tr>))}</tbody>
      </table></div>}
    </div>
  )
}

// --- 4. Application et clôture ---------------------------------------------------------------------------------------
function Application({ tr, cible, agir }) {
  const [activer, setActiver] = useState(true)
  const [s] = useDonnees(() => rpc("transition_simulation", { p_transition: tr.id }), [tr.id, tr.statut])
  if (!s) return <Chargement />
  return (
    <div className="card mb-3"><div className="card-body">
      {tr.statut === "preparation" && <>
        <p>{t("L'application inscrit {v0} élève(s) dans l'année {v1}, dans leur classe de destination. Les redoublants sont marqués comme tels.", { v0: s.a_inscrire, v1: s.cible })}</p>
        <button className="btn btn-success" disabled={s.bloquantes > 0}
          onClick={() => confirm(t("Appliquer la transition ? {v0} inscription(s) seront créées dans l'année {v1}.", { v0: s.a_inscrire, v1: s.cible }))
            && agir(() => rpc("transition_appliquer", { p_transition: tr.id }), (r) => t("Transition appliquée : {v0} inscription(s) créée(s).", { v0: r.inscriptions }))}>{t("Appliquer la transition")}</button>
        {s.bloquantes > 0 && <span className="small text-danger ms-2">{t("{v0} anomalie(s) bloquante(s) (voir « Simuler »).", { v0: s.bloquantes })}</span>}
      </>}
      {tr.statut === "appliquee" && <>
        <p>{t("Transition appliquée le {v0} : {v1} élève(s) inscrit(s) en {v2}.", { v0: dateHeure(tr.applique_le), v1: s.inscrits_crees, v2: s.cible })}</p>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button className="btn btn-outline-warning" onClick={() => { const m = prompt(t("Motif du retour arrière (les inscriptions créées seront supprimées) :")); if (m !== null) agir(() => rpc("transition_annuler", { p_transition: tr.id, p_motif: m.trim() }), (n) => t("Retour arrière effectué : {v0} inscription(s) supprimée(s).", { v0: n })) }}>
            {t("Revenir en arrière")}</button>
          <label className="form-check small mb-0 ms-3"><input type="checkbox" className="form-check-input" checked={activer} onChange={(e) => setActiver(e.target.checked)} /> {t("Activer l'année {v0} à la clôture", { v0: cible?.libelle })}</label>
          <button className="btn btn-primary" onClick={() => confirm(t("Clôturer définitivement la transition ? Plus aucun retour arrière ne sera possible, sauf annulation tracée et motivée."))
            && agir(() => rpc("transition_cloturer", { p_transition: tr.id, p_activer: activer }), t("Transition clôturée."))}>{t("Clôturer la transition")}</button>
        </div>
      </>}
      {tr.statut === "cloturee" && <>
        <p>{t("Transition clôturée le {v0}. Elle ne peut plus être modifiée.", { v0: dateHeure(tr.cloture_le) })}</p>
        <button className="btn btn-sm btn-outline-danger" onClick={() => {
          const m = prompt(t("Annulation de la clôture : expliquez précisément la raison (conservée dans le journal) :")); if (m === null) return
          const c = prompt(t("Pour confirmer, saisissez : ANNULER LA CLÔTURE")); if (c === null) return
          agir(() => rpc("transition_rouvrir", { p_transition: tr.id, p_motif: m.trim(), p_confirmation: c }), t("Clôture annulée : la transition est de nouveau modifiable par retour arrière."))
        }}>{t("Annuler la clôture (procédure tracée)")}</button>
      </>}
    </div></div>
  )
}

// --- Rapport, historique, journal -----------------------------------------------------------------------------------
function Rapport({ tr, source, cible, reference: r }) {
  const { etablissement, logoUrl } = useSession()
  const [d, erreur] = useDonnees(async () => {
    const [lignes, inscriptions, sim] = await Promise.all([toutCharger(() => supabase.from("transition_lignes").select("*").eq("transition_id", tr.id)),
      toutCharger(() => supabase.from("inscriptions").select("id, eleves(nom, prenom, matricule)").eq("exercice_id", source.id)), rpc("transition_simulation", { p_transition: tr.id })])
    const noms = new Map(inscriptions.map((i) => [i.id, i.eleves]))
    return { sim, lignes: lignes.map((l) => ({ ...l, el: noms.get(l.inscription_id) })).sort((a, b) => comparerNoms(nomDe(r, a.classe_origine_id), nomDe(r, b.classe_origine_id)) || comparerNoms(nomComplet(a.el), nomComplet(b.el))) }
  }, [tr.id, tr.statut])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const ligne = (l) => [nomComplet(l.el), l.el?.matricule || "", nomDe(r, l.classe_origine_id), t(DECISIONS[l.decision]), nomDe(r, l.classe_destination_id) || "—", l.mention, l.inscription_creee_id ? t("inscrit(e)") : "—"]
  const entetes = [t("Élève"), t("Matricule"), t("Classe"), t("Décision"), t("Classe de destination"), t("Mention"), t("Inscription")]
  const resume = [[t("Élèves analysés"), d.sim.analyses], [t("Promus"), d.sim.promus], [t("Redoublants"), d.sim.redoublants], [t("Transferts"), d.sim.transferts],
    [t("Sortants"), d.sim.sortants], [t("Décision manuelle à prendre"), d.sim.manuels], [t("Inscriptions créées"), d.sim.inscrits_crees]]
  const titre = t("Rapport de transition {v0} → {v1}", { v0: source.libelle, v1: cible?.libelle })
  return (
    <div className="rapport-transition">
      <div className="d-flex gap-2 mb-3">
        <button className="btn btn-outline-primary btn-sm" onClick={() => listePdf({ etablissement, logoUrl, titre, sousTitre: resume.map(([k, v]) => `${k} : ${v}`).join(" · "),
          colonnes: entetes.map((x) => ({ titre: x })), lignes: d.lignes.map(ligne) }, nomDeFichier(t("rapport transition"), source.libelle, cible?.libelle || ""))}>PDF</button>
        <button className="btn btn-outline-success btn-sm" onClick={() => telechargerClasseur([{ titre: t("Synthèse"), intitule: titre, entetes: [t("Indicateur"), t("Nombre")], lignes: resume },
          { titre: t("Élèves"), intitule: titre, entetes, lignes: d.lignes.map(ligne) }], nomDeFichier(t("rapport transition"), source.libelle, cible?.libelle || ""))}>Excel</button>
      </div>
      <div className="row g-2 mb-3">{resume.map(([k, v]) => <div className="col-6 col-md-3" key={k}><div className="border rounded p-2"><div className="small text-muted">{k}</div><div className="fw-semibold fs-5">{v}</div></div></div>)}</div>
      <div className="small text-muted">{t("{v0} ligne(s) dans le rapport détaillé (PDF ou Excel).", { v0: d.lignes.length })}</div>
    </div>
  )
}
const nomDe = (r, id) => r.classes.find((c) => c.id === id)?.libelle || ""

function Historique({ reference: r }) {
  const [q, setQ] = useState(""), [choisi, setChoisi] = useState(null)
  const [eleves] = useDonnees(() => toutCharger(() => supabase.from("eleves").select("id, nom, prenom, matricule")), [])
  const [h] = useDonnees(async () => {
    if (!choisi) return null
    const [ins, lignes] = await Promise.all([supabase.from("inscriptions").select("id, exercice_id, classe_id, redoublant, nouveau").eq("eleve_id", choisi.id).then(verifier),
      supabase.from("transition_lignes").select("*").eq("eleve_id", choisi.id).then(verifier)])
    return { ins, lignes }
  }, [choisi?.id])
  const f = q.trim().toLowerCase(), res = f.length >= 2 ? (eleves || []).filter((e) => `${nomComplet(e)} ${e.matricule}`.toLowerCase().includes(f)).slice(0, 8) : []
  const annee = (id) => r.exercices.find((x) => x.id === id)?.libelle || ""
  return (
    <div className="historique-transition">
      <div className="position-relative mb-3" style={{ maxWidth: 420 }}>
        <input className="form-control" placeholder={t("Nom ou matricule de l'élève…")} value={q} onChange={(e) => { setQ(e.target.value); setChoisi(null) }} aria-label={t("Rechercher un élève")} />
        {res.length > 0 && !choisi && <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>{res.map((e) => (
          <button key={e.id} type="button" className="list-group-item list-group-item-action small" onClick={() => { setChoisi(e); setQ(nomComplet(e)) }}>{nomComplet(e)} <span className="text-muted">· {e.matricule}</span></button>))}</div>}
      </div>
      {choisi && !h && <Chargement />}
      {h && <table className="table table-sm"><thead className="table-light"><tr><th>{t("Année scolaire")}</th><th>{t("Classe")}</th><th>{t("Décision de fin d'année")}</th></tr></thead>
        <tbody>{[...h.ins].sort((a, b) => annee(a.exercice_id).localeCompare(annee(b.exercice_id))).map((i) => { const l = h.lignes.find((x) => x.inscription_id === i.id); return (
          <tr key={i.id}><td>{annee(i.exercice_id)}</td><td>{nomDe(r, i.classe_id)}{i.redoublant && <span className="badge text-bg-warning ms-1">{t("redoublant(e)")}</span>}</td>
            <td>{l ? `${t(DECISIONS[l.decision])}${l.mention ? ` — ${l.mention}` : ""}` : "—"}</td></tr>) })}</tbody></table>}
    </div>
  )
}

const ACTIONS = { preparation: "Préparation", decisions_enregistrees: "Décisions enregistrées", application: "Transition appliquée", retour_arriere: "Retour arrière",
  cloture: "Clôture", annulation_cloture: "Annulation de la clôture" }
function Journal({ tr }) {
  const [j] = useDonnees(() => supabase.from("transitions_journal").select("*").eq("transition_id", tr.id).order("le", { ascending: false }).then(verifier), [tr.id, tr.statut])
  if (!j) return <Chargement />
  return (
    <ul className="list-unstyled small journal-transition">{j.map((x) => (
      <li key={x.id} className="border-bottom py-1"><span className="text-muted">{dateHeure(x.le)}</span> · <strong>{t(ACTIONS[x.action] || x.action)}</strong>
        {x.details?.nombre !== undefined && <> · {t("{v0} élève(s)", { v0: x.details.nombre })}</>}
        {x.details?.inscriptions !== undefined && <> · {t("{v0} inscription(s)", { v0: x.details.inscriptions })}</>}
        {x.motif && <> · <em>{x.motif}</em></>}</li>))}</ul>
  )
}
