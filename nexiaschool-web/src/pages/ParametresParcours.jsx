// Paramètres → Parcours et orientation (administration) :
//  1. Structure : cycles, niveaux, filières, séries, options, rattachement des classes
//  2. Règles de passage : origine → destination, conditions d'accès, classes de destination, mentions
//  3. Orientations : choix de série, demandes des parents (acceptation / refus motivé), changements de série, historique
//  4. Décisions de passage : proposition par classe, correction, validation ; mention officielle du bulletin annuel
//  5. Listes d'affectation : par série, par classe de destination, par cycle (PDF, Excel)
import { useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { DECISIONS, MENTIONS_DEFAUT, SOUS_SYSTEMES, TYPES_REGLE, libelleDestination, mentionDe } from "../lib/parcours.js"
import { propositionsClasse } from "../lib/donneesParcours.js"
import { listePdf } from "../lib/financePdf.js"
import { telechargerClasseur } from "../lib/excel.js"
import { nomDeFichier } from "../lib/bulletinPdf.js"
import { comparerNoms, dateHeure, nomComplet, note } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const STATUTS_ORIENTATION = { en_attente: ["En attente", "warning"], acceptee: ["Acceptée", "success"], refusee: ["Refusée", "danger"], annulee: ["Annulée", "secondary"], remplacee: ["Remplacée", "secondary"] }
const TYPES_ORIENTATION = { choix_serie: "Choix de série", demande_orientation: "Demande d'orientation", changement_serie: "Changement de série" }

export default function ParametresParcours() {
  const { exercice } = useSession()
  const [vue, setVue] = useState("structure")
  const [ref, erreur, recharger] = useDonnees(async () => {
    const lire = (table, ordre = "libelle") => supabase.from(table).select("*").order(ordre).then(verifier)
    const [cycles, niveaux, filieres, series, options, classes, regles, config, matieres, sections] = await Promise.all([
      lire("cycles", "ordre"), lire("niveaux", "ordre"), lire("filieres"), lire("series", "code"), lire("options_scolaires"),
      supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier), lire("regles_passage", "ordre"),
      supabase.from("parcours_config").select("*").maybeSingle().then(verifier), lire("matieres"), lire("sections")])
    const enAttente = await rpc("orientations_en_attente", {}).catch(() => 0)
    const inscriptions = exercice ? await toutCharger(() => supabase.from("inscriptions").select("id, classe_id, eleve_id, eleves(nom, prenom, matricule)").eq("exercice_id", exercice.id)) : []
    return { cycles, niveaux, filieres, series, options, classes, regles, mentions: config?.mentions || {}, matieres, sections, inscriptions, enAttente }
  }, [exercice?.id])
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <div className="parcours">
      <p className="text-muted small">{t("Créez vos cycles, niveaux, filières, séries et options (enseignement général, technique ou anglophone), définissez les règles de passage entre niveaux, traitez les choix et demandes d'orientation, puis validez les décisions de passage : la mention du bulletin annuel (« Promu(e) en 2nde C », « Redoublant(e) »…) en découle automatiquement.")}</p>
      <ul className="nav nav-pills mb-3">
        {[["structure", "Structure"], ["regles", "Règles de passage"], ["orientations", "Orientations"], ["decisions", "Décisions de passage"], ["listes", "Listes d'affectation"]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => setVue(k)}>{t(l)}
            {k === "orientations" && ref.enAttente > 0 && <span className="badge text-bg-danger ms-1" title={t("Demandes en attente")}>{ref.enAttente}</span>}</button></li>))}
      </ul>
      {vue === "structure" && <Structure reference={ref} recharger={recharger} />}
      {vue === "regles" && <Regles reference={ref} recharger={recharger} />}
      {vue === "orientations" && <Orientations reference={ref} recharger={recharger} />}
      {vue === "decisions" && (exercice ? <Decisions reference={ref} /> : <div className="alert alert-warning">{t("Activez d'abord un exercice.")}</div>)}
      {vue === "listes" && <Listes reference={ref} />}
    </div>
  )
}

const nomDe = (liste, id, champ = "libelle") => liste.find((x) => x.id === id)?.[champ] || ""

// --- 1. Structure ------------------------------------------------------------------------------------------
function Liste({ titre, table, lignes, champs, vide, recharger, aide }) {
  const [f, setF] = useState(vide), [msg, setMsg] = useState("")
  async function enregistrer(e) {
    e.preventDefault(); setMsg("")
    const valeurs = Object.fromEntries(champs.map((c) => [c.cle, c.type === "nombre" ? Number(f[c.cle] || 0) : c.type === "case" ? !!f[c.cle] : (f[c.cle] === "" && c.options ? null : f[c.cle])]))
    try { verifier(f.id ? await supabase.from(table).update(valeurs).eq("id", f.id) : await supabase.from(table).insert(valeurs)); setF(vide); recharger() }
    catch (x) { setMsg(/duplicate|unique/i.test(x.message) ? t("Cet élément existe déjà.") : x.message) }
  }
  async function supprimer(l) {
    if (!confirm(t("Supprimer « {v0} » ?", { v0: l.libelle || l.code }))) return
    try { verifier(await supabase.from(table).delete().eq("id", l.id)); recharger() } catch (x) { setMsg(x.message) }
  }
  return (
    <div className="card h-100 liste-parcours" data-table={table}><div className="card-body">
      <h2 className="h6">{titre}</h2>{aide && <p className="small text-muted">{aide}</p>}
      <Alerte onFermer={() => setMsg("")}>{msg}</Alerte>
      <ul className="list-unstyled small mb-2">{lignes.map((l) => (
        <li key={l.id} className="d-flex gap-2 align-items-center border-bottom py-1">
          <span className="me-auto">{champs.filter((c) => c.affiche !== false).map((c) => {
            const v = l[c.cle]; if (v === null || v === undefined || v === "" || v === false) return null
            return <span key={c.cle} className={c.principal ? "fw-semibold me-1" : "text-muted me-1"}>{c.options ? (c.options.find((o) => o[0] === v)?.[1] || "") : c.type === "case" ? `· ${c.libelle}` : v}</span>
          })}</span>
          <button className="btn btn-sm btn-link p-0" onClick={() => setF({ ...vide, ...Object.fromEntries(champs.map((c) => [c.cle, l[c.cle] ?? vide[c.cle]])), id: l.id })}>{t("Modifier")}</button>
          <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => supprimer(l)}>{t("Supprimer")}</button></li>))}
        {!lignes.length && <li className="text-muted">{t("Aucun élément.")}</li>}</ul>
      <form className="d-flex flex-wrap gap-2 align-items-center" onSubmit={enregistrer}>
        {champs.map((c) => c.options
          ? <select key={c.cle} className="form-select form-select-sm w-auto" value={f[c.cle] ?? ""} onChange={(e) => setF({ ...f, [c.cle]: e.target.value })} aria-label={c.libelle} required={c.requis}>
              {!c.requis && <option value="">{c.libelle}…</option>}{c.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          : c.type === "case" ? <label key={c.cle} className="form-check small mb-0"><input type="checkbox" className="form-check-input" checked={!!f[c.cle]} onChange={(e) => setF({ ...f, [c.cle]: e.target.checked })} /> {c.libelle}</label>
          : <input key={c.cle} className="form-control form-control-sm" style={{ maxWidth: c.type === "nombre" ? 80 : 190 }} type={c.type === "nombre" ? "number" : "text"} required={c.requis}
                   maxLength={c.max} placeholder={c.libelle} aria-label={c.libelle} value={f[c.cle] ?? ""} onChange={(e) => setF({ ...f, [c.cle]: e.target.value })} />)}
        <button className="btn btn-sm btn-primary">{f.id ? t("Enregistrer") : t("Ajouter")}</button>
        {f.id && <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setF(vide)}>{t("Annuler")}</button>}
      </form>
    </div></div>
  )
}

/** Cycles et niveaux déduits des classes existantes (champ « cycle » 1/2 et libellé « niveau » des classes). */
export function structureDepuisClasses(classes, cycles, niveaux) {
  const libelleCycle = (n) => (n === 1 ? "Premier cycle" : n === 2 ? "Second cycle" : `Cycle ${n}`)
  const cyclesExistants = new Set(cycles.map((c) => c.libelle.trim().toLowerCase()))
  const nouveauxCycles = [...new Set(classes.map((c) => c.cycle).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b)
    .map((n) => ({ libelle: libelleCycle(n), ordre: n })).filter((c) => !cyclesExistants.has(c.libelle.toLowerCase()))
  const niveauxExistants = new Set(niveaux.map((x) => x.libelle.trim().toLowerCase()))
  const parNiveau = new Map()
  for (const c of classes) {
    const l = String(c.niveau || "").trim()
    if (l && !niveauxExistants.has(l.toLowerCase()) && !parNiveau.has(l.toLowerCase())) parNiveau.set(l.toLowerCase(), { libelle: l, cycle: c.cycle, ordre: c.ordre ?? 0 })
  }
  return { nouveauxCycles, nouveauxNiveaux: [...parNiveau.values()], libelleCycle, sansNiveau: classes.filter((c) => !c.niveau_id && String(c.niveau || "").trim()) }
}

function Structure({ reference: r, recharger }) {
  const [msg, setMsg] = useState(""), [ok, setOk] = useState(""), [enCours, setEnCours] = useState(false)
  const sousSystemes = Object.entries(SOUS_SYSTEMES).map(([k, l]) => [k, t(l)])
  async function rattacher(classe, champ, valeur) {
    setMsg("")
    try { verifier(await supabase.from("classes").update({ [champ]: valeur || null }).eq("id", classe.id)); recharger() } catch (e) { setMsg(e.message) }
  }
  const proposition = structureDepuisClasses(r.classes, r.cycles, r.niveaux)
  const aCreer = proposition.nouveauxCycles.length + proposition.nouveauxNiveaux.length + proposition.sansNiveau.length
  // crée les cycles et niveaux manquants à partir des classes, puis rattache chaque classe à son niveau (rien n'est supprimé)
  async function depuisClasses() {
    if (!confirm(t("Créer {v0} cycle(s) et {v1} niveau(x) à partir des classes existantes, puis rattacher {v2} classe(s) à leur niveau ?",
      { v0: proposition.nouveauxCycles.length, v1: proposition.nouveauxNiveaux.length, v2: proposition.sansNiveau.length }))) return
    setMsg(""); setOk(""); setEnCours(true)
    try {
      const cyclesCrees = proposition.nouveauxCycles.length ? verifier(await supabase.from("cycles").insert(proposition.nouveauxCycles.map((c) => ({ libelle: c.libelle, ordre: c.ordre }))).select()) : []
      const tousCycles = [...r.cycles, ...cyclesCrees]
      const cycleDe = (n) => tousCycles.find((c) => c.libelle.toLowerCase() === proposition.libelleCycle(n).toLowerCase())?.id || null
      const niveauxCrees = proposition.nouveauxNiveaux.length ? verifier(await supabase.from("niveaux").insert(proposition.nouveauxNiveaux.map((n) => ({
        libelle: n.libelle, ordre: n.ordre, cycle_id: Number.isInteger(n.cycle) ? cycleDe(n.cycle) : null }))).select()) : []
      const tousNiveaux = new Map([...r.niveaux, ...niveauxCrees].map((n) => [n.libelle.trim().toLowerCase(), n.id]))
      let rattachees = 0
      for (const c of proposition.sansNiveau) {
        const id = tousNiveaux.get(String(c.niveau).trim().toLowerCase())
        if (id) { verifier(await supabase.from("classes").update({ niveau_id: id }).eq("id", c.id)); rattachees++ }
      }
      setOk(t("{v0} cycle(s) et {v1} niveau(x) créés ; {v2} classe(s) rattachée(s) à leur niveau. Vérifiez l'ordre des niveaux et cochez « fin de cycle » si nécessaire.",
        { v0: cyclesCrees.length, v1: niveauxCrees.length, v2: rattachees }))
      recharger()
    } catch (e) { setMsg(e.message) } finally { setEnCours(false) }
  }
  return (
    <>
      <Alerte type="success" onFermer={() => setOk("")}>{ok}</Alerte><Alerte onFermer={() => setMsg("")}>{msg}</Alerte>
      {aCreer > 0 && <div className="alert alert-info d-flex flex-wrap gap-2 align-items-center small">
        <span className="me-auto">{t("Vos classes indiquent déjà des cycles et des niveaux qui ne figurent pas encore ici ({v0} cycle(s), {v1} niveau(x), {v2} classe(s) à rattacher). Les filtres des PV les utilisent, mais la transition d'année et les règles de passage ont besoin de cette structure.",
          { v0: proposition.nouveauxCycles.length, v1: proposition.nouveauxNiveaux.length, v2: proposition.sansNiveau.length })}</span>
        <button type="button" className="btn btn-sm btn-primary" disabled={enCours} onClick={depuisClasses}>{enCours ? t("Création…") : t("Créer à partir des classes")}</button>
      </div>}
      <div className="row g-3 mb-3">
        <div className="col-lg-6"><Liste titre={t("Cycles")} table="cycles" lignes={r.cycles} recharger={recharger} vide={{ libelle: "", ordre: "" }}
          aide={t("Ex. Premier cycle, Second cycle, Cycle d'observation…")}
          champs={[{ cle: "libelle", libelle: t("Nom"), requis: true, max: 60, principal: true }, { cle: "ordre", libelle: t("Ordre"), type: "nombre", affiche: false }]} /></div>
        <div className="col-lg-6"><Liste titre={t("Niveaux")} table="niveaux" lignes={r.niveaux} recharger={recharger} vide={{ libelle: "", cycle_id: "", sous_systeme: "general", ordre: "", fin_de_cycle: false }}
          aide={t("Ex. 6e, 3e, 2nde, 1re, Form 1… L'ordre sert à proposer les passages ; « fin de cycle » marque la dernière classe d'un cycle.")}
          champs={[{ cle: "libelle", libelle: t("Niveau"), requis: true, max: 40, principal: true }, { cle: "cycle_id", libelle: t("Cycle"), options: r.cycles.map((c) => [c.id, c.libelle]) },
            { cle: "sous_systeme", libelle: t("Sous-système"), options: sousSystemes, requis: true }, { cle: "ordre", libelle: t("Ordre"), type: "nombre", affiche: false },
            { cle: "fin_de_cycle", libelle: t("fin de cycle"), type: "case" }]} /></div>
        <div className="col-lg-6"><Liste titre={t("Filières")} table="filieres" lignes={r.filieres} recharger={recharger} vide={{ libelle: "", sous_systeme: "general" }}
          aide={t("Ex. Enseignement général, Technique industriel, Technique commercial, Grammar…")}
          champs={[{ cle: "libelle", libelle: t("Filière"), requis: true, max: 80, principal: true }, { cle: "sous_systeme", libelle: t("Sous-système"), options: sousSystemes, requis: true }]} /></div>
        <div className="col-lg-6"><Liste titre={t("Séries et spécialités")} table="series" lignes={r.series} recharger={recharger} vide={{ code: "", libelle: "", filiere_id: "" }}
          aide={t("Code court affiché dans les mentions (ex. « A4 esp », « C », « D ») et libellé complet.")}
          champs={[{ cle: "code", libelle: t("Code"), requis: true, max: 20, principal: true }, { cle: "libelle", libelle: t("Libellé"), requis: true, max: 80 },
            { cle: "filiere_id", libelle: t("Filière"), options: r.filieres.map((f) => [f.id, f.libelle]) }]} /></div>
        <div className="col-lg-6"><Liste titre={t("Options")} table="options_scolaires" lignes={r.options} recharger={recharger} vide={{ libelle: "" }}
          aide={t("Ex. Espagnol, Allemand, Informatique.")} champs={[{ cle: "libelle", libelle: t("Option"), requis: true, max: 60, principal: true }]} /></div>
      </div>
      <div className="card mb-4"><div className="card-body">
        <h2 className="h6">{t("Rattachement des classes")}</h2>
        <div className="table-responsive"><table className="table table-sm align-middle mb-0 rattachement-classes">
          <thead className="table-light"><tr><th>{t("Classe")}</th><th>{t("Niveau")}</th><th>{t("Filière")}</th><th>{t("Série")}</th><th>{t("Section")}</th></tr></thead>
          <tbody>{r.classes.map((c) => (
            <tr key={c.id} data-classe={c.libelle}><td className="fw-semibold">{c.libelle}</td>
              {[["niveau_id", r.niveaux.map((x) => [x.id, x.libelle])], ["filiere_id", r.filieres.map((x) => [x.id, x.libelle])], ["serie_id", r.series.map((x) => [x.id, `${x.code} — ${x.libelle}`])]].map(([champ, opts]) => (
                <td key={champ}><select className="form-select form-select-sm" value={c[champ] || ""} onChange={(e) => rattacher(c, champ, e.target.value)} aria-label={`${c.libelle} : ${champ}`}>
                  <option value="">—</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>))}
              <td className="small text-muted">{nomDe(r.sections, c.section_id)}</td></tr>))}
            {!r.classes.length && <tr><td colSpan={5} className="text-muted">{t("Aucune classe.")}</td></tr>}</tbody>
        </table></div>
      </div></div>
    </>
  )
}

// --- 2. Règles de passage -----------------------------------------------------------------------------------
const REGLE_VIDE = { niveau_origine_id: "", serie_origine_id: "", niveau_destination_id: "", serie_destination_id: "", filiere_destination_id: "", type: "promotion",
  conditions: { decision: "admis", moyenne_min: "", matieres: [] }, classes_destination: [], sur_demande: false, mention: "", ordre: 0, active: true }

function Regles({ reference: r, recharger }) {
  const [f, setF] = useState(null), [msg, setMsg] = useState({}), [mentions, setMentions] = useState(r.mentions)
  const libRegle = (x) => `${nomDe(r.niveaux, x.niveau_origine_id)}${x.serie_origine_id ? ` ${nomDe(r.series, x.serie_origine_id, "code")}` : ""} → ${libelleDestination({
    niveau: r.niveaux.find((n) => n.id === x.niveau_destination_id), serie: r.series.find((s) => s.id === x.serie_destination_id), filiere: r.filieres.find((s) => s.id === x.filiere_destination_id) })}`
  async function enregistrer(e) {
    e.preventDefault(); setMsg({})
    const c = f.conditions
    const valeurs = { ...f, serie_origine_id: f.serie_origine_id || null, serie_destination_id: f.serie_destination_id || null, filiere_destination_id: f.filiere_destination_id || null,
      conditions: { decision: c.decision || "admis", ...(c.moyenne_min !== "" && c.moyenne_min !== null && c.moyenne_min !== undefined ? { moyenne_min: Number(c.moyenne_min) } : {}),
        matieres: (c.matieres || []).filter((m) => m.code && m.min !== "").map((m) => ({ code: m.code, min: Number(m.min) })) }, ordre: Number(f.ordre || 0) }
    delete valeurs.id
    try { verifier(f.id ? await supabase.from("regles_passage").update(valeurs).eq("id", f.id) : await supabase.from("regles_passage").insert(valeurs)); setF(null); setMsg({ ok: t("Règle enregistrée.") }); recharger() }
    catch (x) { setMsg({ erreur: x.message }) }
  }
  async function supprimer(x) {
    if (!confirm(t("Supprimer la règle « {v0} » ?", { v0: libRegle(x) }))) return
    try { verifier(await supabase.from("regles_passage").delete().eq("id", x.id)); recharger() } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function enregistrerMentions() {
    setMsg({})
    const m = Object.fromEntries(Object.entries(mentions).filter(([, v]) => v && v.trim()))
    try { verifier(await supabase.from("parcours_config").upsert({ mentions: m }, { onConflict: "etablissement_id" })); setMsg({ ok: t("Mentions enregistrées.") }); recharger() }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  const c = f?.conditions || {}
  const classesDest = f ? r.classes.filter((x) => x.niveau_id === f.niveau_destination_id && (!f.serie_destination_id || x.serie_id === f.serie_destination_id)) : []
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      {!r.niveaux.length && <div className="alert alert-info small">{t("Créez d'abord vos niveaux (onglet « Structure ») et rattachez-y vos classes.")}</div>}
      {!f && <>
        <button className="btn btn-primary mb-3" disabled={!r.niveaux.length} onClick={() => setF(REGLE_VIDE)}>＋ {t("Nouvelle règle de passage")}</button>
        <div className="table-responsive mb-3"><table className="table table-sm align-middle tableau-regles">
          <thead className="table-light"><tr><th>{t("Passage")}</th><th>{t("Type")}</th><th>{t("Conditions")}</th><th>{t("Classes de destination")}</th><th>{t("Mention")}</th><th /></tr></thead>
          <tbody>{r.regles.map((x) => (
            <tr key={x.id} className={x.active ? "" : "opacity-50"}><td className="fw-semibold">{libRegle(x)}{x.sur_demande && <span className="badge text-bg-info ms-1">{t("sur orientation")}</span>}</td>
              <td className="small">{t(TYPES_REGLE[x.type])}</td>
              <td className="small">{[x.conditions?.decision === "tous" ? t("toute décision") : x.conditions?.decision === "rattrapage" ? t("admis ou rattrapage") : t("admis(e)"),
                x.conditions?.moyenne_min !== undefined && t("moyenne ≥ {v0}", { v0: note(x.conditions.moyenne_min) }),
                ...(x.conditions?.matieres || []).map((m) => `${m.code} ≥ ${note(m.min)}`)].filter(Boolean).join(" · ")}</td>
              <td className="small">{x.classes_destination?.length ? x.classes_destination.map((id) => nomDe(r.classes, id)).join(", ") : t("toutes")}</td>
              <td className="small text-muted">{x.mention || "—"}</td>
              <td className="text-end text-nowrap"><button className="btn btn-sm btn-link" onClick={() => setF({ ...REGLE_VIDE, ...x, serie_origine_id: x.serie_origine_id || "", serie_destination_id: x.serie_destination_id || "",
                filiere_destination_id: x.filiere_destination_id || "", conditions: { ...REGLE_VIDE.conditions, ...x.conditions, moyenne_min: x.conditions?.moyenne_min ?? "" } })}>{t("Modifier")}</button>
                <button className="btn btn-sm btn-link text-danger" onClick={() => supprimer(x)}>{t("Supprimer")}</button></td></tr>))}
            {!r.regles.length && <tr><td colSpan={6} className="text-muted text-center py-3">{t("Aucune règle de passage.")}</td></tr>}</tbody>
        </table></div>
        <div className="card mb-4"><div className="card-body">
          <h2 className="h6">{t("Mentions du bulletin annuel")}</h2>
          <p className="small text-muted">{t("Libellés générés à partir de la décision ; {destination} est remplacé par la classe, ou le niveau et la série de destination. Laissez vide pour le libellé par défaut.")}</p>
          <div className="row g-2">{Object.keys(MENTIONS_DEFAUT).map((k) => (
            <div className="col-md-6 col-xl-4" key={k}><label className="form-label small mb-0" htmlFor={`m-${k}`}>{t(DECISIONS[k])}</label>
              <input id={`m-${k}`} className="form-control form-control-sm" maxLength={120} placeholder={t(MENTIONS_DEFAUT[k])} value={mentions[k] || ""} onChange={(e) => setMentions({ ...mentions, [k]: e.target.value })} /></div>))}</div>
          <button className="btn btn-sm btn-primary mt-2" onClick={enregistrerMentions}>{t("Enregistrer les mentions")}</button>
        </div></div>
      </>}
      {f && <form className="card mb-4 editeur-regle" onSubmit={enregistrer}><div className="card-body">
        <div className="row g-2">
          {[["niveau_origine_id", t("Niveau d'origine"), r.niveaux, true], ["serie_origine_id", t("Série d'origine (facultatif)"), r.series, false],
            ["niveau_destination_id", t("Niveau de destination"), r.niveaux, true], ["serie_destination_id", t("Série de destination (facultatif)"), r.series, false],
            ["filiere_destination_id", t("Filière de destination (facultatif)"), r.filieres, false]].map(([k, l, liste, requis]) => (
            <div className="col-md-4" key={k}><label className="form-label small mb-0" htmlFor={`r-${k}`}>{l}</label>
              <select id={`r-${k}`} className="form-select form-select-sm" required={requis} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value, ...(k.includes("destination") ? { classes_destination: [] } : {}) })}>
                <option value="">{requis ? `${t("Choisir")}…` : t("— toutes / aucune —")}</option>
                {liste.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} — ${x.libelle}` : x.libelle}</option>)}</select></div>))}
          <div className="col-md-4"><label className="form-label small mb-0" htmlFor="r-type">{t("Type de passage")}</label>
            <select id="r-type" className="form-select form-select-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {Object.entries(TYPES_REGLE).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
        </div>
        <h3 className="h6 mt-3">{t("Conditions d'accès")}</h3>
        <div className="row g-2 align-items-end">
          <div className="col-md-4"><label className="form-label small mb-0" htmlFor="r-dec">{t("Décision de fin d'année requise")}</label>
            <select id="r-dec" className="form-select form-select-sm" value={c.decision || "admis"} onChange={(e) => setF({ ...f, conditions: { ...c, decision: e.target.value } })}>
              <option value="admis">{t("Admis(e)")}</option><option value="rattrapage">{t("Admis(e) ou rattrapage")}</option><option value="tous">{t("Toute décision")}</option></select></div>
          <div className="col-md-3"><label className="form-label small mb-0" htmlFor="r-moy">{t("Moyenne annuelle ≥")}</label>
            <input id="r-moy" type="number" min={0} max={20} step="0.25" className="form-control form-control-sm" value={c.moyenne_min ?? ""} onChange={(e) => setF({ ...f, conditions: { ...c, moyenne_min: e.target.value } })} /></div>
          <div className="col-md-5">
            {(c.matieres || []).map((m, k) => (
              <div className="d-flex gap-1 mb-1" key={k}>
                <select className="form-select form-select-sm" value={m.code} onChange={(e) => setF({ ...f, conditions: { ...c, matieres: c.matieres.map((y, i) => (i === k ? { ...y, code: e.target.value } : y)) } })} aria-label={t("Matière")}>
                  <option value="">{t("Matière…")}</option>{r.matieres.map((x) => <option key={x.code} value={x.code}>{x.libelle}</option>)}</select>
                <input type="number" min={0} max={20} step="0.25" className="form-control form-control-sm" style={{ maxWidth: 80 }} placeholder="≥" value={m.min}
                  onChange={(e) => setF({ ...f, conditions: { ...c, matieres: c.matieres.map((y, i) => (i === k ? { ...y, min: e.target.value } : y)) } })} aria-label={t("Note minimale")} />
                <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setF({ ...f, conditions: { ...c, matieres: c.matieres.filter((_, i) => i !== k) } })}>×</button></div>))}
            <button type="button" className="btn btn-sm btn-link px-0" onClick={() => setF({ ...f, conditions: { ...c, matieres: [...(c.matieres || []), { code: "", min: "" }] } })}>＋ {t("Note minimale dans une matière")}</button></div>
        </div>
        <label className="form-check small mt-2"><input type="checkbox" className="form-check-input" checked={f.sur_demande} onChange={(e) => setF({ ...f, sur_demande: e.target.checked })} />{" "}
          {t("Réservée aux élèves dont l'orientation vers cette destination est acceptée (choix de série ou demande)")}</label>
        <h3 className="h6 mt-3">{t("Classes de destination possibles")} <span className="small text-muted fw-normal">{t("(aucune cochée = toutes)")}</span></h3>
        <div className="d-flex flex-wrap gap-3 small">{classesDest.map((x) => (
          <label key={x.id} className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={f.classes_destination.includes(x.id)}
            onChange={(e) => setF({ ...f, classes_destination: e.target.checked ? [...f.classes_destination, x.id] : f.classes_destination.filter((y) => y !== x.id) })} /> {x.libelle}</label>))}
          {!classesDest.length && <span className="text-muted">{t("Aucune classe rattachée à ce niveau (et cette série).")}</span>}</div>
        <div className="row g-2 mt-2">
          <div className="col-md-8"><label className="form-label small mb-0" htmlFor="r-mention">{t("Mention (facultatif)")}</label>
            <input id="r-mention" className="form-control form-control-sm" maxLength={120} placeholder={t("Promu(e) en {destination}")} value={f.mention} onChange={(e) => setF({ ...f, mention: e.target.value })} /></div>
          <div className="col-md-2"><label className="form-label small mb-0" htmlFor="r-ordre">{t("Ordre")}</label>
            <input id="r-ordre" type="number" className="form-control form-control-sm" value={f.ordre} onChange={(e) => setF({ ...f, ordre: e.target.value })} /></div>
          <div className="col-md-2 d-flex align-items-end"><label className="form-check small mb-0"><input type="checkbox" className="form-check-input" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {t("Active")}</label></div>
        </div>
        <div className="d-flex gap-2 mt-3"><button className="btn btn-primary">{t("Enregistrer la règle")}</button><button type="button" className="btn btn-outline-secondary" onClick={() => setF(null)}>{t("Annuler")}</button></div>
      </div></form>}
    </>
  )
}

// --- 3. Orientations ---------------------------------------------------------------------------------------------
function Orientations({ reference: r, recharger }) {
  const [cle, setCle] = useState(0), [filtre, setFiltre] = useState("en_attente"), [msg, setMsg] = useState({}), [f, setF] = useState(null), [q, setQ] = useState("")
  const [d, erreur] = useDonnees(async () => toutCharger(() => supabase.from("orientations").select("*").order("cree_le", { ascending: false })), [cle])
  const eleves = useMemo(() => new Map(r.inscriptions.map((i) => [i.id, i])), [r.inscriptions])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const agir = async (fn, ok) => { setMsg({}); try { await fn(); setMsg({ ok }); setCle((k) => k + 1); recharger() } catch (e) { setMsg({ erreur: e.message }) } }
  const destination = (o) => libelleDestination({ classe: r.classes.find((x) => x.id === o.classe_id), niveau: r.niveaux.find((x) => x.id === o.niveau_id),
    serie: r.series.find((x) => x.id === o.serie_id), filiere: r.filieres.find((x) => x.id === o.filiere_id) }) || "—"
  const nomEleve = (o) => { const i = eleves.get(o.inscription_id); return i ? nomComplet(i.eleves) : "?" }
  const liste = d.filter((o) => filtre === "toutes" || o.statut === filtre)
  const recherche = q.trim().length >= 2 ? r.inscriptions.filter((i) => `${nomComplet(i.eleves)} ${i.eleves.matricule}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <select className="form-select w-auto" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label={t("Statut")}>
          {[["en_attente", "En attente"], ["acceptee", "Acceptées"], ["refusee", "Refusées"], ["toutes", "Toutes (historique)"]].map(([k, l]) => (
            <option key={k} value={k}>{t(l)} ({k === "toutes" ? d.length : d.filter((o) => o.statut === k).length})</option>))}</select>
        <button className="btn btn-outline-primary" onClick={() => setF({ inscription_id: "", type: "choix_serie", niveau_id: "", serie_id: "", filiere_id: "", classe_id: "", motif: "" })}>＋ {t("Enregistrer un choix ou un changement de série")}</button>
      </div>
      {f && <form className="card mb-3 saisie-orientation" onSubmit={(e) => { e.preventDefault(); agir(async () => { await rpc("orientation_enregistrer", { p: f }); setF(null) }, t("Orientation enregistrée.")) }}><div className="card-body">
        <div className="row g-2">
          <div className="col-md-6 position-relative"><label className="form-label small mb-0" htmlFor="o-eleve">{t("Élève")}</label>
            <input id="o-eleve" className="form-control form-control-sm" placeholder={t("Nom ou matricule…")} value={q} onChange={(e) => { setQ(e.target.value); setF({ ...f, inscription_id: "" }) }} required />
            {recherche.length > 0 && !f.inscription_id && <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>{recherche.map((i) => (
              <button type="button" key={i.id} className="list-group-item list-group-item-action small" onClick={() => { setF({ ...f, inscription_id: i.id }); setQ(`${nomComplet(i.eleves)} · ${nomDe(r.classes, i.classe_id)}`) }}>
                {nomComplet(i.eleves)} <span className="text-muted">· {i.eleves.matricule} · {nomDe(r.classes, i.classe_id)}</span></button>))}</div>}</div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="o-type">{t("Type")}</label>
            <select id="o-type" className="form-select form-select-sm" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="choix_serie">{t("Choix de série pour l'an prochain")}</option><option value="changement_serie">{t("Changement de série en cours d'année")}</option></select></div>
          {[["niveau_id", t("Niveau"), r.niveaux], ["serie_id", t("Série"), r.series], ["filiere_id", t("Filière"), r.filieres], ["classe_id", t("Classe"), r.classes]].map(([k, l, ls]) => (
            <div className="col-md-3" key={k}><label className="form-label small mb-0" htmlFor={`o-${k}`}>{l}</label>
              <select id={`o-${k}`} className="form-select form-select-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
                <option value="">—</option>{ls.map((x) => <option key={x.id} value={x.id}>{x.code ? `${x.code} — ${x.libelle}` : x.libelle}</option>)}</select></div>))}
          <div className="col-12"><input className="form-control form-control-sm" maxLength={500} placeholder={t("Motif (décision du conseil, souhait de l'élève…)")} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} aria-label={t("Motif")} /></div>
        </div>
        <div className="d-flex gap-2 mt-2"><button className="btn btn-sm btn-primary" disabled={!f.inscription_id}>{t("Enregistrer")}</button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setF(null)}>{t("Annuler")}</button></div>
      </div></form>}
      <div className="table-responsive"><table className="table table-sm align-middle tableau-orientations">
        <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Type")}</th><th>{t("Destination")}</th><th>{t("Motif")}</th><th>{t("Statut")}</th><th /></tr></thead>
        <tbody>{liste.map((o) => (
          <tr key={o.id}><td><strong>{nomEleve(o)}</strong><div className="small text-muted">{nomDe(r.classes, eleves.get(o.inscription_id)?.classe_id)}</div></td>
            <td className="small">{t(TYPES_ORIENTATION[o.type])}<div className="text-muted">{o.origine === "parent" ? t("parent : {v0}", { v0: o.parent_nom }) : t("administration")} · {dateHeure(o.cree_le)}</div></td>
            <td>{destination(o)}</td><td className="small">{o.motif}{o.reponse && <div className="text-muted">↳ {o.reponse}</div>}</td>
            <td><span className={`badge text-bg-${STATUTS_ORIENTATION[o.statut][1]}`}>{t(STATUTS_ORIENTATION[o.statut][0])}</span>{o.applique_le && <div className="small text-muted">{t("appliqué")}</div>}</td>
            <td className="text-end text-nowrap">
              {o.statut === "en_attente" && <>
                <button className="btn btn-sm btn-outline-success me-1" onClick={() => { const m = prompt(t("Réponse aux parents (facultatif) :")); if (m !== null) agir(() => rpc("orientation_decider", { p_id: o.id, p_accepter: true, p_reponse: m }), t("Demande acceptée.")) }}>{t("Accepter")}</button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => { const m = prompt(t("Motif du refus (communiqué aux parents) :")); if (m !== null) agir(() => rpc("orientation_decider", { p_id: o.id, p_accepter: false, p_reponse: m }), t("Demande refusée.")) }}>{t("Refuser")}</button></>}
              {o.statut === "acceptee" && o.type === "changement_serie" && !o.applique_le && <button className="btn btn-sm btn-outline-primary"
                onClick={() => confirm(t("Déplacer l'élève dans la classe acceptée ? Les notes déjà saisies restent rattachées à l'ancienne classe.")) && agir(() => rpc("orientation_appliquer", { p_id: o.id }), t("Élève déplacé dans sa nouvelle classe."))}>{t("Appliquer")}</button>}
            </td></tr>))}
          {!liste.length && <tr><td colSpan={6} className="text-muted text-center py-3">{t("Aucune orientation.")}</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// --- 4. Décisions de passage ----------------------------------------------------------------------------------
function Decisions({ reference: r }) {
  const { exercice, aOffre } = useSession()
  const [classeId, setClasseId] = useState(""), [lignes, setLignes] = useState(null), [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(false)
  const classe = r.classes.find((c) => c.id === classeId)
  const destLib = (l) => libelleDestination({ classe: r.classes.find((x) => x.id === l.classe_destination_id), niveau: r.niveaux.find((x) => x.id === l.niveau_destination_id),
    serie: r.series.find((x) => x.id === l.serie_destination_id), filiere: r.filieres.find((x) => x.id === l.filiere_destination_id) })
  const mentionAuto = (l) => mentionDe(l.decision, destLib(l), { modeles: r.mentions, modeleRegle: r.regles.find((x) => x.id === l.regle_id)?.mention || "", t })

  async function charger(id, recalculer = false, garderMessage = false) {
    setClasseId(id); setLignes(null); if (!garderMessage) setMsg({})
    if (!id) return
    try {
      const c = r.classes.find((x) => x.id === id)
      const liste = await propositionsClasse(c, r, exercice, { avecCriteres: aOffre("decisions") })
      setLignes(liste.map(({ existante, proposition: prop, ...x }) => {
        const base = existante && !recalculer ? { ...existante, raison: existante.source === "manuel" ? t("Saisie manuelle") : prop.raison, choix: prop.choix }
          : { ...prop, mention: "", mention_forcee: false, source: "calcul", statut: existante?.statut || "provisoire", motif: "" }
        return { ...base, inscription_id: x.inscription_id, eleve: x.eleve, moyenne: x.moyenne, fin: x.fin, orientation: x.orientation }
      }))
    } catch (e) { setMsg({ erreur: e.message }) }
  }
  const maj = (k, champs) => setLignes(lignes.map((l, i) => (i === k ? { ...l, ...champs, source: "manuel" } : l)))
  async function enregistrer(valider) {
    if (valider && !confirm(t("Valider les décisions de {v0} élève(s) ? Les mentions apparaîtront sur les bulletins annuels.", { v0: lignes.length }))) return
    setOccupe(true); setMsg({})
    try {
      await rpc("decisions_passage_enregistrer", { p_valider: valider, p_decisions: lignes.map((l) => ({ inscription_id: l.inscription_id, decision: l.decision,
        niveau_destination_id: l.niveau_destination_id || null, serie_destination_id: l.serie_destination_id || null, filiere_destination_id: l.filiere_destination_id || null,
        classe_destination_id: l.classe_destination_id || null, regle_id: l.regle_id || null, mention: l.mention_forcee ? l.mention : mentionAuto(l),
        mention_forcee: !!l.mention_forcee, source: l.source || "calcul", motif: l.motif || "" })) })
      setMsg({ ok: valider ? t("Décisions validées : les mentions figurent désormais sur les bulletins annuels.") : t("Décisions enregistrées (provisoires).") })
      await charger(classeId, false, true)
    } catch (e) { setMsg({ erreur: e.message }) } finally { setOccupe(false) }
  }
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <select className="form-select w-auto" value={classeId} onChange={(e) => charger(e.target.value)} aria-label={t("Classe")}>
          <option value="">{t("Classe…")}</option>{r.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
        {classe && !classe.niveau_id && <span className="small text-warning-emphasis">{t("Cette classe n'est rattachée à aucun niveau (onglet « Structure ») : aucune règle de passage ne peut s'appliquer.")}</span>}
        {lignes && <button className="btn btn-outline-secondary btn-sm" onClick={() => charger(classeId, true)}>{t("Recalculer les propositions")}</button>}
      </div>
      {classeId && !lignes && !msg.erreur && <Chargement />}
      {lignes && <>
        <div className="table-responsive mb-3"><table className="table table-sm align-middle tableau-decisions">
          <thead className="table-light"><tr><th>{t("Élève")}</th><th className="text-end">{t("Moy. ann.")}</th><th>{t("Fin d'année")}</th><th>{t("Orientation")}</th>
            <th>{t("Décision")}</th><th>{t("Destination")}</th><th>{t("Mention du bulletin")}</th><th>{t("Statut")}</th></tr></thead>
          <tbody>{lignes.map((l, k) => (
            <tr key={l.inscription_id} data-eleve={nomComplet(l.eleve)}>
              <td><strong>{nomComplet(l.eleve)}</strong><div className="small text-muted">{t(l.raison || "")}</div></td>
              <td className="text-end">{l.moyenne === null || l.moyenne === undefined ? "—" : note(l.moyenne)}</td>
              <td className="small">{t(l.fin)}</td>
              <td className="small">{l.orientation ? libelleDestination({ niveau: r.niveaux.find((x) => x.id === l.orientation.niveau_id), serie: r.series.find((x) => x.id === l.orientation.serie_id),
                filiere: r.filieres.find((x) => x.id === l.orientation.filiere_id), classe: r.classes.find((x) => x.id === l.orientation.classe_id) }) : "—"}</td>
              <td><select className="form-select form-select-sm" value={l.decision} onChange={(e) => maj(k, { decision: e.target.value })} aria-label={t("Décision")}>
                {Object.entries(DECISIONS).map(([d, lib]) => <option key={d} value={d}>{t(lib)}</option>)}</select></td>
              <td><div className="d-flex gap-1">
                <select className="form-select form-select-sm" value={l.niveau_destination_id || ""} onChange={(e) => maj(k, { niveau_destination_id: e.target.value || null, classe_destination_id: null })} aria-label={t("Niveau de destination")}>
                  <option value="">—</option>{r.niveaux.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</select>
                <select className="form-select form-select-sm" value={l.serie_destination_id || ""} onChange={(e) => maj(k, { serie_destination_id: e.target.value || null, classe_destination_id: null })} aria-label={t("Série de destination")}>
                  <option value="">—</option>{r.series.map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
                <select className="form-select form-select-sm" value={l.classe_destination_id || ""} onChange={(e) => maj(k, { classe_destination_id: e.target.value || null })} aria-label={t("Classe de destination")}>
                  <option value="">{t("classe…")}</option>{r.classes.filter((x) => !l.niveau_destination_id || x.niveau_id === l.niveau_destination_id).map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</select></div></td>
              <td><input className="form-control form-control-sm mention-bulletin" maxLength={150} value={l.mention_forcee ? l.mention : mentionAuto(l)}
                onChange={(e) => maj(k, { mention: e.target.value, mention_forcee: true })} aria-label={t("Mention du bulletin")} />
                {l.mention_forcee && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => maj(k, { mention_forcee: false })}>{t("mention automatique")}</button>}</td>
              <td><span className={`badge text-bg-${l.statut === "validee" ? "success" : "secondary"}`}>{t(l.statut === "validee" ? "Validée" : "Provisoire")}</span></td></tr>))}
            {!lignes.length && <tr><td colSpan={8} className="text-muted text-center py-3">{t("Aucun élève inscrit.")}</td></tr>}</tbody>
        </table></div>
        {lignes.length > 0 && <div className="d-flex gap-2 mb-4">
          <button className="btn btn-outline-primary" disabled={occupe} onClick={() => enregistrer(false)}>{t("Enregistrer (provisoire)")}</button>
          <button className="btn btn-success" disabled={occupe} onClick={() => enregistrer(true)}>{t("Valider les décisions")}</button></div>}
      </>}
    </>
  )
}

// --- 5. Listes d'affectation ---------------------------------------------------------------------------------
function Listes({ reference: r }) {
  const { exercice, etablissement, logoUrl } = useSession()
  const [regroupement, setRegroupement] = useState("serie"), [seulementValidees, setSeulementValidees] = useState(true), [msg, setMsg] = useState("")
  const [d, erreur] = useDonnees(async () => (exercice ? supabase.from("decisions_passage").select("*").eq("exercice_id", exercice.id).then(verifier) : []), [exercice?.id])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const insc = new Map(r.inscriptions.map((i) => [i.id, i]))
  const cleDe = (x) => {
    if (regroupement === "serie") return x.serie_destination_id ? `${nomDe(r.niveaux, x.niveau_destination_id)} ${nomDe(r.series, x.serie_destination_id, "code")}`.trim() : nomDe(r.niveaux, x.niveau_destination_id) || t(DECISIONS[x.decision])
    if (regroupement === "classe") return nomDe(r.classes, x.classe_destination_id) || t("Classe à attribuer")
    if (regroupement === "cycle") return nomDe(r.cycles, r.niveaux.find((n) => n.id === x.niveau_destination_id)?.cycle_id) || t(DECISIONS[x.decision])
    return t(DECISIONS[x.decision])
  }
  const groupes = new Map()
  for (const x of d.filter((y) => !seulementValidees || y.statut === "validee")) {
    const k = cleDe(x); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(x)
  }
  const tries = [...groupes.entries()].sort((a, b) => comparerNoms(a[0], b[0]))
  const ligne = (x) => { const i = insc.get(x.inscription_id); return [i ? nomComplet(i.eleves) : "?", i?.eleves.matricule || "", nomDe(r.classes, i?.classe_id), x.mention, t(x.statut === "validee" ? "Validée" : "Provisoire")] }
  const titre = t("Listes d'affectation — {v0}", { v0: t({ serie: "par série", classe: "par classe de destination", cycle: "par cycle", decision: "par décision" }[regroupement]) })
  async function pdf() {
    setMsg("")
    try {
      const lignes = tries.flatMap(([g, l]) => [[`▸ ${g} (${l.length})`, "", "", "", ""], ...l.sort((a, b) => comparerNoms(ligne(a)[0], ligne(b)[0])).map(ligne)])
      await listePdf({ etablissement, logoUrl, titre, sousTitre: `${t("Année scolaire")} ${exercice.libelle}`,
        colonnes: [{ titre: t("Élève") }, { titre: t("Matricule") }, { titre: t("Classe actuelle") }, { titre: t("Mention") }, { titre: t("Statut") }], lignes }, nomDeFichier(t("affectations"), regroupement, exercice.libelle))
    } catch (e) { setMsg(e.message) }
  }
  async function excel() {
    await telechargerClasseur(tries.map(([g, l]) => ({ titre: g, intitule: `${titre} — ${g}`, entetes: [t("Élève"), t("Matricule"), t("Classe actuelle"), t("Mention"), t("Statut")],
      lignes: l.map(ligne) })), nomDeFichier(t("affectations"), regroupement, exercice.libelle))
  }
  return (
    <>
      <Alerte onFermer={() => setMsg("")}>{msg}</Alerte>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <select className="form-select w-auto" value={regroupement} onChange={(e) => setRegroupement(e.target.value)} aria-label={t("Regroupement")}>
          <option value="serie">{t("Par série de destination")}</option><option value="classe">{t("Par classe de destination")}</option>
          <option value="cycle">{t("Par cycle")}</option><option value="decision">{t("Par décision")}</option></select>
        <label className="form-check small mb-0"><input type="checkbox" className="form-check-input" checked={seulementValidees} onChange={(e) => setSeulementValidees(e.target.checked)} /> {t("Décisions validées seulement")}</label>
        <button className="btn btn-sm btn-outline-primary" disabled={!tries.length} onClick={pdf}>PDF</button>
        <button className="btn btn-sm btn-outline-success" disabled={!tries.length} onClick={excel}>Excel</button>
      </div>
      {!tries.length && <p className="text-muted">{t("Aucune décision de passage pour le moment (onglet « Décisions de passage »).")}</p>}
      {tries.map(([g, l]) => (
        <div className="card mb-2 groupe-affectation" key={g}><div className="card-body py-2">
          <h2 className="h6 mb-1">{g} <span className="badge text-bg-light">{l.length}</span></h2>
          <div className="small">{l.map(ligne).sort((a, b) => comparerNoms(a[0], b[0])).map((x) => x[0]).join(" · ")}</div>
        </div></div>))}
    </>
  )
}
