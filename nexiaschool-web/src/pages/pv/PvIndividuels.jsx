// PV de performances individuelles : par classe, par cycle ou pour tout l'établissement. Consultation élève par élève,
// commentaire (enseignant de la classe, direction, administration), PDF / Excel / CSV, publication aux parents
// (chaque parent ne voit que le PV de son enfant) et retrait de la publication.
import { useMemo, useState } from "react"
import { Alerte, useDonnees } from "../../composants/Communs.jsx"
import { periodePrecedente } from "../../lib/distinctions.js"
import { chargerComplementsIndividuels, chargerFinances, chargerGroupe, recalculerGroupe } from "../../lib/pv/donnees.js"
import { construireIndividuels } from "../../lib/pv/individuels.js"
import { pvIndividuelsPdf } from "../../lib/pv/pdf.js"
import { feuillesPvIndividuels, telechargerCsv, telechargerExcel } from "../../lib/pv/export.js"
import { reduire } from "../../lib/publication.js"
import { comparerNoms, dateHeure, nomComplet, note } from "../../lib/format.js"
import { rpc, supabase, verifier } from "../../supabase.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"
import PvIndividuelVue from "./PvIndividuelVue.jsx"
import { ChoixPeriode, classesFiltrees, contexteDocument, Filtres, Generation, nomFichierPv, ressourcesDocument, useReferencePv } from "./Outils.jsx"

const PORTEES = { classe: "Une classe", cycle: "Un cycle", etablissement: "Tout l'établissement" }

export default function PvIndividuels() {
  const ref = useReferencePv()
  const session = useSession()
  const { estAdmin, exercice, profil } = session
  const [portee, setPortee] = useState("classe")
  const [filtres, setFiltres] = useState({ cycle: "", section: "", niveau: "" })
  const [classeId, setClasseId] = useState("")
  const [periodeCode, setPeriodeCode] = useState("")
  const [inclurePaiement, setInclurePaiement] = useState(false)
  const [etat, setEtat] = useState({ enCours: false, avancement: "", erreur: "", donnees: null })
  // Enseignant : uniquement les classes où il intervient (commentaires)
  const [mesClasses] = useDonnees(async () => (estAdmin || !exercice ? null
    : new Set(verifier(await supabase.from("attributions").select("classe_id").eq("exercice_id", exercice.id).eq("enseignant_id", profil.id)).map((x) => x.classe_id))),
  [estAdmin, exercice?.id, profil?.id])
  const disponibles = estAdmin ? ref.classes : ref.classes.filter((c) => mesClasses?.has(c.id))
  const periode = ref.periodes.find((p) => p.code === periodeCode)
  const visees = portee === "classe" ? disponibles.filter((c) => c.id === classeId)
    : portee === "cycle" ? classesFiltrees(disponibles, filtres).filter((c) => filtres.cycle && c.cycleId === filtres.cycle)
      : classesFiltrees(disponibles, { ...filtres, cycle: "", niveau: "" })

  async function preparer() {
    setEtat({ enCours: true, avancement: "", erreur: "", donnees: null })
    try {
      // moyennes du cycle (réglage de l'établissement, administration seulement : un enseignant ne lit pas toutes les notes du
      // cycle, sa moyenne serait fausse) : on charge toutes les classes des cycles concernés pour les calculer
      const reglages = { ...ref.reglages, comparer_cycle: estAdmin && ref.reglages.comparer_cycle }
      const cyclesVises = new Set(visees.map((c) => c.cycleId).filter(Boolean))
      const aCharger = reglages.comparer_cycle ? ref.classes.filter((c) => visees.includes(c) || (c.cycleId && cyclesVises.has(c.cycleId))) : visees
      const avancement = (fait, total) => setEtat((e) => ({ ...e, avancement: t("Classe {v0} sur {v1}…", { v0: fait, v1: total }) }))
      const finances = estAdmin && inclurePaiement ? await chargerFinances() : null
      const groupe = await chargerGroupe(aCharger, exercice, periode, { toutes: ref.periodes, finances, avancement })
      const cible = new Set(groupe.filter((g) => visees.some((c) => c.id === g.classe.id)).flatMap((g) => g.resultats.map((r) => r.inscriptionId)))
      const complements = await chargerComplementsIndividuels([...cible], periode.code)
      const prec = periodePrecedente(periode, ref.periodes)
      const pvs = construireIndividuels({ groupe, periode, toutes: ref.periodes, annee: exercice.libelle, reglages, complements, finances,
        inclurePaiement, cible, precedent: prec ? recalculerGroupe(groupe, prec, ref.periodes) : null })
        .sort((a, b) => a.classe.ordre - b.classe.ordre || a.classe.libelle.localeCompare(b.classe.libelle, "fr")
          || comparerNoms(nomComplet(a.contenu.eleve), nomComplet(b.contenu.eleve)))
      setEtat({ enCours: false, avancement: "", erreur: "", donnees: { pvs, publies: complements.publies, periode, portee: libellePortee() } })
    } catch (e) { setEtat({ enCours: false, avancement: "", erreur: e.message, donnees: null }) }
  }
  function libellePortee() {
    if (portee === "classe") return visees[0]?.libelle || ""
    if (portee === "cycle") return ref.cycles.find((c) => c.id === filtres.cycle)?.libelle || ""
    return t("Tout l'établissement")
  }
  const pret = periode && visees.length

  return (
    <section aria-labelledby="pv-ind-titre">
      <h2 className="h5" id="pv-ind-titre">{t("PV de performances individuelles")}</h2>
      <p className="text-muted small">{estAdmin
        ? t("Un PV par élève : notes par matière et par période, évolution, points forts et faibles, absences, distinctions, décisions et recommandations. Publiez-les pour que chaque parent voie celui de son enfant.")
        : t("Consultez les PV des élèves de vos classes et rédigez votre commentaire.")}</p>
      {estAdmin && (
        <div className="btn-group btn-group-sm mb-2" role="group" aria-label={t("Portée")}>
          {Object.entries(PORTEES).map(([k, l]) => <button key={k} type="button" className={`btn ${portee === k ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setPortee(k)}>{t(l)}</button>)}
        </div>)}
      <div className="row g-2 mb-2">
        {portee !== "etablissement" && <Filtres valeur={filtres} onChange={setFiltres} champs={portee === "cycle" ? ["cycle", "section"] : ["cycle", "section", "niveau"]} />}
        {portee === "etablissement" && <Filtres valeur={filtres} onChange={setFiltres} champs={["section"]} />}
        {portee === "classe" && (
          <div className="col-sm-6 col-lg-3"><label className="form-label small mb-1">{t("Classe")}</label>
            <select className="form-select form-select-sm" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">{t("Classe…")}</option>{classesFiltrees(disponibles, filtres).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>)}
        <ChoixPeriode valeur={periodeCode} onChange={setPeriodeCode} />
      </div>
      {estAdmin && <div className="form-check small mb-2"><input className="form-check-input" type="checkbox" id="pvi-paiement" checked={inclurePaiement} onChange={(e) => setInclurePaiement(e.target.checked)} />
        <label className="form-check-label" htmlFor="pvi-paiement">{t("Inclure la situation financière (à jour ou non) dans les PV")}</label></div>}
      <button type="button" className="btn btn-primary mb-3" disabled={!pret || etat.enCours} onClick={preparer}>
        {etat.enCours ? (etat.avancement || t("Calcul en cours…")) : t("Préparer les PV ({v0} classe(s))", { v0: visees.length })}</button>
      <Alerte>{etat.erreur}</Alerte>
      {etat.donnees && <Liste d={etat.donnees} key={`${etat.donnees.periode.code}-${etat.donnees.pvs.length}`} />}
    </section>
  )
}

function Liste({ d }) {
  const ref = useReferencePv()
  const session = useSession()
  const { estAdmin } = session
  const [pvs, setPvs] = useState(d.pvs)
  const [publies, setPublies] = useState(d.publies)
  const [choisis, setChoisis] = useState(() => new Set(d.pvs.map((p) => p.inscriptionId)))
  const [ouvert, setOuvert] = useState(null), [recherche, setRecherche] = useState("")
  const [action, setAction] = useState({ enCours: false, message: "", erreur: "" })
  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return q ? pvs.filter((p) => `${nomComplet(p.contenu.eleve)} ${p.contenu.eleve.matricule} ${p.classe.libelle}`.toLowerCase().includes(q)) : pvs
  }, [pvs, recherche])
  const selection = pvs.filter((p) => choisis.has(p.inscriptionId))
  const titre = `${t("PV de performances individuelles")} — ${d.portee}`
  const sousTitre = `${d.periode.libelle} · ${session.exercice?.libelle || ""}`

  async function produire({ format, reference, genereLe, ressources }) {
    const nom = nomFichierPv(t("pv-individuels"), d.portee, d.periode.code, reference)
    const contenus = selection.map((p) => p.contenu)
    if (format === "xlsx") return telechargerExcel(feuillesPvIndividuels(contenus, { titre: `${titre} · ${sousTitre} · ${reference}` }), nom)
    if (format === "csv") return telechargerCsv(feuillesPvIndividuels(contenus, { titre: `${titre} · ${sousTitre} · ${reference}` }), nom)
    return pvIndividuelsPdf(contenus, contexteDocument(session, ref, { titre: t("PV de performances individuelles"), sousTitre, reference, genereLe, ressources }), nom)
  }

  async function publier() {
    if (!selection.length) return
    if (!confirm(t("Publier {v0} PV dans l'espace des parents ? Chaque parent ne verra que celui de son enfant ; une publication précédente de la même période est remplacée.", { v0: selection.length }))) return
    setAction({ enCours: true, message: "", erreur: "" })
    try {
      const ressources = await ressourcesDocument(session, { ...ref.reglages, afficher_cachet: false })
      const e = session.etablissement || {}
      const commun = { etablissement: { nom: e.nom, adresse: e.adresse, ville: e.ville, telephone: e.telephone, site_web: e.site_web, nom_chef: e.nom_chef },
        logo: await reduire(ressources.logo, 320), signataires: ref.reglages.signataires }
      const doc = await rpc("pv_enregistrer", { p: { type: "publication", format: "publication", titre: `${titre} · ${sousTitre}`,
        perimetre: { periode: d.periode.code, eleves: selection.length, portee: d.portee } } })
      let total = 0
      for (let k = 0; k < selection.length; k += 200) {        // envois par lots : grands établissements, connexions lentes
        const lot = selection.slice(k, k + 200)
        const r = await rpc("pv_publier", { p: { periode: d.periode.code, periode_libelle: d.periode.libelle, portee: d.portee, commun, document_id: doc.id,
          pv: lot.map((p) => ({ inscription_id: p.inscriptionId, contenu: { ...p.contenu, reference: doc.reference,
            commentaires: p.contenu.commentaires.map(({ texte, auteur, fonction }) => ({ texte, auteur, fonction })) } })) } })
          .catch((err) => { throw new Error(t("{v0} PV publié(s) avant l'erreur ; recommencez pour les autres. {v1}", { v0: total, v1: err.message })) })
        total += r.publies
      }
      const maintenant = new Date().toISOString()
      setPublies(new Map([...publies, ...selection.map((p) => [p.inscriptionId, maintenant])]))
      setAction({ enCours: false, erreur: "", message: t("{v0} PV publié(s) pour les parents (n° {v1}).", { v0: total, v1: doc.reference }) })
    } catch (err) { setAction({ enCours: false, message: "", erreur: err.message }) }
  }

  async function retirer() {
    const ids = selection.filter((p) => publies.has(p.inscriptionId)).map((p) => p.inscriptionId)
    if (!ids.length || !confirm(t("Retirer la publication de {v0} PV ? Les parents ne les verront plus.", { v0: ids.length }))) return
    setAction({ enCours: true, message: "", erreur: "" })
    try {
      const n = await rpc("pv_retirer", { p_periode: d.periode.code, p_inscriptions: ids })
      const m = new Map(publies); ids.forEach((i) => m.delete(i)); setPublies(m)
      setAction({ enCours: false, erreur: "", message: t("{v0} publication(s) retirée(s).", { v0: n }) })
    } catch (err) { setAction({ enCours: false, message: "", erreur: err.message }) }
  }

  // remplace le commentaire de l'utilisateur (chaque auteur a le sien)
  const majCommentaire = (inscriptionId, commentaire) => setPvs(pvs.map((p) => (p.inscriptionId !== inscriptionId ? p : { ...p, contenu: { ...p.contenu,
    commentaires: [...p.contenu.commentaires.filter((c) => c.auteurId !== session.profil?.id), ...(commentaire ? [commentaire] : [])] } })))
  const basculer = (id) => { const s = new Set(choisis); if (s.has(id)) s.delete(id); else s.add(id); setChoisis(s) }
  const tous = filtres.length > 0 && filtres.every((p) => choisis.has(p.inscriptionId))

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
        <input type="search" className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder={t("Rechercher un élève…")} value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <span className="small text-muted">{t("{v0} PV · {v1} sélectionné(s) · {v2} publié(s)", { v0: pvs.length, v1: selection.length, v2: pvs.filter((p) => publies.has(p.inscriptionId)).length })}</span>
      </div>
      <div className="table-responsive mb-3 pv-tableau"><table className="table table-sm table-hover small align-middle">
        <thead className="table-light"><tr>
          <th><input type="checkbox" className="form-check-input" aria-label={t("Tout sélectionner")} checked={tous}
            onChange={() => { const s = new Set(choisis); filtres.forEach((p) => (tous ? s.delete(p.inscriptionId) : s.add(p.inscriptionId))); setChoisis(s) }} /></th>
          <th>{t("Élève")}</th><th>{t("Classe")}</th><th className="text-end">{t("Moyenne")}</th><th className="text-end">{t("Moy. classe")}</th>
          <th>{t("Alertes")}</th><th>{t("Commentaire")}</th><th>{t("Publié")}</th><th></th></tr></thead>
        <tbody>{filtres.map((p) => {
          const c = p.contenu, nbAlertes = c.alertes.length + (c.alerteGenerale ? 1 : 0)
          return (
            <tr key={p.inscriptionId}>
              <td><input type="checkbox" className="form-check-input" aria-label={nomComplet(c.eleve)} checked={choisis.has(p.inscriptionId)} onChange={() => basculer(p.inscriptionId)} /></td>
              <td className="text-nowrap">{nomComplet(c.eleve)}</td><td>{p.classe.libelle}</td>
              <td className={`text-end fw-semibold ${c.moyenne !== null && c.moyenne < c.seuil ? "text-danger" : ""}`}>{c.moyenne === null ? "—" : note(c.moyenne)}</td>
              <td className="text-end">{c.moyenneClasse === null ? "—" : note(c.moyenneClasse)}</td>
              <td>{nbAlertes ? <span className="badge text-bg-warning">{nbAlertes}</span> : ""}</td>
              <td>{c.commentaires.length ? <span className="badge text-bg-info">{c.commentaires.length}</span> : ""}</td>
              <td>{publies.has(p.inscriptionId) ? <span className="badge text-bg-success" title={dateHeure(publies.get(p.inscriptionId))}>{t("publié")}</span> : ""}</td>
              <td><button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setOuvert(ouvert === p.inscriptionId ? null : p.inscriptionId)}>
                {ouvert === p.inscriptionId ? t("Fermer") : t("Voir")}</button></td>
            </tr>)
        })}</tbody></table></div>
      {ouvert && (() => { const p = pvs.find((x) => x.inscriptionId === ouvert); return p ? (
        <div className="card mb-3"><div className="card-body">
          <PvIndividuelVue c={p.contenu} />
          <EditeurCommentaire inscriptionId={p.inscriptionId} periode={d.periode.code} valeur={p.contenu.commentaires.find((c) => c.auteurId === session.profil?.id)?.texte || ""} onEnregistre={(c) => majCommentaire(p.inscriptionId, c)} />
        </div></div>) : null })()}
      {estAdmin && (
        <>
          <div className="d-flex flex-wrap gap-2 mb-2">
            <button type="button" className="btn btn-success" disabled={!selection.length || action.enCours} onClick={publier}>{t("Publier pour les parents ({v0})", { v0: selection.length })}</button>
            <button type="button" className="btn btn-outline-danger" disabled={!selection.some((p) => publies.has(p.inscriptionId)) || action.enCours} onClick={retirer}>{t("Retirer la publication")}</button>
          </div>
          {action.message && <div className="alert alert-success small py-2">{action.message}</div>}
          <Alerte>{action.erreur}</Alerte>
          <Generation desactive={!selection.length} raison={t("Sélectionnez au moins un élève.")} produire={produire} libelle={t("Générer les PV sélectionnés")}
            document={{ type: "individuel", titre: `${titre} · ${sousTitre}`, commentaire: "", partiel: false, avertissements: [],
              perimetre: { periode: d.periode.code, portee: d.portee, eleves: selection.length } }} />
        </>)}
    </div>
  )
}

function EditeurCommentaire({ inscriptionId, periode, valeur, onEnregistre }) {
  const [texte, setTexte] = useState(valeur)
  const [etat, setEtat] = useState({ enCours: false, ok: false, erreur: "" })
  async function enregistrer() {
    setEtat({ enCours: true, ok: false, erreur: "" })
    try {
      const r = await rpc("pv_commenter_eleve", { p_inscription: inscriptionId, p_periode: periode, p_commentaire: texte })
      onEnregistre(r ? { texte: r.commentaire, auteur: r.auteur, fonction: r.fonction, auteurId: r.auteur_id } : null)
      setEtat({ enCours: false, ok: true, erreur: "" })
    } catch (e) { setEtat({ enCours: false, ok: false, erreur: e.message }) }
  }
  return (
    <div className="mt-3 border-top pt-3">
      <label className="form-label small fw-semibold" htmlFor={`pvi-com-${inscriptionId}`}>{t("Votre commentaire (chaque enseignant, la direction et l'administration ont le leur)")}</label>
      <textarea id={`pvi-com-${inscriptionId}`} className="form-control form-control-sm mb-2" rows={3} maxLength={2000} value={texte} onChange={(e) => setTexte(e.target.value)} />
      <div className="d-flex align-items-center gap-2">
        <button type="button" className="btn btn-sm btn-primary" disabled={etat.enCours} onClick={enregistrer}>{etat.enCours ? t("Enregistrement…") : t("Enregistrer le commentaire")}</button>
        {etat.ok && <span className="small text-success">{t("Commentaire enregistré.")}</span>}
      </div>
      <Alerte>{etat.erreur}</Alerte>
    </div>
  )
}
