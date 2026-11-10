// SmartEval : évaluations digitalisées (création façon Google Forms, aperçu, lien à durée limitée, résultats, journal, analyse par l'IA).
import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import FormulaireEvaluation, { EnteteEvaluation } from "../composants/FormulaireEvaluation.jsx"
import { ACCEPTES, SUPPORTS_MAX, envoyerSupport, icone, retirerSupports, tailleLisible } from "../lib/supports.js"
import { analyserEvaluation, attenduTexte, reponseTexte } from "../lib/smarteval.js"
import { DUREE_MAX, STATUTS, TYPES, UNITES, demandeIA, enteteEtablissement, finDuree, lienEvaluation, nouvelId, nouvelleQuestion } from "../lib/smartevalOutils.js"
import { dateHeure, note, pourcentage } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

const signaler = () => window.dispatchEvent(new Event("smarteval:maj"))

export function Copier({ texte, libelle = t("Copier"), className = "btn btn-outline-primary" }) {
  const [fait, setFait] = useState(false)
  async function copier() {
    try { await navigator.clipboard.writeText(texte) } catch {
      const z = document.createElement("textarea"); z.value = texte; document.body.appendChild(z); z.select(); document.execCommand("copy"); z.remove()
    }
    setFait(true); setTimeout(() => setFait(false), 2000)
  }
  return <button type="button" className={className} onClick={copier}>{fait ? t("Copié ✓") : libelle}</button>
}

function Statut({ e }) {
  const classes = { brouillon: "text-bg-secondary", ouverte: "text-bg-success", close: "text-bg-dark", programmee: "text-bg-info" }
  return <span className={`badge ${classes[e.statut]}`}>{t(STATUTS[e.statut])}{e.statut === "ouverte" && e.ferme_le ? t(" jusqu'au {v0}", { v0: dateHeure(e.ferme_le) }) : ""}</span>
}

/** IA facultative : la création est ouverte à tous ; l'IA connectée au compte sert à analyser les réponses. */
function Prealable({ ctx }) {
  if (ctx.ia_connectee) return <div className="alert alert-success py-2 small d-flex align-items-center gap-2 se-ia-ok">✓ {t("IA connectée à votre compte : vous pourrez faire analyser les réponses de vos élèves.")}</div>
  return (
    <div className="alert alert-light border small mb-3 se-ia-facultative">
      {t("Facultatif : pour faire analyser les réponses par l'IA de votre choix (Claude, Grok…), activez la connexion IA de votre compte dans la rubrique « IA et API ». Vous pouvez créer et partager vos évaluations sans cela.")}{" "}
      <Link to="/developpeur">{t("Aller à « IA et API »")}</Link>
    </div>
  )
}

// ======================================================================================================
// Accueil : préalable, création, mes évaluations, journal
// ======================================================================================================
export default function SmartEval() {
  const naviguer = useNavigate()
  const [donnees, erreur, recharger] = useDonnees(() => Promise.all([rpc("smarteval_contexte"), rpc("smarteval_liste")]).then(([ctx, liste]) => ({ ctx, liste })), [])
  const [msg, setMsg] = useState({})
  useEffect(() => { const f = () => recharger(); window.addEventListener("smarteval:maj", f); return () => window.removeEventListener("smarteval:maj", f) }, [recharger])
  if (!donnees) return <><Entete /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const { ctx, liste } = donnees
  const peutCreer = ctx.matieres.length > 0 && ctx.sequence
  const action = async (f, ok) => { setMsg({}); try { await f(); setMsg({ ok }); recharger() } catch (e) { setMsg({ erreur: e.message }) } }
  return (
    <>
      <Entete />
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <Prealable ctx={ctx} />
      {!ctx.matieres.length && <div className="alert alert-info small">{t("Aucune matière n'est encore programmée cette année : l'administration doit d'abord renseigner les matières par classe (Paramètres → Matières par classe).")}</div>}
      {!ctx.sequence && <div className="alert alert-warning small">{t("Aucune séquence en cours : toutes les séquences sont verrouillées par l'administration.")}</div>}
      <div className="card se-creer mb-4"><div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
        <div><h2 className="h5 mb-1">{t("Créer une évaluation digitalisée")}</h2>
          <p className="small text-muted mb-0">{t("Un formulaire en ligne pour vos élèves, corrigé automatiquement, puis analysé par votre IA pour cibler la remédiation avant l'évaluation sur papier.")}</p></div>
        <button className="btn btn-primary btn-lg" disabled={!peutCreer} onClick={() => naviguer("/smarteval/nouvelle")}>＋ {t("Créer une évaluation digitalisée")}</button>
      </div></div>

      <h2 className="h5">{t("Mes évaluations digitalisées")}</h2>
      {!liste.length && <p className="text-muted">{t("Aucune évaluation pour le moment.")}</p>}
      <div className="row g-3 mb-4">{liste.map((e) => (
        <div className="col-lg-6" key={e.id}><div className="card h-100 se-evaluation" data-evaluation={e.id}><div className="card-body">
          <div className="d-flex justify-content-between gap-2 mb-1"><h3 className="h6 mb-0">{e.titre}</h3><Statut e={e} /></div>
          <div className="small text-muted mb-2">{[e.matiere, (e.classes || []).join(", "), t("Séquence {v0}", { v0: e.sequence }), t("{v0} question(s)", { v0: e.questions })].join(" · ")}</div>
          <div className="small mb-2"><span className="fw-semibold">{t("Compétence : ")}</span>{e.competence}</div>
          {e.statut !== "brouillon" && <div className="small mb-3">{t("Soumissions : ")}<strong>{e.soumissions}</strong>
            {e.nouvelles > 0 && <span className="badge text-bg-danger ms-1">{t("{v0} nouvelle(s)", { v0: e.nouvelles })}</span>}
            {e.moyenne !== null && <>{t(" · moyenne ")}<strong>{note(e.moyenne)}/20</strong></>}</div>}
          <div className="d-flex flex-wrap gap-2">
            {e.statut !== "brouillon" && <Link className="btn btn-sm btn-primary" to={`/smarteval/${e.id}`}>{t("Résultats")}</Link>}
            {e.statut === "brouillon" && <Link className="btn btn-sm btn-primary" to={`/smarteval/${e.id}/modifier`}>{t("Continuer")}</Link>}
            {e.jeton && <Copier texte={lienEvaluation(e.jeton)} libelle={t("Copier le lien")} className="btn btn-sm btn-outline-primary" />}
            {e.statut === "ouverte" && <button className="btn btn-sm btn-outline-secondary" onClick={() => confirm(t("Clore l'évaluation maintenant ? Les élèves ne pourront plus répondre.")) && action(() => rpc("smarteval_clore", { p_id: e.id }), t("Évaluation close."))}>{t("Clore")}</button>}
            <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => confirm(e.soumissions ? t("Supprimer cette évaluation et ses {v0} soumission(s) ? C'est définitif.", { v0: e.soumissions }) : t("Supprimer cette évaluation ?"))
              && action(async () => { const sup = await rpc("smarteval_supprimer", { p_id: e.id }); await retirerSupports((sup || []).map((d) => d.chemin)).catch(() => {}) }, t("Évaluation supprimée."))}>{t("Supprimer")}</button>
          </div>
        </div></div></div>))}</div>
      <div className="text-center mb-4"><Link className="btn btn-outline-secondary" to="/smarteval/journal">{t("Journal des soumissions")}</Link></div>
    </>
  )
}

function Entete() {
  return (
    <div className="se-bandeau mb-3">
      <h1 className="h3 mb-1">SmartEval <span className="badge se-badge-ia">IA</span></h1>
      <p className="mb-0 small">{t("Évaluations digitalisées : repérez avant l'évaluation sur papier qui est en difficulté, sur quelles notions, et laissez votre IA proposer la remédiation.")}</p>
    </div>
  )
}

// ======================================================================================================
// Éditeur (façon Google Forms) -> aperçu -> durée -> lien
// ======================================================================================================
function EditeurQuestion({ q, numero, total, onChange, onSupprimer, onDupliquer, onDeplacer }) {
  const maj = (champs) => onChange({ ...q, ...champs })
  const aOptions = ["choix", "cases", "liste"].includes(q.type)
  const basculerBonne = (i) => {
    if (q.type === "cases") maj({ bonnes: q.bonnes.includes(i) ? q.bonnes.filter((x) => x !== i) : [...q.bonnes, i].sort((a, b) => a - b) })
    else maj({ bonnes: q.bonnes.includes(i) ? [] : [i] })
  }
  const retirerOption = (i) => maj({ options: q.options.filter((_, k) => k !== i), bonnes: q.bonnes.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)) })
  return (
    <div className="se-carte se-editeur-question" data-question={q.id}>
      <div className="row g-2 align-items-start">
        <div className="col-md-8"><label className="visually-hidden" htmlFor={`int-${q.id}`}>{t("Question {v0}", { v0: numero })}</label>
          <textarea id={`int-${q.id}`} className="form-control se-intitule-saisie" rows={1} placeholder={t("Question {v0}", { v0: numero })} maxLength={1000}
                    value={q.intitule} onChange={(e) => maj({ intitule: e.target.value })} /></div>
        <div className="col-md-4"><select className="form-select" aria-label={t("Type de question")} value={q.type}
            onChange={(e) => maj({ type: e.target.value, bonnes: [], options: q.options.length ? q.options : [t("Option {v0}", { v0: 1 })] })}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
        <div className="col-12"><input className="form-control form-control-sm se-ligne" placeholder={t("Description (facultatif)")} maxLength={500}
                                       value={q.aide} onChange={(e) => maj({ aide: e.target.value })} aria-label={t("Description (facultatif)")} /></div>
      </div>

      <div className="mt-3">
        {aOptions && <>
          <div className="small text-muted mb-1">{q.type === "cases" ? t("Corrigé : cochez ✓ toutes les bonnes réponses") : t("Corrigé : cochez ✓ la bonne réponse")}</div>
          {q.options.map((o, i) => (
            <div className="d-flex align-items-center gap-2 mb-1 se-option-edition" key={i}>
              <span className="se-puce" aria-hidden="true">{q.type === "choix" ? "○" : q.type === "cases" ? "☐" : `${i + 1}.`}</span>
              <input className="form-control form-control-sm se-ligne" value={o} maxLength={300} aria-label={t("Option {v0}", { v0: i + 1 })}
                     onChange={(e) => maj({ options: q.options.map((x, k) => (k === i ? e.target.value : x)) })} />
              <button type="button" className={`btn btn-sm ${q.bonnes.includes(i) ? "btn-success" : "btn-outline-success"} se-bonne`} title={t("Bonne réponse")}
                      aria-pressed={q.bonnes.includes(i)} onClick={() => basculerBonne(i)}>✓</button>
              {q.options.length > 1 && <button type="button" className="btn btn-sm btn-link text-secondary" title={t("Retirer l'option")} onClick={() => retirerOption(i)}>✕</button>}
            </div>))}
          {q.options.length < 30 && <button type="button" className="btn btn-link btn-sm px-0 se-ajouter-option" onClick={() => maj({ options: [...q.options, t("Option {v0}", { v0: q.options.length + 1 })] })}>{t("Ajouter une option")}</button>}
        </>}
        {q.type === "courte" && <>
          <input className="form-control form-control-sm se-ligne mb-2" disabled placeholder={t("Texte de réponse courte")} />
          <label className="small text-muted" htmlFor={`acc-${q.id}`}>{t("Corrigé : réponses acceptées, séparées par « ; » (casse et accents ignorés). Laissez vide pour apprécier vous-même ou par l'IA.")}</label>
          <input id={`acc-${q.id}`} className="form-control form-control-sm" value={q.acceptees_texte ?? q.acceptees.join(" ; ")} maxLength={2000}
                 placeholder={t("ex. Yaoundé ; la capitale est Yaoundé")}
                 onChange={(e) => maj({ acceptees_texte: e.target.value, acceptees: e.target.value.split(";").map((x) => x.trim()).filter(Boolean) })} />
        </>}
        {q.type === "paragraphe" && <><textarea className="form-control form-control-sm" rows={2} disabled placeholder={t("Texte de réponse longue")} />
          <div className="small text-muted mt-1">{t("Réponse ouverte : appréciée par vous ou par l'IA lors de l'analyse.")}</div></>}
        {q.type === "echelle" && (
          <div className="row g-2 align-items-center">
            <div className="col-auto"><select className="form-select form-select-sm" aria-label={t("Minimum")} value={q.echelle.min} onChange={(e) => maj({ echelle: { ...q.echelle, min: Number(e.target.value) } })}>
              {[0, 1].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
            <div className="col-auto small">{t("à")}</div>
            <div className="col-auto"><select className="form-select form-select-sm" aria-label={t("Maximum")} value={q.echelle.max} onChange={(e) => maj({ echelle: { ...q.echelle, max: Number(e.target.value) } })}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => <option key={v} value={v}>{v}</option>)}</select></div>
            <div className="col-sm"><input className="form-control form-control-sm" placeholder={t("Libellé du minimum (facultatif)")} maxLength={60} value={q.echelle.libelle_min}
                                           onChange={(e) => maj({ echelle: { ...q.echelle, libelle_min: e.target.value } })} /></div>
            <div className="col-sm"><input className="form-control form-control-sm" placeholder={t("Libellé du maximum (facultatif)")} maxLength={60} value={q.echelle.libelle_max}
                                           onChange={(e) => maj({ echelle: { ...q.echelle, libelle_max: e.target.value } })} /></div>
            <div className="col-12 small text-muted">{t("Échelle d'opinion : non notée.")}</div>
          </div>)}
      </div>

      <div className="se-pied-question">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <input className="form-control form-control-sm se-notion" placeholder={t("Notion évaluée (ex. Addition de fractions)")} maxLength={120} value={q.notion}
                 onChange={(e) => maj({ notion: e.target.value })} aria-label={t("Notion évaluée")} />
          {q.type !== "echelle" && <div className="input-group input-group-sm se-points-saisie">
            <input type="number" className="form-control" min={0} max={100} step="0.5" value={q.points} aria-label={t("Points")}
                   onChange={(e) => maj({ points: e.target.value === "" ? 0 : Math.max(0, Math.min(100, Number(e.target.value))) })} />
            <span className="input-group-text">{t("pt(s)")}</span></div>}
        </div>
        <div className="d-flex align-items-center gap-1">
          <button type="button" className="btn btn-sm btn-light" title={t("Monter")} disabled={numero === 1} onClick={() => onDeplacer(-1)}>↑</button>
          <button type="button" className="btn btn-sm btn-light" title={t("Descendre")} disabled={numero === total} onClick={() => onDeplacer(1)}>↓</button>
          <button type="button" className="btn btn-sm btn-light" title={t("Dupliquer")} onClick={onDupliquer}>⧉</button>
          <button type="button" className="btn btn-sm btn-light text-danger" title={t("Supprimer la question")} onClick={onSupprimer}>🗑</button>
          <div className="form-check form-switch ms-2 mb-0">
            <input className="form-check-input" type="checkbox" role="switch" id={`obl-${q.id}`} checked={q.obligatoire} onChange={(e) => maj({ obligatoire: e.target.checked })} />
            <label className="form-check-label small" htmlFor={`obl-${q.id}`}>{t("Obligatoire")}</label></div>
        </div>
      </div>
    </div>
  )
}

// Classes dont le membre du personnel a la charge (au moins une matière), puis matières qu'il y enseigne
const ordreClasses = new Intl.Collator("fr", { numeric: true, sensitivity: "base" }).compare
export function classesDe(ctx) {
  const m = new Map()
  for (const x of ctx.matieres || []) for (const c of x.classes || []) m.set(c.id, c)
  return [...m.values()].sort((a, b) => ordreClasses(a.libelle, b.libelle))
}
export const matieresDe = (ctx, classeId) => (ctx.matieres || []).filter((x) => (x.classes || []).some((c) => c.id === classeId))
  .sort((a, b) => ordreClasses(a.libelle, b.libelle))

function controler(f) {
  if (!f.titre.trim()) return t("Donnez un titre à l'évaluation.")
  if (!f.classes.length) return t("Choisissez la classe.")
  if (!f.matiere_id) return t("Choisissez la matière.")
  if (!f.competence.trim()) return t("Indiquez la compétence visée.")
  if (!f.questions.length) return t("Ajoutez au moins une question.")
  for (const [k, q] of f.questions.entries()) {
    if (!q.intitule.trim()) return t("Question {v0} : écrivez l'intitulé.", { v0: k + 1 })
    if (["choix", "cases", "liste"].includes(q.type) && !q.options.some((o) => o.trim())) return t("Question {v0} : ajoutez au moins une option.", { v0: k + 1 })
  }
  return ""
}

/** Documents supports (corpus, texte, carte…) joints à l'évaluation : les élèves les téléchargent pour répondre. */
function DocumentsSupports({ supports, onChange, etablissementId, auteurId }) {
  const [envoi, setEnvoi] = useState(false), [erreur, setErreur] = useState("")
  const ajouter = async (e) => {
    const fichiers = [...e.target.files]; e.target.value = ""
    if (!fichiers.length) return
    if (supports.length + fichiers.length > SUPPORTS_MAX) { setErreur(t("Trois documents supports au plus par évaluation.")); return }
    setErreur(""); setEnvoi(true)
    let liste = supports
    try { for (const fi of fichiers) { liste = [...liste, await envoyerSupport(fi, etablissementId, auteurId)]; onChange(liste) } }
    catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="se-carte se-supports">
      <h2 className="h6 mb-1">{t("Documents supports (facultatif)")}</h2>
      <p className="small text-muted mb-2">{t("Joignez le texte, le corpus, la carte ou le schéma sur lequel portent les questions : les élèves le téléchargeront depuis le lien de l'évaluation.")}</p>
      <ul className="list-unstyled mb-2">{supports.map((d) => (
        <li key={d.chemin} className="d-flex align-items-center gap-2 border rounded px-2 py-1 mb-1 se-support">
          <span aria-hidden="true">{icone(d.type)}</span><span className="text-truncate flex-grow-1">{d.nom}</span>
          <span className="small text-muted text-nowrap">{tailleLisible(d.taille)}</span>
          <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => onChange(supports.filter((x) => x.chemin !== d.chemin))}>{t("Retirer")}</button>
        </li>))}</ul>
      {supports.length < SUPPORTS_MAX && (
        <label className={`btn btn-outline-primary btn-sm ${envoi ? "disabled" : ""}`}>
          {envoi ? t("Envoi en cours…") : "＋ " + t("Joindre un document")}
          <input type="file" className="d-none se-support-fichier" accept={ACCEPTES} multiple disabled={envoi} onChange={ajouter} />
        </label>)}
      <div className="form-text se-supports-aide">{t("PDF, image (JPG, PNG) ou texte Word (.doc, .docx, .odt) · 3 documents au plus · 10 Mo au maximum par fichier. Pour que vos élèves le téléchargent vite sur téléphone, visez moins de 2 Mo : un PDF de quelques pages, ou une photo (les photos trop lourdes sont réduites automatiquement).")}</div>
      {erreur && <div className="text-danger small mt-1">{erreur}</div>}
    </div>
  )
}

export function EditeurEvaluation() {
  const { id } = useParams()
  const naviguer = useNavigate()
  const { etablissement, exercice, logoUrl, profil } = useSession()
  const [supportsEnregistres, setSupportsEnregistres] = useState([])
  const [donnees, erreurChargement] = useDonnees(() => Promise.all([rpc("smarteval_contexte"), id ? rpc("smarteval_detail", { p_id: id }) : null]).then(([ctx, ev]) => ({ ctx, ev })), [id])
  const [f, setF] = useState(null), [evId, setEvId] = useState(id || null)
  const [etape, setEtape] = useState("edition"), [erreur, setErreur] = useState(""), [occupe, setOccupe] = useState(false)
  const [duree, setDuree] = useState({ valeur: 3, unite: "jours" }), [publie, setPublie] = useState(null), [entete, setEntete] = useState(null)

  useEffect(() => {
    if (!donnees || f) return
    const { ctx, ev } = donnees
    if (ev) {
      if (ev.jeton) { naviguer(`/smarteval/${ev.id}`, { replace: true }); return }
      setSupportsEnregistres(ev.supports || [])
      setF({ titre: ev.titre, consignes: ev.consignes, competence: ev.competence, matiere_id: ev.matiere_id, classes: ev.classes.slice(0, 1).map((c) => c.id),
             supports: ev.supports || [], questions: ev.questions.map((q) => ({ ...nouvelleQuestion(q.type), ...q, echelle: q.echelle || nouvelleQuestion().echelle })) })
    } else {
      const c = classesDe(ctx)[0], m = matieresDe(ctx, c?.id)[0]
      setF({ titre: "", consignes: "", competence: "", matiere_id: m?.matiere_id || "", classes: c ? [c.id] : [], supports: [], questions: [nouvelleQuestion()] })
    }
  }, [donnees, f, naviguer])
  useEffect(() => { enteteEtablissement(etablissement, exercice, logoUrl).then(setEntete) }, [etablissement, exercice, logoUrl])

  if (!donnees || !f) return <><Alerte>{erreurChargement}</Alerte>{!erreurChargement && <Chargement />}</>
  const { ctx } = donnees
  const matiere = ctx.matieres.find((m) => m.matiere_id === f.matiere_id)
  const mesClasses = classesDe(ctx), matieresClasse = matieresDe(ctx, f.classes[0])
  const choisirClasse = (id) => {
    const liste = matieresDe(ctx, id)
    setF({ ...f, classes: [id], matiere_id: liste.some((m) => m.matiere_id === f.matiere_id) ? f.matiere_id : liste[0]?.matiere_id || "" })
  }
  const majQ = (k, q) => setF({ ...f, questions: f.questions.map((x, i) => (i === k ? q : x)) })
  const deplacer = (k, sens) => { const qs = [...f.questions]; [qs[k], qs[k + sens]] = [qs[k + sens], qs[k]]; setF({ ...f, questions: qs }) }

  async function terminer() {
    const e = controler(f)
    setErreur(e); if (e) { window.scrollTo({ top: 0, behavior: "smooth" }); return }
    setOccupe(true)
    try {
      const questions = f.questions.map((q) => ({ ...q, options: q.options.map((o) => o.trim()).filter(Boolean), acceptees: q.acceptees.filter(Boolean),
        points: q.type === "echelle" ? 0 : Number(q.points) || 0 }))
      const nouvelId_ = (await rpc("smarteval_enregistrer", { p: { id: evId, ...f, questions } })).id
      const gardes = new Set(f.supports.map((d) => d.chemin))                       // documents retirés : supprimés du stockage
      retirerSupports(supportsEnregistres.filter((d) => !gardes.has(d.chemin)).map((d) => d.chemin)).catch(() => {})
      setSupportsEnregistres(f.supports)
      setEvId(nouvelId_); setEtape("apercu"); window.scrollTo({ top: 0 })
      if (!id) window.history.replaceState(null, "", `${import.meta.env.BASE_URL}smarteval/${nouvelId_}/modifier`)
    } catch (x) { setErreur(x.message); window.scrollTo({ top: 0, behavior: "smooth" }) } finally { setOccupe(false) }
  }

  async function generer() {
    setErreur(""); setOccupe(true)
    try {
      const r = await rpc("smarteval_publier", { p_id: evId, p_valeur: Number(duree.valeur), p_unite: duree.unite, p_entete: entete || {} })
      setPublie(r); setEtape("lien"); window.scrollTo({ top: 0 }); signaler()
    } catch (x) { setErreur(x.message) } finally { setOccupe(false) }
  }

  const apercuEvaluation = {
    titre: f.titre, consignes: f.consignes, supports: f.supports, competence: f.competence, matiere: matiere?.libelle, sequence: ctx.sequence?.numero, entete: entete || {},
    classes: mesClasses.filter((c) => f.classes.includes(c.id)),
    questions: f.questions.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()), points: q.type === "echelle" ? 0 : q.points })),
  }

  if (etape === "lien" && publie) {
    const lien = lienEvaluation(publie.jeton)
    return (
      <div className="se-colonne">
        <div className="se-carte se-carte-titre se-lien-genere">
          <h1 className="h4">✓ {t("Le lien de votre évaluation est prêt")}</h1>
          <p className="mb-2">{f.titre}</p>
          <div className="input-group mb-2"><input className="form-control font-monospace" readOnly value={lien} aria-label={t("Lien de l'évaluation")} onFocus={(e) => e.target.select()} />
            <Copier texte={lien} libelle={t("Copier")} /></div>
          <p className="small mb-3">{t("Les élèves peuvent répondre jusqu'au ")}<strong>{dateHeure(publie.ferme_le)}</strong>{t(". Après cette date, le lien n'accepte plus de réponse.")}</p>
          <div className="d-flex flex-wrap gap-2">
            <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`${f.titre}\n${lien}`)}`} target="_blank" rel="noopener noreferrer">{t("Partager sur WhatsApp")}</a>
            <Link className="btn btn-outline-primary" to={`/smarteval/${evId}`}>{t("Suivre les soumissions")}</Link>
            <Link className="btn btn-outline-secondary" to="/smarteval">{t("Mes évaluations")}</Link>
          </div>
        </div>
      </div>
    )
  }

  if (etape === "apercu") return (
    <div className="se-colonne">
      <div className="alert alert-info d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>{t("Aperçu : voici exactement ce que verront vos élèves en ouvrant le lien.")}</span>
        <button className="btn btn-sm btn-outline-primary" onClick={() => setEtape("edition")}>← {t("Modifier l'évaluation")}</button>
      </div>
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
      <div className="se-apercu"><FormulaireEvaluation key={JSON.stringify(apercuEvaluation.questions).length} evaluation={apercuEvaluation} mode="apercu" onEnvoyer={async () => null} /></div>
      <div className="se-carte se-duree">
        <h2 className="h5">{t("Durée de l'évaluation")}</h2>
        <p className="small text-muted">{t("Le lien n'accepte les réponses que pendant cette durée, à partir du moment où vous le générez.")}</p>
        <div className="row g-2 align-items-end">
          <div className="col-auto"><label className="form-label small" htmlFor="duree-valeur">{t("Durée")}</label>
            <input id="duree-valeur" type="number" className="form-control" min={1} max={DUREE_MAX[duree.unite]} value={duree.valeur}
                   onChange={(e) => setDuree({ ...duree, valeur: e.target.value })} /></div>
          <div className="col-auto"><label className="form-label small" htmlFor="duree-unite">{t("Unité")}</label>
            <select id="duree-unite" className="form-select" value={duree.unite} onChange={(e) => setDuree({ valeur: Math.min(Number(duree.valeur) || 1, DUREE_MAX[e.target.value]), unite: e.target.value })}>
              {UNITES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
          <div className="col small">{Number(duree.valeur) >= 1 && Number(duree.valeur) <= DUREE_MAX[duree.unite]
            ? <>{t("Réponses acceptées jusqu'au ")}<strong>{dateHeure(finDuree(duree.valeur, duree.unite))}</strong></>
            : <span className="text-danger">{t("Durée : 1 à {v0} {v1}.", { v0: DUREE_MAX[duree.unite], v1: t(UNITES.find((u) => u[0] === duree.unite)[1]) })}</span>}</div>
        </div>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button className="btn btn-outline-secondary" onClick={() => setEtape("edition")} disabled={occupe}>← {t("Modifier l'évaluation")}</button>
          <button className="btn btn-primary btn-lg se-generer" onClick={generer} disabled={occupe || !(Number(duree.valeur) >= 1 && Number(duree.valeur) <= DUREE_MAX[duree.unite])}>
            {occupe ? <span className="spinner-border spinner-border-sm me-1" /> : "🔗 "}{t("Générer le lien de mon évaluation")}</button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="se-colonne se-editeur">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h1 className="h4 mb-0">{t("Créer une évaluation digitalisée")}</h1>
        <Link to="/smarteval" className="small">{t("← SmartEval")}</Link>
      </div>
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>

      <div className="se-carte se-carte-titre">
        <input className="form-control se-titre-saisie" placeholder={t("Titre de l'évaluation")} maxLength={150} value={f.titre} onChange={(e) => { setF({ ...f, titre: e.target.value }); if (erreur) setErreur("") }} aria-label={t("Titre de l'évaluation")} />
        <textarea className="form-control se-ligne mt-2" rows={2} placeholder={t("Consignes aux élèves (facultatif)")} maxLength={3000} value={f.consignes}
                  onChange={(e) => setF({ ...f, consignes: e.target.value })} aria-label={t("Consignes aux élèves (facultatif)")} />
      </div>
      <DocumentsSupports supports={f.supports} onChange={(supports) => setF((x) => ({ ...x, supports }))} etablissementId={etablissement.id} auteurId={profil.id} />

      <div className="se-carte">
        <div className="row g-3">
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="se-classe-choix">{t("Classe")}</label>
            {mesClasses.length > 1
              ? <select id="se-classe-choix" className="form-select" value={f.classes[0] || ""} onChange={(e) => choisirClasse(e.target.value)}>
                  {mesClasses.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
              : <input id="se-classe-choix" className="form-control" readOnly value={mesClasses[0]?.libelle || "—"} />}
            <div className="form-text">{mesClasses.length > 1 ? t("Les classes dont vous avez la charge.") : t("Votre classe, renseignée automatiquement.")}</div></div>
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="se-sequence">{t("Séquence")}</label>
            <input id="se-sequence" className="form-control" readOnly value={ctx.sequence ? t("Séquence {v0} (en cours)", { v0: ctx.sequence.numero }) : "—"} />
            <div className="form-text">🔒 {t("Séquence en cours, fixée par l'administration.")}</div></div>
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="se-matiere">{t("Matière")}</label>
            {matieresClasse.length > 1
              ? <select id="se-matiere" className="form-select" value={f.matiere_id} onChange={(e) => setF({ ...f, matiere_id: e.target.value })}>
                  {matieresClasse.map((m) => <option key={m.matiere_id} value={m.matiere_id}>{m.libelle}</option>)}</select>
              : <input id="se-matiere" className="form-control" readOnly value={matieresClasse[0]?.libelle || "—"} />}
            <div className="form-text">{matieresClasse.length > 1 ? t("Les matières que vous enseignez dans cette classe.") : t("Votre matière dans cette classe, renseignée automatiquement.")}</div></div>
          <div className="col-12"><label className="form-label small fw-semibold" htmlFor="se-competence">{t("Compétence visée")} <span className="text-danger">*</span></label>
            <textarea id="se-competence" className="form-control" rows={2} maxLength={600} placeholder={t("ex. Résoudre des problèmes de proportionnalité dans des situations de vie courante")}
                      value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })} />
            <div className="form-text">{t("L'objectif visé par cette évaluation : il guide l'analyse de l'IA.")}</div></div>
        </div>
      </div>

      <div className="se-carte se-identite-verrouillee">
        <div className="se-intitule mb-2">🔒 {t("Identification de l'élève")}</div>
        <div className="row g-2 small text-muted">
          <div className="col-sm-4"><input className="form-control form-control-sm" disabled placeholder={`${t("Nom")} *`} /></div>
          <div className="col-sm-4"><input className="form-control form-control-sm" disabled placeholder={`${t("Prénom")} *`} /></div>
          <div className="col-sm-4"><select className="form-select form-select-sm" disabled><option>{`${t("Classe")} *`}</option></select></div>
        </div>
        <div className="form-text">{t("Champs automatiques, remplis par chaque élève.")}</div>
      </div>

      {f.questions.map((q, k) => (
        <EditeurQuestion key={q.id} q={q} numero={k + 1} total={f.questions.length} onChange={(x) => majQ(k, x)}
          onSupprimer={() => setF({ ...f, questions: f.questions.filter((_, i) => i !== k) })}
          onDupliquer={() => setF({ ...f, questions: [...f.questions.slice(0, k + 1), { ...structuredClone(q), id: nouvelId() }, ...f.questions.slice(k + 1)] })}
          onDeplacer={(sens) => deplacer(k, sens)} />))}

      <div className="d-flex flex-wrap justify-content-between gap-2 mb-5">
        <button type="button" className="btn btn-outline-primary se-ajouter-question" disabled={f.questions.length >= 100}
                onClick={() => setF({ ...f, questions: [...f.questions, nouvelleQuestion(f.questions.at(-1)?.type || "choix")] })}>＋ {t("Ajouter une question")}</button>
        <button type="button" className="btn btn-primary px-4 se-terminer" onClick={terminer} disabled={occupe}>
          {occupe && <span className="spinner-border spinner-border-sm me-1" />}{t("Terminer")}</button>
      </div>
    </div>
  )
}

// ======================================================================================================
// Résultats : synthèse, analyse par question / notion / élève, copies A4 (impression, PDF, Excel), demande à l'IA
// ======================================================================================================
const pc = pourcentage
function Barre({ v }) {
  const c = v === null ? "#adb5bd" : v >= 70 ? "#198754" : v >= 50 ? "#fd7e14" : "#dc3545"
  return <div className="se-barre" title={pc(v)}><div style={{ width: `${v ?? 0}%`, background: c }} /></div>
}

function CopieEleve({ ev, s }) {
  return (
    <section className="copie-a4" data-copie={s.numero}>
      <EnteteEvaluation entete={ev.entete} sequence={ev.sequence} />
      <h2 className="titre-bulletin">{t("ÉVALUATION DIGITALISÉE — SMARTEVAL")}</h2>
      <div className="text-center fw-semibold mb-1">{ev.titre}</div>
      <div className="small text-center text-muted mb-2">{ev.matiere} · {t("Compétence visée : ")}{ev.competence}</div>
      <table className="table table-sm table-bordered tableau-bulletin mb-2"><tbody>
        <tr><td>{t("Nom et prénom : ")}<strong>{s.nom} {s.prenom}</strong></td><td>{t("Classe : ")}<strong>{s.classe}</strong></td><td>{t("Matricule : ")}{s.matricule || "—"}</td></tr>
        <tr><td>{t("Envoyé le : ")}{dateHeure(s.soumis_le)}</td><td>{t("Copie n° {v0}", { v0: s.numero })}</td>
          <td>{t("Note : ")}<strong>{s.note20 === null ? "—" : `${note(s.note20)} / 20`}</strong>{s.total ? ` (${note(s.points)}/${note(s.total)} pt)` : ""}</td></tr>
      </tbody></table>
      <table className="table table-sm table-bordered tableau-bulletin se-copie-table">
        <thead><tr><th style={{ width: "4%" }}>N°</th><th>{t("Question")}</th><th>{t("Réponse de l'élève")}</th><th>{t("Réponse attendue")}</th><th className="text-center">{t("Résultat")}</th></tr></thead>
        <tbody>{ev.questions.map((q, k) => {
          const d = (s.details || []).find((x) => x.id === q.id) || {}
          const r = reponseTexte(q, s.reponses?.[q.id])
          return (
            <tr key={q.id}><td>{k + 1}</td><td>{q.intitule}{q.notion && <div className="enseignant-bulletin">{q.notion}</div>}</td>
              <td className={r ? "" : "text-muted fst-italic"}>{r || t("Sans réponse")}</td><td className="small">{attenduTexte(q)}</td>
              <td className="text-center text-nowrap">{d.correct === true ? <span className="text-success fw-bold">✓ {note(d.obtenu)}/{note(d.max)}</span>
                : d.correct === false ? <span className="text-danger fw-bold">✗ 0/{note(d.max)}</span> : d.a_corriger ? <span className="text-warning">{t("À apprécier")}</span> : "—"}</td></tr>)
        })}</tbody>
      </table>
      <div className="small text-muted text-end">{t("SmartEval · NexIA School")}</div>
    </section>
  )
}

export function ResultatsEvaluation() {
  const { id } = useParams()
  const [ev, erreur, recharger] = useDonnees(() => rpc("smarteval_detail", { p_id: id }), [id])
  const [classe, setClasse] = useState(""), [occupe, setOccupe] = useState(""), [erreurExport, setErreurExport] = useState("")
  useEffect(() => { if (ev) rpc("smarteval_marquer_vu").then(signaler).catch(() => {}) }, [ev])
  useEffect(() => { const f = () => recharger(); window.addEventListener("smarteval:recharger", f); return () => window.removeEventListener("smarteval:recharger", f) }, [recharger])
  const filtree = useMemo(() => (ev ? { ...ev, soumissions: ev.soumissions.filter((s) => !classe || s.classe_id === classe) } : null), [ev, classe])
  const a = useMemo(() => (filtree ? analyserEvaluation(filtree) : null), [filtree])
  if (!ev) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>

  function imprimer() {
    document.body.classList.add("impression-ciblee")
    const fin = () => { document.body.classList.remove("impression-ciblee"); window.removeEventListener("afterprint", fin) }
    window.addEventListener("afterprint", fin); window.print()
  }
  async function exporter(type) {
    setErreurExport(""); setOccupe(type)
    try {
      const m = await import("../lib/smartevalPdf.js")
      if (type === "pdf") await m.telechargerCopiesPdf(filtree)
      else await m.telechargerResultatsExcel(filtree, a)
    } catch (x) { setErreurExport(x.message) } finally { setOccupe("") }
  }
  const s = a.synthese
  const tuile = (lib, v, cls = "") => <div className="col-6 col-md-3"><div className={`card h-100 ${cls}`}><div className="card-body py-2"><div className="small text-muted">{lib}</div><div className="fs-4 fw-semibold">{v}</div></div></div></div>
  return (
    <>
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2 no-print">
        <div><Link to="/smarteval" className="small">{t("← SmartEval")}</Link>
          <h1 className="h4 mb-1">{ev.titre} <Statut e={ev} /></h1>
          <div className="small text-muted">{[ev.matiere, ev.classes.map((c) => c.libelle).join(", "), t("Séquence {v0}", { v0: ev.sequence })].join(" · ")}</div>
          <div className="small"><span className="fw-semibold">{t("Compétence visée : ")}</span>{ev.competence}</div></div>
        <div className="d-flex flex-wrap gap-2">
          {ev.jeton && <Copier texte={lienEvaluation(ev.jeton)} libelle={t("Copier le lien")} className="btn btn-sm btn-outline-primary" />}
          <button className="btn btn-sm btn-outline-secondary" onClick={recharger}>{t("Actualiser")}</button>
        </div>
      </div>
      <Alerte onFermer={() => setErreurExport("")}>{erreurExport}</Alerte>
      {ev.classes.length > 1 && <div className="mb-3 no-print" style={{ maxWidth: 260 }}><select className="form-select form-select-sm" aria-label={t("Classe")} value={classe} onChange={(e) => setClasse(e.target.value)}>
        <option value="">{t("Toutes les classes")}</option>{ev.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>}

      <div className="no-print">
        <div className="row g-2 mb-3 se-synthese">
          {tuile(t("Soumissions"), s.soumissions)}
          {tuile(t("Taux de réussite (≥ 10/20)"), pc(s.taux_reussite), s.taux_reussite === null ? "" : s.taux_reussite >= 50 ? "border-success" : "border-danger")}
          {tuile(t("Moyenne"), s.moyenne === null ? "—" : `${note(s.moyenne)}/20`)}
          {tuile(t("Réponses à apprécier"), s.reponses_a_apprecier)}
        </div>

        <div className="card mb-3 se-analyse-ia border-primary"><div className="card-body">
          <h2 className="h6 mb-1">🤖 {t("Analyse et remédiation par votre IA")}</h2>
          <p className="small mb-2">{t("Copiez cette demande et collez-la dans l'IA connectée à votre compte (Claude, Grok…). Elle lira les soumissions grâce au connecteur NexIA School et vous proposera profils d'élèves, binômes et trinômes, exercices adaptés et activités d'intégration.")}</p>
          <div className="bg-light border rounded p-2 small mb-2 se-demande-ia">{demandeIA(ev.titre)}</div>
          <div className="d-flex flex-wrap gap-2"><Copier texte={demandeIA(ev.titre)} libelle={t("Copier la demande")} className="btn btn-sm btn-primary" />
            <a className="btn btn-sm btn-outline-primary" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer">{t("Ouvrir Claude")}</a></div>
        </div></div>

        {s.soumissions > 0 && <div className="row g-3 mb-3">
          <div className="col-lg-6"><div className="card h-100"><div className="card-header fw-semibold">{t("Réussite par notion")}</div>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0 se-notions">
              <thead className="table-light"><tr><th>{t("Notion")}</th><th style={{ width: "30%" }}>{t("Réussite")}</th><th>{t("Élèves en difficulté")}</th></tr></thead>
              <tbody>{a.par_notion.map((n) => <tr key={n.notion}><td>{t(n.notion)}</td><td><Barre v={n.taux_reussite} /><span className="small">{pc(n.taux_reussite)}</span></td>
                <td className="small">{n.eleves_en_difficulte.join(", ") || "—"}</td></tr>)}
                {!a.par_notion.length && <tr><td colSpan={3} className="small text-muted">{t("Aucune question corrigée automatiquement.")}</td></tr>}</tbody>
            </table></div></div></div>
          <div className="col-lg-6"><div className="card h-100"><div className="card-header fw-semibold">{t("Réussite par question")}</div>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0">
              <thead className="table-light"><tr><th>N°</th><th>{t("Question")}</th><th style={{ width: "30%" }}>{t("Réussite")}</th></tr></thead>
              <tbody>{a.par_question.map((q) => <tr key={q.id}><td>{q.numero}</td><td className="small">{q.intitule}</td>
                <td>{q.corrigible ? <><Barre v={q.taux_reussite} /><span className="small">{pc(q.taux_reussite)}</span></> : <span className="small text-muted">{q.type === "echelle" ? t("Non notée") : t("À apprécier")}</span>}</td></tr>)}</tbody>
            </table></div></div></div>
        </div>}

        {s.soumissions > 0 && <div className="card mb-3"><div className="card-header fw-semibold">{t("Profils des élèves")}</div>
          <div className="table-responsive"><table className="table table-sm align-middle mb-0 se-eleves">
            <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th className="text-end">{t("Note /20")}</th><th>{t("Notions à revoir")}</th><th>{t("Notions maîtrisées")}</th></tr></thead>
            <tbody>{a.eleves.map((e) => <tr key={e.numero}><td>{e.eleve}{!e.matricule && <span className="badge text-bg-light ms-1" title={t("Nom non retrouvé dans la liste de la classe")}>?</span>}</td><td>{e.classe}</td>
              <td className={`text-end fw-semibold ${e.reussi === false ? "text-danger" : ""}`}>{e.note20 === null ? "—" : note(e.note20)}</td>
              <td className="small text-danger">{e.notions_a_revoir.map((n) => t(n)).join(", ") || "—"}</td><td className="small text-success">{e.notions_maitrisees.map((n) => t(n)).join(", ") || "—"}</td></tr>)}</tbody>
          </table></div></div>}

        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
          <h2 className="h5 mb-0">{t("Copies des élèves ({v0})", { v0: s.soumissions })}</h2>
          {s.soumissions > 0 && <div className="d-flex flex-wrap gap-2">
            <button className="btn btn-sm btn-primary" disabled={!!occupe} onClick={() => exporter("pdf")}>{occupe === "pdf" ? t("Préparation…") : t("Télécharger les copies (PDF)")}</button>
            <button className="btn btn-sm btn-outline-success" disabled={!!occupe} onClick={() => exporter("excel")}>{occupe === "excel" ? t("Préparation…") : t("Télécharger les résultats (Excel)")}</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={imprimer}>{t("Imprimer les copies")}</button></div>}
        </div>
        {!s.soumissions && <p className="text-muted">{ev.statut === "ouverte" ? t("Aucune soumission pour le moment : partagez le lien avec vos élèves.") : t("Aucune soumission.")}</p>}
      </div>
      <div className="zone-impression se-copies">{filtree.soumissions.map((x) => <CopieEleve key={x.id} ev={ev} s={x} />)}</div>
    </>
  )
}

// ======================================================================================================
// Journal des soumissions (créations, liens générés, soumissions)
// ======================================================================================================
const EVENEMENTS = { soumission: "Soumission", creation: "Création", publication: "Lien généré" }
export function JournalSmartEval() {
  const [journal, erreur] = useDonnees(() => rpc("smarteval_journal"), [])
  const [filtre, setFiltre] = useState(""), [type, setType] = useState("")
  useEffect(() => { if (journal) rpc("smarteval_marquer_vu").then(signaler).catch(() => {}) }, [journal])
  if (!journal) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const evaluations = [...new Map(journal.map((j) => [j.evaluation_id, j.evaluation])).entries()]
  const lignes = journal.filter((j) => (!filtre || j.evaluation_id === filtre) && (!type || j.evenement === type))
  return (
    <>
      <Link to="/smarteval" className="small">{t("← SmartEval")}</Link>
      <h1 className="h4 mb-3">{t("Journal des soumissions")}</h1>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <select className="form-select form-select-sm" style={{ maxWidth: 320 }} aria-label={t("Évaluation")} value={filtre} onChange={(e) => setFiltre(e.target.value)}>
          <option value="">{t("Toutes les évaluations")}</option>{evaluations.map(([id, titre]) => <option key={id} value={id}>{titre}</option>)}</select>
        <select className="form-select form-select-sm" style={{ maxWidth: 220 }} aria-label={t("Événement")} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("Tous les événements")}</option>{Object.entries(EVENEMENTS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
      </div>
      <div className="card"><div className="table-responsive"><table className="table table-sm align-middle mb-0 se-journal">
        <thead className="table-light"><tr><th>{t("Date")}</th><th>{t("Événement")}</th><th>{t("Évaluation")}</th><th>{t("Élève")}</th><th>{t("Classe")}</th><th className="text-end">{t("Note /20")}</th></tr></thead>
        <tbody>{lignes.map((j, k) => (
          <tr key={k} className={j.nouvelle ? "table-warning" : ""}><td className="text-nowrap small">{dateHeure(j.le)}</td>
            <td>{t(EVENEMENTS[j.evenement])}{j.nouvelle && <span className="badge text-bg-danger ms-1">{t("Nouveau")}</span>}</td>
            <td><Link to={`/smarteval/${j.evaluation_id}`}>{j.evaluation}</Link></td><td>{j.eleve || ""}</td><td>{j.classe || ""}</td>
            <td className="text-end">{j.evenement === "soumission" ? (j.note20 === null ? "—" : note(j.note20)) : ""}</td></tr>))}
          {!lignes.length && <tr><td colSpan={6} className="text-center text-muted py-4">{t("Aucun événement.")}</td></tr>}</tbody>
      </table></div></div>
    </>
  )
}

