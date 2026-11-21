// SmartEval de l'enseignant indépendant : liste, éditeur (classe en texte libre, groupes facultatifs, matière imposée pour un
// groupe de département, anonymisation et matricule), aperçu, durée et publication (1 crédit). Aucune liste d'élèves n'est
// demandée. Les règles (crédits, matière du groupe, limite de réponses) sont appliquées par le serveur.
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import FormulaireEvaluation from "../../composants/FormulaireEvaluation.jsx"
import { DUREE_MAX, UNITES, finDuree, lienEvaluation, nouvelId, nouvelleQuestion } from "../../lib/smartevalOutils.js"
import { dateHeure, note } from "../../lib/format.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { Copier, EditeurQuestion, Statut } from "../SmartEval.jsx"
import { BandeauOffre } from "./EspaceEnseignant.jsx"

const BASE = "/enseignant/smarteval"
const groupesDe = (texte) => [...new Set(String(texte || "").split(/[,;]/).map((g) => g.trim()).filter(Boolean))].slice(0, 20)
const classesAffichees = (classe, groupes) => (groupes.length ? groupes.map((g) => `${classe} ${g}`) : [classe]).map((l) => ({ id: l, libelle: l }))

export default function ListeEvaluations() {
  const { recharger: rechargerSession } = useSession()
  const [liste, erreur, recharger] = useDonnees(() => rpc("se_liste"), [])
  const [msg, setMsg] = useState({}), [archives, setArchives] = useState(false)
  const naviguer = useNavigate()
  if (!liste) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const action = async (f, ok) => { setMsg({}); try { await f(); setMsg({ ok }); recharger(); rechargerSession() } catch (e) { setMsg({ erreur: e.message }) } }
  const visibles = liste.filter((e) => !!e.archivee === archives)
  return (
    <>
      <div className="se-bandeau mb-3">
        <h1 className="h3 mb-1">SmartEval <span className="badge se-badge-ia">IA</span></h1>
        <p className="mb-0 small">{t("Évaluations digitalisées : repérez qui est en difficulté, sur quelles notions, et laissez votre IA proposer la remédiation.")}</p>
      </div>
      <BandeauOffre />
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <div className="btn-group" role="group" aria-label={t("Affichage")}>
          <button type="button" className={`btn btn-sm ${!archives ? "btn-secondary" : "btn-outline-secondary"}`} onClick={() => setArchives(false)}>{t("Mes évaluations")}</button>
          <button type="button" className={`btn btn-sm ${archives ? "btn-secondary" : "btn-outline-secondary"}`} onClick={() => setArchives(true)}>{t("Archivées")}</button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => naviguer(`${BASE}/nouvelle`)}>＋ {t("Créer une évaluation digitalisée")}</button>
      </div>
      {!visibles.length && <p className="text-muted">{archives ? t("Aucune évaluation archivée.") : t("Aucune évaluation pour le moment.")}</p>}
      <div className="row g-3 mb-4">{visibles.map((e) => (
        <div className="col-lg-6" key={e.id}><div className="card h-100 se-evaluation" data-evaluation={e.id}><div className="card-body">
          <div className="d-flex justify-content-between gap-2 mb-1"><h2 className="h6 mb-0">{e.titre}</h2><Statut e={e} /></div>
          <div className="small text-muted mb-2">{[e.matiere, e.classe + (e.groupes?.length ? ` (${e.groupes.join(", ")})` : ""), t("{v0} question(s)", { v0: e.questions })].filter(Boolean).join(" · ")}
            {e.anonyme_ia && <span className="badge text-bg-light border ms-1">{t("anonymisée")}</span>}</div>
          {e.statut !== "brouillon" && <div className="small mb-3">{t("Réponses : ")}<strong>{e.soumissions}</strong>
            {e.nouvelles > 0 && <span className="badge text-bg-danger ms-1">{t("{v0} nouvelle(s)", { v0: e.nouvelles })}</span>}
            {e.moyenne !== null && <>{t(" · moyenne ")}<strong>{note(e.moyenne)}/20</strong></>}</div>}
          <div className="d-flex flex-wrap gap-2">
            {e.statut !== "brouillon" && <Link className="btn btn-sm btn-primary" to={`${BASE}/${e.id}`}>{t("Résultats")}</Link>}
            {e.statut === "brouillon" && <Link className="btn btn-sm btn-primary" to={`${BASE}/${e.id}/modifier`}>{t("Continuer")}</Link>}
            {e.jeton && <Copier texte={lienEvaluation(e.jeton)} libelle={t("Copier le lien")} className="btn btn-sm btn-outline-primary" />}
            {e.statut === "ouverte" && <button className="btn btn-sm btn-outline-secondary" onClick={() => confirm(t("Clore l'évaluation maintenant ? Les élèves ne pourront plus répondre.")) && action(() => rpc("se_clore", { p_id: e.id }), t("Évaluation close."))}>{t("Clore")}</button>}
            <button className="btn btn-sm btn-outline-secondary" onClick={() => confirm(t("Dupliquer cette évaluation ? La copie est un brouillon gratuit ; sa publication utilisera un crédit."))
              && action(async () => { const r = await rpc("se_dupliquer", { p_id: e.id }); naviguer(`${BASE}/${r.id}/modifier`) }, t("Copie créée."))}>{t("Dupliquer")}</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => action(() => rpc("se_archiver", { p_id: e.id, p_archivee: !e.archivee }), e.archivee ? t("Évaluation restaurée.") : t("Évaluation archivée."))}>
              {e.archivee ? t("Restaurer") : t("Archiver")}</button>
            <button className="btn btn-sm btn-outline-danger ms-auto" onClick={() => confirm(e.jeton
              ? t("Supprimer définitivement cette évaluation et ses {v0} réponse(s) ? Le crédit utilisé pour sa publication n'est pas restitué.", { v0: e.soumissions })
              : t("Supprimer ce brouillon ?")) && action(() => rpc("se_supprimer", { p_id: e.id }), t("Évaluation supprimée."))}>{t("Supprimer")}</button>
          </div>
        </div></div></div>))}</div>
    </>
  )
}

function controler(f, matiereImposee) {
  if (!f.titre.trim()) return t("Donnez un titre à l'évaluation.")
  if (!f.classe.trim()) return t("Indiquez la classe ou le niveau (ex. 6e, Terminale D).")
  if (!matiereImposee && !f.matiere.trim()) return t("Indiquez la matière.")
  if (!f.competence.trim()) return t("Indiquez la compétence visée.")
  if (!f.questions.length) return t("Ajoutez au moins une question.")
  for (const [k, q] of f.questions.entries()) {
    if (!q.intitule.trim()) return t("Question {v0} : écrivez l'intitulé.", { v0: k + 1 })
    if (["choix", "cases", "liste"].includes(q.type) && !q.options.some((o) => o.trim())) return t("Question {v0} : ajoutez au moins une option.", { v0: k + 1 })
  }
  return ""
}

export function EditeurIndependant() {
  const { id } = useParams()
  const naviguer = useNavigate()
  const { enseignant, recharger: rechargerSession } = useSession()
  const matiereImposee = enseignant.groupe?.matiere || ""
  const [ev, erreurChargement] = useDonnees(() => (id ? rpc("se_detail", { p_id: id }) : Promise.resolve(null)), [id])
  const [f, setF] = useState(null), [evId, setEvId] = useState(id || null)
  const [etape, setEtape] = useState("edition"), [erreur, setErreur] = useState(""), [occupe, setOccupe] = useState(false)
  const [duree, setDuree] = useState({ valeur: 3, unite: "jours" }), [publie, setPublie] = useState(null)

  useEffect(() => {
    if (f || (id && !ev)) return
    if (ev) {
      if (ev.jeton) { naviguer(`${BASE}/${ev.id}`, { replace: true }); return }
      setF({ titre: ev.titre, consignes: ev.consignes || "", competence: ev.competence, matiere: ev.matiere || matiereImposee, classe: ev.classe,
             groupes: (ev.groupes || []).join(", "), anonyme_ia: !!ev.anonyme_ia, demande_matricule: !!ev.demande_matricule,
             questions: ev.questions.map((q) => ({ ...nouvelleQuestion(q.type), ...q, echelle: q.echelle || nouvelleQuestion().echelle })) })
    } else setF({ titre: "", consignes: "", competence: "", matiere: matiereImposee, classe: "", groupes: "", anonyme_ia: false, demande_matricule: false,
                  questions: [nouvelleQuestion()] })
  }, [ev, f, id, matiereImposee, naviguer])

  if ((id && !ev) || !f) return <><Alerte>{erreurChargement}</Alerte>{!erreurChargement && <Chargement />}</>
  const groupes = groupesDe(f.groupes)
  const majQ = (k, q) => setF({ ...f, questions: f.questions.map((x, i) => (i === k ? q : x)) })
  const deplacer = (k, sens) => { const qs = [...f.questions]; [qs[k], qs[k + sens]] = [qs[k + sens], qs[k]]; setF({ ...f, questions: qs }) }
  const o = enseignant.offre
  const nomEnseignant = [enseignant.compte.prenom, enseignant.compte.nom].filter(Boolean).join(" ")
  const entete = { nom: nomEnseignant, devise: "", adresse: "", ville: "", telephone: "", site_web: "", annee: "", logo: "" }

  async function terminer() {
    const e = controler(f, matiereImposee)
    setErreur(e); if (e) { window.scrollTo({ top: 0, behavior: "smooth" }); return }
    setOccupe(true)
    try {
      const questions = f.questions.map((q) => ({ ...q, options: q.options.map((x) => x.trim()).filter(Boolean), acceptees: q.acceptees.filter(Boolean),
        points: q.type === "echelle" ? 0 : Number(q.points) || 0 }))
      const r = await rpc("se_enregistrer", { p: { id: evId, titre: f.titre, consignes: f.consignes, competence: f.competence, matiere: matiereImposee || f.matiere,
        classe: f.classe, groupes, anonyme_ia: f.anonyme_ia, demande_matricule: f.demande_matricule || f.anonyme_ia, questions } })
      setEvId(r.id); setEtape("apercu"); window.scrollTo({ top: 0 })
      if (!id) window.history.replaceState(null, "", `${import.meta.env.BASE_URL}enseignant/smarteval/${r.id}/modifier`)
    } catch (x) { setErreur(x.message); window.scrollTo({ top: 0, behavior: "smooth" }) } finally { setOccupe(false) }
  }

  async function generer() {
    if (!confirm(t("Publier cette évaluation utilisera 1 crédit (il vous en reste {v0}). Continuer ?", { v0: o.credits_restants }))) return
    setErreur(""); setOccupe(true)
    try {
      const r = await rpc("se_publier", { p_id: evId, p_valeur: Number(duree.valeur), p_unite: duree.unite, p_entete: entete })
      setPublie(r); setEtape("lien"); window.scrollTo({ top: 0 }); rechargerSession()
    } catch (x) { setErreur(x.message) } finally { setOccupe(false) }
  }

  const apercu = { titre: f.titre, consignes: f.consignes, supports: [], competence: f.competence, matiere: matiereImposee || f.matiere, entete,
    classes: classesAffichees(f.classe, groupes), demande_matricule: f.demande_matricule || f.anonyme_ia,
    questions: f.questions.map((q) => ({ ...q, options: q.options.filter((x) => x.trim()), points: q.type === "echelle" ? 0 : q.points })) }

  if (etape === "lien" && publie) {
    const lien = lienEvaluation(publie.jeton)
    return (
      <div className="se-colonne"><div className="se-carte se-carte-titre se-lien-genere">
        <h1 className="h4">✓ {t("Le lien de votre évaluation est prêt")}</h1>
        <p className="mb-2">{f.titre}</p>
        <div className="input-group mb-2"><input className="form-control font-monospace" readOnly value={lien} aria-label={t("Lien de l'évaluation")} onFocus={(e) => e.target.select()} />
          <Copier texte={lien} libelle={t("Copier")} /></div>
        <p className="small mb-3">{t("Les élèves peuvent répondre jusqu'au ")}<strong>{dateHeure(publie.ferme_le)}</strong>.</p>
        <div className="d-flex flex-wrap gap-2">
          <a className="btn btn-success" href={`https://wa.me/?text=${encodeURIComponent(`${f.titre}\n${lien}`)}`} target="_blank" rel="noopener noreferrer">{t("Partager sur WhatsApp")}</a>
          <Link className="btn btn-outline-primary" to={`${BASE}/${evId}`}>{t("Suivre les réponses")}</Link>
          <Link className="btn btn-outline-secondary" to={BASE}>{t("Mes évaluations")}</Link>
        </div>
      </div></div>)
  }

  if (etape === "apercu") return (
    <div className="se-colonne">
      <div className="alert alert-info d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>{t("Aperçu : voici exactement ce que verront vos élèves en ouvrant le lien.")}</span>
        <button className="btn btn-sm btn-outline-primary" onClick={() => setEtape("edition")}>← {t("Modifier l'évaluation")}</button>
      </div>
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
      <div className="se-apercu"><FormulaireEvaluation evaluation={apercu} mode="apercu" onEnvoyer={async () => null} /></div>
      <div className="se-carte se-duree">
        <h2 className="h5">{t("Durée de l'évaluation")}</h2>
        <div className="row g-2 align-items-end">
          <div className="col-auto"><label className="form-label small" htmlFor="duree-valeur">{t("Durée")}</label>
            <input id="duree-valeur" type="number" className="form-control" min={1} max={DUREE_MAX[duree.unite]} value={duree.valeur} onChange={(e) => setDuree({ ...duree, valeur: e.target.value })} /></div>
          <div className="col-auto"><label className="form-label small" htmlFor="duree-unite">{t("Unité")}</label>
            <select id="duree-unite" className="form-select" value={duree.unite} onChange={(e) => setDuree({ valeur: Math.min(Number(duree.valeur) || 1, DUREE_MAX[e.target.value]), unite: e.target.value })}>
              {UNITES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
          <div className="col small">{t("Réponses acceptées jusqu'au ")}<strong>{dateHeure(finDuree(duree.valeur, duree.unite))}</strong></div>
        </div>
        <p className="small text-muted mt-3 mb-0">{t("Publication : 1 crédit (crédits restants : {v0}). Les modifications avant la première réponse restent gratuites. Réponses acceptées : {v1} au maximum.",
          { v0: o.credits_restants, v1: o.soumissions_max })}</p>
        <div className="d-flex flex-wrap gap-2 mt-3">
          <button className="btn btn-outline-secondary" onClick={() => setEtape("edition")} disabled={occupe}>← {t("Modifier l'évaluation")}</button>
          <button className="btn btn-primary btn-lg se-generer" onClick={generer} disabled={occupe || o.credits_restants < 1 || !(Number(duree.valeur) >= 1 && Number(duree.valeur) <= DUREE_MAX[duree.unite])}>
            🔗 {t("Générer le lien de mon évaluation")}</button>
          {o.credits_restants < 1 && <Link className="btn btn-outline-primary" to="/enseignant/abonnement">{t("Obtenir des crédits")}</Link>}
        </div>
      </div>
    </div>
  )

  return (
    <div className="se-colonne se-editeur">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h1 className="h4 mb-0">{t("Créer une évaluation digitalisée")}</h1>
        <Link to={BASE} className="small">{t("← SmartEval")}</Link>
      </div>
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
      <div className="se-carte se-carte-titre">
        <input className="form-control se-titre-saisie" placeholder={t("Titre de l'évaluation")} maxLength={150} value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} aria-label={t("Titre de l'évaluation")} />
        <textarea className="form-control se-ligne mt-2" rows={2} placeholder={t("Consignes aux élèves (facultatif)")} maxLength={3000} value={f.consignes}
                  onChange={(e) => setF({ ...f, consignes: e.target.value })} aria-label={t("Consignes aux élèves (facultatif)")} />
      </div>
      <div className="se-carte">
        <div className="row g-3">
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="si-classe">{t("Classe")} <span className="text-danger">*</span></label>
            <input id="si-classe" className="form-control" maxLength={60} placeholder={t("ex. 6e, Terminale D, Licence 1")} value={f.classe} onChange={(e) => setF({ ...f, classe: e.target.value })} />
            <div className="form-text">{t("Texte libre : aucune liste d'élèves n'est nécessaire.")}</div></div>
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="si-groupes">{t("Groupe(s) (facultatif)")}</label>
            <input id="si-groupes" className="form-control" maxLength={200} placeholder={t("ex. A, B, C")} value={f.groupes} onChange={(e) => setF({ ...f, groupes: e.target.value })} />
            <div className="form-text">{t("Séparés par des virgules : l'élève choisira son groupe en répondant.")}</div></div>
          <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="si-matiere">{t("Matière")} <span className="text-danger">*</span></label>
            {matiereImposee
              ? <input id="si-matiere" className="form-control" readOnly value={matiereImposee} />
              : <input id="si-matiere" className="form-control" maxLength={80} placeholder={t("ex. Mathématiques")} value={f.matiere} onChange={(e) => setF({ ...f, matiere: e.target.value })} />}
            {matiereImposee && <div className="form-text">🔒 {t("Matière de votre abonnement de groupe.")}</div>}</div>
          <div className="col-12"><label className="form-label small fw-semibold" htmlFor="si-competence">{t("Compétence visée")} <span className="text-danger">*</span></label>
            <textarea id="si-competence" className="form-control" rows={2} maxLength={600} value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })}
                      placeholder={t("ex. Résoudre des problèmes de proportionnalité dans des situations de vie courante")} /></div>
          <div className="col-12">
            <div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="si-anonyme" checked={f.anonyme_ia}
              onChange={(e) => setF({ ...f, anonyme_ia: e.target.checked, demande_matricule: e.target.checked || f.demande_matricule })} />
              <label className="form-check-label small" htmlFor="si-anonyme">{t("Anonymisation pour l'IA (désactivée par défaut) : une fois activée, l'assistant ne lit plus les noms des élèves, seulement leurs matricules ; le matricule devient obligatoire dans le formulaire.")}</label></div>
            <div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="si-matricule" checked={f.demande_matricule || f.anonyme_ia}
              disabled={f.anonyme_ia} onChange={(e) => setF({ ...f, demande_matricule: e.target.checked })} />
              <label className="form-check-label small" htmlFor="si-matricule">{t("Rendre le matricule obligatoire")}</label></div>
          </div>
        </div>
      </div>
      {f.questions.map((q, k) => (
        <EditeurQuestion key={q.id} q={q} numero={k + 1} total={f.questions.length} onChange={(x) => majQ(k, x)}
          onSupprimer={() => setF({ ...f, questions: f.questions.filter((_, i) => i !== k) })}
          onDupliquer={() => setF({ ...f, questions: [...f.questions.slice(0, k + 1), { ...structuredClone(q), id: nouvelId() }, ...f.questions.slice(k + 1)] })}
          onDeplacer={(sens) => deplacer(k, sens)} />))}
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-5">
        <button type="button" className="btn btn-outline-primary se-ajouter-question" disabled={f.questions.length >= 100}
                onClick={() => setF({ ...f, questions: [...f.questions, nouvelleQuestion(f.questions.at(-1)?.type || "choix")] })}>＋ {t("Ajouter une question")}</button>
        <button type="button" className="btn btn-primary px-4 se-terminer" onClick={terminer} disabled={occupe}>{t("Terminer")}</button>
      </div>
    </div>
  )
}
