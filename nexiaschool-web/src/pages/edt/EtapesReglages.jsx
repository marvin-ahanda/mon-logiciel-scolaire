// Étapes 4 à 6 : contraintes générales et priorités, vérification de faisabilité, génération (Web Worker).
import { useEffect, useMemo, useRef, useState } from "react"
import { t } from "../../i18n.jsx"
import { CRITERES, NOM_JOUR, nomEnseignant, normaliserTexte, PRIORITES } from "../../lib/edt/modele.js"
import { analyser, expliquerEchec } from "../../lib/edt/faisabilite.js"
import { verifierGrille } from "../../lib/edt/moteur.js"
import { signature } from "../../lib/edt/etat.js"
import { ChoixJours, Nombre, Occupation, Question, tr } from "./communs.jsx"

// --- Étape 4 : contraintes générales ---------------------------------------------------------------------------
export function EtapeContraintes({ etat, maj, config }) {
  const g = etat.generales
  const majG = (groupe, k, v) => maj((e) => ({ ...e, resultat: null, generales: { ...e.generales, [groupe]: { ...e.generales[groupe], [k]: v } } }))
  const majR = (cle, k, v) => maj((e) => ({ ...e, resultat: null, reglagesEnseignants: { ...e.reglagesEnseignants, [cle]: { ...(e.reglagesEnseignants[cle] || {}), [k]: v } } }))
  const [recherche, setRecherche] = useState("")
  const heures = useMemo(() => { const m = new Map(); for (const a of config.affectations) m.set(a.enseignant, (m.get(a.enseignant) || 0) + Number(a.volume)); return m }, [config])
  const q = normaliserTexte(recherche)
  const ens = config.enseignants.filter((e) => !q || normaliserTexte(nomEnseignant(e)).includes(q))
  return (
    <div className="row g-3">
      <div className="col-lg-6">
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Enseignants (valeurs générales)")}</h3>
          <div className="row g-2 mb-2">
            <div className="col-4"><label className="form-label small" htmlFor="g-ej">{t("Heures par jour au maximum")}</label>
              <Nombre id="g-ej" valeur={g.enseignant.max_jour} onChange={(v) => majG("enseignant", "max_jour", v)} /></div>
            <div className="col-4"><label className="form-label small" htmlFor="g-ec">{t("Heures consécutives au maximum")}</label>
              <Nombre id="g-ec" valeur={g.enseignant.max_consecutives} onChange={(v) => majG("enseignant", "max_consecutives", v)} /></div>
            <div className="col-4"><label className="form-label small" htmlFor="g-es">{t("Heures par semaine au maximum")}</label>
              <Nombre id="g-es" max={80} valeur={g.enseignant.max_semaine} onChange={(v) => majG("enseignant", "max_semaine", v)} /></div>
          </div>
          <div className="form-label small mb-1">{t("Disponibilités déclarées dans le fichier")}</div>
          {[["strictes", t("Strictes : aucun cours en dehors (indisponibilités)")], ["preferences", t("Souhaits : respectés autant que possible (préférences)")]].map(([k, lib]) => (
            <div key={k} className="form-check"><input className="form-check-input" type="radio" name="dispo" id={`dispo-${k}`} checked={g.enseignant.disponibilites === k}
              onChange={() => majG("enseignant", "disponibilites", k)} /><label className="form-check-label small" htmlFor={`dispo-${k}`}>{lib}</label></div>))}
        </div>
        <div className="card card-body mb-3">
          <h3 className="h6">{t("Classes (valeurs générales)")}</h3>
          <div className="row g-2">
            <div className="col-6"><label className="form-label small" htmlFor="g-cj">{t("Heures de cours par jour au maximum")}</label>
              <Nombre id="g-cj" valeur={g.classe.max_jour} onChange={(v) => majG("classe", "max_jour", v)} /></div>
            <div className="col-6"><label className="form-label small" htmlFor="g-cc">{t("Heures consécutives d'une même matière au maximum")}</label>
              <Nombre id="g-cc" valeur={g.classe.max_consecutives} onChange={(v) => majG("classe", "max_consecutives", v)} /></div>
          </div>
        </div>
        <div className="card card-body">
          <h3 className="h6">{t("Priorités des contraintes de confort")}</h3>
          <p className="small text-muted">{t("Les contraintes obligatoires ne sont jamais enfreintes. Celles-ci sont optimisées selon leur priorité.")}</p>
          <table className="table table-sm small align-middle mb-0"><tbody>{CRITERES.map(([k, lib]) => (
            <tr key={k}><td>{t(lib)}</td><td style={{ width: 140 }}>
              <select className="form-select form-select-sm" aria-label={t(lib)} value={g.priorites[k]} onChange={(e) => majG("priorites", k, e.target.value)}>
                {PRIORITES.map(([p, l]) => <option key={p} value={p}>{t(l)}</option>)}</select></td></tr>))}</tbody></table>
        </div>
      </div>
      <div className="col-lg-6">
        <div className="card card-body">
          <div className="d-flex justify-content-between align-items-center gap-2 mb-2"><h3 className="h6 mb-0">{t("Réglages par enseignant")}</h3>
            <input type="search" className="form-control form-control-sm edt-recherche" placeholder={t("Rechercher un enseignant")} aria-label={t("Rechercher un enseignant")} value={recherche} onChange={(e) => setRecherche(e.target.value)} /></div>
          <p className="small text-muted">{t("Vide = valeur générale. Les jours préférés sont des souhaits ; les jours disponibles viennent du fichier.")}</p>
          <div className="edt-liste-ens">{ens.map((e) => {
            const r = etat.reglagesEnseignants[e.cle] || {}
            return (
              <details key={e.cle} className="border rounded p-2 mb-2">
                <summary className="small"><strong>{nomEnseignant(e)}</strong> · {heures.get(e.cle) || 0} h · {e.jours?.length ? e.jours.map((j) => t(NOM_JOUR[j]).slice(0, 3)).join(", ") : t("tous les jours")}</summary>
                <div className="row g-2 mt-1">
                  <div className="col-4"><label className="form-label small" htmlFor={`r-j-${e.cle}`}>{t("Max./jour")}</label><Nombre id={`r-j-${e.cle}`} valeur={r.max_jour} placeholder={g.enseignant.max_jour} onChange={(v) => majR(e.cle, "max_jour", v)} /></div>
                  <div className="col-4"><label className="form-label small" htmlFor={`r-c-${e.cle}`}>{t("Max. consécutives")}</label><Nombre id={`r-c-${e.cle}`} valeur={r.max_consecutives} placeholder={g.enseignant.max_consecutives} onChange={(v) => majR(e.cle, "max_consecutives", v)} /></div>
                  <div className="col-4"><label className="form-label small" htmlFor={`r-s-${e.cle}`}>{t("Max./semaine")}</label><Nombre id={`r-s-${e.cle}`} max={80} valeur={r.max_semaine} placeholder={g.enseignant.max_semaine} onChange={(v) => majR(e.cle, "max_semaine", v)} /></div>
                </div>
                <div className="mt-2 d-flex flex-wrap gap-2 align-items-center"><span className="small text-muted">{t("Jours préférés :")}</span>
                  <ChoixJours jours={etat.horaires.jours} valeur={r.jours_preferes} onChange={(v) => majR(e.cle, "jours_preferes", v)} /></div>
              </details>)
          })}</div>
        </div>
      </div>
    </div>
  )
}

// --- Étape 5 : faisabilité -------------------------------------------------------------------------------------------
export function EtapeFaisabilite({ etat, config, repondreQ, setEtape, analyse }) {
  const a = analyse
  if (!a) return null
  const c = a.chiffres
  return (
    <>
      {a.ok ? <div className="alert alert-success">{t("Aucune contrainte bloquante détectée : la génération peut être lancée.")}</div>
        : <div className="alert alert-danger">{t("{v0} contrainte(s) bloquante(s) : la génération est impossible tant qu'elles ne sont pas levées. Répondez aux questions ci-dessous ou modifiez les étapes précédentes. Aucune contrainte obligatoire n'est assouplie sans votre accord.", { v0: a.erreurs.length })}</div>}
      {c && <div className="row g-2 mb-3">
        {[[t("Heures à placer"), c.total.heures], [t("dont permanences"), c.total.permanences], [t("Classes"), c.total.classes], [t("Enseignants"), c.total.enseignants],
          [t("Créneaux par semaine"), c.total.creneaux], [t("Jours × périodes"), `${c.total.jours} × ${c.total.periodes}`]].map(([lib, v]) => (
          <div key={lib} className="col-6 col-md-4 col-xl-2"><div className="card card-body py-2 text-center"><div className="fs-5 fw-semibold">{v}</div><div className="small text-muted">{lib}</div></div></div>))}
      </div>}
      {a.erreurs.map((e, i) => (
        <div key={i} className="card border-danger mb-2"><div className="card-body py-2">
          <div className="fw-semibold text-danger mb-1">{tr(e)}</div>
          {(e.questions || []).map((q) => <Question key={q.id} q={q} joursOuvres={config.horaires.jours} onRepondre={repondreQ} onEtape={setEtape} />)}
        </div></div>))}
      {!!a.avertissements.length && <div className="alert alert-warning small"><strong>{t("Points de vigilance")}</strong><ul className="mb-0">{a.avertissements.map((w, i) => <li key={i}>{tr(w)}</li>)}</ul></div>}
      {c && <div className="row g-3">
        <div className="col-lg-6"><details className="card card-body" open={c.classes.length <= 12}><summary className="fw-semibold">{t("Bilan par classe")}</summary>
          <div className="table-responsive"><table className="table table-sm small align-middle mt-2 mb-0"><thead><tr><th>{t("Classe")}</th><th>{t("Cours")}</th><th>{t("Perm.")}</th><th>{t("Créneaux")}</th><th>{t("Occupation")}</th></tr></thead>
            <tbody>{c.classes.map((x) => <tr key={x.id}><td>{x.libelle}</td><td>{x.cours}</td><td>{x.permanences}</td><td>{x.creneaux}</td><td><Occupation taux={x.taux} /></td></tr>)}</tbody></table></div></details></div>
        <div className="col-lg-6"><details className="card card-body" open={c.enseignants.length <= 12}><summary className="fw-semibold">{t("Bilan par enseignant")}</summary>
          <div className="table-responsive"><table className="table table-sm small align-middle mt-2 mb-0"><thead><tr><th>{t("Enseignant")}</th><th>{t("Heures")}</th><th>{t("Créneaux disponibles")}</th><th>{t("Occupation")}</th></tr></thead>
            <tbody>{c.enseignants.map((x) => <tr key={x.cle}><td>{x.nom}</td><td>{x.heures}</td><td>{x.disponibles}</td><td><Occupation taux={x.taux} /></td></tr>)}</tbody></table></div></details></div>
        {!!c.salles.length && <div className="col-12"><div className="card card-body"><h3 className="h6">{t("Salles spécialisées")}</h3>
          <table className="table table-sm small mb-0"><thead><tr><th>{t("Type")}</th><th>{t("Salles")}</th><th>{t("Heures exigées")}</th><th>{t("Capacité (heures)")}</th></tr></thead>
            <tbody>{c.salles.map((s) => <tr key={s.type}><td>{s.type}</td><td>{s.salles}</td><td>{s.heures}</td><td>{s.capacite}</td></tr>)}</tbody></table></div></div>}
      </div>}
    </>
  )
}

/** Analyse de faisabilité (calcul rapide, sur le fil principal). */
export const useAnalyse = (config, actif) => useMemo(() => (actif ? analyser(config) : null), [config, actif])

// --- Étape 6 : génération --------------------------------------------------------------------------------------------
const INTENSITES = [["0.4", "Rapide"], ["1", "Normale"], ["2.5", "Approfondie"]]

export function EtapeGeneration({ etat, maj, config, setEtape, repondreQ }) {
  const [variantes, setVariantes] = useState(1), [intensite, setIntensite] = useState("1")
  const [suivi, setSuivi] = useState(null)          // { [variante]: { phase, fait, total } }
  const [resultats, setResultats] = useState([])    // [{ variante, graine, resultat }]
  const [erreur, setErreur] = useState("")
  const workers = useRef([])
  const sig = useMemo(() => signature(config), [config])
  const enCours = suivi && Object.values(suivi).some((s) => !s.termine)
  useEffect(() => () => workers.current.forEach((w) => w.terminate()), [])

  function lancer() {
    setErreur(""); setResultats([])
    workers.current.forEach((w) => w.terminate()); workers.current = []
    const n = Number(variantes), graineBase = sig % 100000
    const etatSuivi = Object.fromEntries([...Array(n).keys()].map((v) => [v, { phase: "placement", fait: 0, total: 1 }]))
    setSuivi(etatSuivi)
    for (let v = 0; v < n; v++) {
      const w = new Worker(new URL("../../lib/edt/worker.js", import.meta.url), { type: "module" })
      workers.current.push(w)
      w.onmessage = (ev) => {
        const m = ev.data
        if (m.type === "progres") setSuivi((s) => ({ ...s, [m.variante]: { ...s[m.variante], ...m } }))
        else if (m.type === "resultat") {
          setSuivi((s) => ({ ...s, [m.variante]: { ...s[m.variante], termine: true } }))
          setResultats((r) => [...r, { variante: m.variante, graine: m.graine, resultat: m.resultat, violations: verifierGrille(config, m.resultat.grille) }].sort((a, b) => a.variante - b.variante))
          w.terminate()
        } else if (m.type === "erreur") { setErreur(m.message); setSuivi((s) => ({ ...s, [m.variante]: { ...s[m.variante], termine: true } })); w.terminate() }
      }
      w.onerror = (e) => { setErreur(e.message || t("Erreur du moteur de génération.")); setSuivi((s) => ({ ...s, [v]: { ...s[v], termine: true } })) }
      w.postMessage({ config, graine: graineBase + v * 7919 + 1, intensite: Number(intensite), variante: v })
    }
  }
  function annuler() {
    workers.current.forEach((w) => w.terminate()); workers.current = []
    setSuivi(null); setResultats([])
  }
  function choisir(r) {
    maj((e) => ({ ...e, resultat: { grille: r.resultat.grille, criteres: r.resultat.criteres, cout: r.resultat.cout, graine: r.graine, signature: sig, duree: r.resultat.duree, genere_le: new Date().toISOString() } }))
    setEtape(7)
  }
  const complets = resultats.filter((r) => r.resultat.complet && !r.violations.length)
  const echec = !enCours && resultats.length && !complets.length ? resultats[0] : null
  const explications = useMemo(() => (echec ? expliquerEchec(config, echec.resultat.nonPlaces) : []), [echec, config])

  return (
    <>
      <div className="card card-body mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-sm-4"><label className="form-label small" htmlFor="gen-var">{t("Nombre de propositions")}</label>
            <select className="form-select form-select-sm" id="gen-var" value={variantes} disabled={enCours} onChange={(e) => setVariantes(e.target.value)}>
              <option value="1">{t("Une seule")}</option><option value="2">{t("Deux variantes")}</option><option value="3">{t("Trois variantes")}</option></select></div>
          <div className="col-sm-4"><label className="form-label small" htmlFor="gen-int">{t("Recherche")}</label>
            <select className="form-select form-select-sm" id="gen-int" value={intensite} disabled={enCours} onChange={(e) => setIntensite(e.target.value)}>
              {INTENSITES.map(([k, lib]) => <option key={k} value={k}>{t(lib)}</option>)}</select></div>
          <div className="col-sm-4 d-flex gap-2">
            {!enCours ? <button type="button" className="btn btn-primary btn-sm flex-grow-1" onClick={lancer}>{resultats.length ? t("Relancer la génération") : t("Lancer la génération")}</button>
              : <button type="button" className="btn btn-outline-danger btn-sm flex-grow-1" onClick={annuler}>{t("Annuler")}</button>}
          </div>
        </div>
        <p className="small text-muted mb-0 mt-2">{t("Le calcul se fait en arrière-plan sur cet appareil : vous pouvez continuer à utiliser l'application. Même données et même proposition = même résultat.")}</p>
        {etat.resultat && etat.resultat.signature === sig && !suivi && <div className="alert alert-info small mt-2 mb-0">{t("Un emploi du temps a déjà été généré avec ces données.")} <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setEtape(7)}>{t("Le voir")}</button></div>}
      </div>
      {erreur && <div className="alert alert-danger">{erreur}</div>}
      {suivi && Object.entries(suivi).map(([v, s]) => {
        const pct = s.total ? Math.round((s.fait / s.total) * 100) : 0
        return (
          <div key={v} className="mb-2">
            <div className="d-flex justify-content-between small"><span>{t("Proposition {v0}", { v0: Number(v) + 1 })} — {s.termine ? t("terminée") : s.phase === "placement" ? t("placement des cours : {v0} / {v1}", { v0: s.fait, v1: s.total }) : t("optimisation : {v0} %", { v0: pct })}</span></div>
            <div className="progress" role="progressbar" aria-valuenow={s.termine ? 100 : pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("Proposition {v0}", { v0: Number(v) + 1 })}>
              <div className={`progress-bar${s.termine ? " bg-success" : " progress-bar-striped progress-bar-animated"}${s.phase === "optimisation" ? "" : " bg-info"}`} style={{ width: `${s.termine ? 100 : pct}%` }} /></div>
          </div>)
      })}
      {!!complets.length && !enCours && (
        <div className="card card-body mt-3">
          <h3 className="h6">{t("Propositions obtenues")}</h3>
          <p className="small text-muted">{t("Toutes respectent les contraintes obligatoires. Comparez leur confort puis choisissez-en une.")}</p>
          <div className="table-responsive"><table className="table table-sm small align-middle mb-0">
            <thead><tr><th>{t("Proposition")}</th><th>{t("Heures creuses (classes)")}</th><th>{t("Heures creuses (enseignants)")}</th><th>{t("Répétitions dans la journée")}</th><th>{t("Jours de présence des enseignants")}</th><th>{t("Matières du matin placées l'après-midi")}</th><th>{t("Score (plus bas = mieux)")}</th><th /></tr></thead>
            <tbody>{complets.map((r) => {
              const q = r.resultat.criteres, meilleur = Math.min(...complets.map((x) => x.resultat.cout)) === r.resultat.cout
              return <tr key={r.variante} className={meilleur ? "table-success" : ""}><td>{r.variante + 1}{meilleur && complets.length > 1 ? ` (${t("la meilleure")})` : ""}</td><td>{q.trousClasses}</td><td>{q.trousEnseignants}</td><td>{q.repetitions}</td><td>{q.joursEnseignants}</td><td>{q.matiereApresMidi}</td><td>{Math.round(r.resultat.cout)}</td>
                <td><button type="button" className="btn btn-sm btn-primary" onClick={() => choisir(r)}>{t("Choisir")}</button></td></tr>
            })}</tbody></table></div>
        </div>)}
      {echec && (
        <div className="card border-danger mt-3"><div className="card-body">
          <h3 className="h6 text-danger">{t("Aucun emploi du temps ne respecte toutes les contraintes obligatoires")}</h3>
          <p className="small">{t("{v0} heure(s) sur {v1} n'ont pas pu être placées sans enfreindre une contrainte obligatoire. Aucune contrainte n'a été assouplie. Voici ce qui bloque et les questions qui permettraient d'avancer :", { v0: echec.resultat.nonPlaces.length, v1: echec.resultat.grille.length + echec.resultat.nonPlaces.length })}</p>
          {explications.map((x, i) => (
            <div key={i} className="border rounded p-2 mb-2">
              <div className="fw-semibold small">{tr(x)}</div>
              {!!x.raisons.length && <ul className="small mb-1">{x.raisons.map((r, k) => <li key={k}>{tr(r)}</li>)}</ul>}
              {x.questions.map((q) => <Question key={q.id} q={q} joursOuvres={config.horaires.jours} onRepondre={(qq, v) => { repondreQ(qq, v); setResultats([]); setSuivi(null) }} />)}
            </div>))}
          <p className="small text-muted mb-0">{t("Autres pistes : réduire certains volumes horaires ou permanences (étape 3), libérer des créneaux interdits, augmenter les maximums journaliers (étape 4), ajouter des salles spécialisées.")}</p>
        </div></div>)}
    </>
  )
}
