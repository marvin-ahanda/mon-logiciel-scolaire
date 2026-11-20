// Espace parents : choix du profil (personnel / parent), connexion par l'élève (nom et prénom + matricule),
// portail de l'élève : bilan disciplinaire daté, bulletins publiés, courrier à l'école et réponses.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Alerte, Chargement } from "../composants/Communs.jsx"
import Lettre from "../composants/Lettre.jsx"
import { Bulletin } from "./Bulletins.jsx"
import { lireAppareil, oublierAppareil } from "../lib/appareil.js"
import { image, nomDeFichier, telechargerBulletinsPdf } from "../lib/bulletinPdf.js"
import { filigrane as faireFiligrane } from "../lib/bulletinVerif.js"
import { calculerBilans } from "../lib/discipline.js"
import { certificatsPdf, reglages } from "../lib/certificatPdf.js"
import { pvIndividuelsPdf } from "../lib/pv/pdf.js"
import PvIndividuelVue from "./pv/PvIndividuelVue.jsx"
import { OBJETS, QUALITES, SERVICES, dateLongue, libelleObjet, remerciement } from "../lib/courrier.js"
import { date, dateHeure, note } from "../lib/format.js"
import { enregistrerSessionParent, lireSessionParent, oublierSessionParent, rpcParent } from "../lib/parent.js"
import { rpc } from "../supabase.js"
import { ChoixLangue, t, traduireErreur } from "../i18n.jsx"

function Cadre({ titre, children, large }) {
  return (
    <div className="row justify-content-center mt-4 mt-md-5 mx-0">
      <div className={large ? "col-sm-11 col-md-9 col-lg-7" : "col-sm-10 col-md-7 col-lg-5 col-xl-4"}>
        <div className="card shadow-sm"><div className="card-body p-4">
          <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
            <h1 className="h4 mb-0 text-primary d-flex align-items-center gap-2"><img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="32" height="32" className="rounded-2" />NexIA School</h1>
            <ChoixLangue />
          </div>
          {titre && <p className="text-muted mb-4">{titre}</p>}
          {children}
        </div></div>
        <p className="small text-center text-muted mt-3"><Link to="/">{t("Accueil")}</Link> · <Link to="/confidentialite">{t("Confidentialité")}</Link></p>
      </div>
    </div>
  )
}

// --- Après le nom et le code de l'établissement : personnel ou parent ? --------------------------------------
export function ChoixProfil() {
  const naviguer = useNavigate()
  const appareil = lireAppareil()
  useEffect(() => { if (!appareil) naviguer("/etablissement", { replace: true }) }, [appareil, naviguer])
  if (!appareil) return null
  return (
    <Cadre titre={t("Qui êtes-vous ?")}>
      <p className="fw-semibold mb-3">{appareil.etablissement}</p>
      <div className="d-grid gap-3 choix-profil">
        <Link className="btn btn-outline-primary btn-lg text-start choix-profil-carte" to="/connexion">
          <span className="choix-profil-icone" aria-hidden="true">🧑‍🏫</span>
          <span><span className="fw-semibold d-block">{t("Personnel")}</span><span className="small text-muted">{t("Administration, enseignants, surveillants, service financier")}</span></span></Link>
        <Link className="btn btn-outline-success btn-lg text-start choix-profil-carte" to="/parent/connexion">
          <span className="choix-profil-icone" aria-hidden="true">👪</span>
          <span><span className="fw-semibold d-block">{t("Parent d'élève")}</span><span className="small text-muted">{t("Discipline, bulletins et courrier de votre enfant")}</span></span></Link>
      </div>
      <button className="btn btn-link btn-sm px-0 mt-3" onClick={() => { oublierAppareil(); naviguer("/etablissement") }}>{t("Changer d'établissement")}</button>
    </Cadre>
  )
}

// --- Connexion d'un parent ---------------------------------------------------------------------------------
export function ConnexionParent() {
  const naviguer = useNavigate()
  const appareil = lireAppareil()
  const [eleve, setEleve] = useState(""), [matricule, setMatricule] = useState(""), [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false)
  useEffect(() => { if (!appareil) naviguer("/etablissement", { replace: true }) }, [appareil, naviguer])
  if (!appareil) return null
  async function valider(e) {
    e.preventDefault(); setErreur(""); setEnvoi(true)
    try {
      const r = await rpc("parent_connexion", { p_jeton: appareil.jeton, p_eleve: eleve, p_matricule: matricule })
      if (r.erreur === "jeton") { oublierAppareil(); return naviguer("/etablissement") }
      if (r.erreur) return setErreur(traduireErreur(r.erreur))
      enregistrerSessionParent({ jeton: r.jeton, eleve: r.eleve, classe: r.classe, etablissement: r.etablissement })
      naviguer("/parent")
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <Cadre titre={t("Espace parents")}>
      <p className="fw-semibold mb-0">{appareil.etablissement}</p>
      <Link className="btn btn-link btn-sm p-0 mb-3" to="/acces">{t("← Retour")}</Link>
      <Alerte>{erreur}</Alerte>
      <form onSubmit={valider}>
        <div className="mb-3"><label className="form-label" htmlFor="pe-eleve">{t("Nom et prénom de l'élève")}</label>
          <input id="pe-eleve" className="form-control" required maxLength={200} autoComplete="off" placeholder={t("ex. ABENA Grâce")} value={eleve} onChange={(e) => setEleve(e.target.value)} />
          <div className="form-text">{t("Dans l'ordre que vous voulez.")}</div></div>
        <div className="mb-4"><label className="form-label" htmlFor="pe-matricule">{t("Matricule de l'élève")}</label>
          <input id="pe-matricule" className="form-control font-monospace" required maxLength={30} autoComplete="off" autoCapitalize="characters" value={matricule} onChange={(e) => setMatricule(e.target.value)} />
          <div className="form-text">{t("Tel qu'il figure sur le bulletin ou la carte scolaire.")}</div></div>
        <button className="btn btn-success w-100" disabled={envoi}>{envoi ? t("Vérification…") : t("Accéder à l'espace de mon enfant")}</button>
      </form>
    </Cadre>
  )
}

// --- Portail -------------------------------------------------------------------------------------------------
export default function PortailParent() {
  const naviguer = useNavigate()
  const session = lireSessionParent()
  const [d, setD] = useState(null), [erreur, setErreur] = useState(""), [onglet, setOnglet] = useState("discipline")
  const quitter = useCallback(() => { oublierSessionParent(); naviguer("/parent/connexion", { replace: true }) }, [naviguer])
  const charger = useCallback(() => rpcParent("parent_portail").then(setD).catch((e) => (e.expiree ? quitter() : setErreur(e.message))), [quitter])
  useEffect(() => { if (!session) { naviguer(lireAppareil() ? "/parent/connexion" : "/etablissement", { replace: true }); return } charger()
    const m = setInterval(charger, 2 * 60 * 1000); return () => clearInterval(m) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  async function lireReponses() {
    setOnglet("courrier")
    if (d?.reponses_non_lues) { await rpcParent("parent_marquer_reponses_lues").catch(() => {}); setD({ ...d, reponses_non_lues: 0 }) }
  }
  async function deconnexion() { await rpcParent("parent_deconnexion").catch(() => {}); quitter() }
  if (!session) return null
  if (!d) return <div className="container py-4"><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</div>
  const e = d.eleve, nomEleve = `${e.nom.toUpperCase()} ${e.prenom}`.trim()
  return (
    <div className="espace-parent">
      <header className="espace-parent-entete no-print">
        <div className="container py-3 d-flex flex-wrap align-items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}logo-nexia-192.png`} alt="" width="40" height="40" className="rounded-2 bg-white" />
          <div className="me-auto"><div className="small opacity-75">{t("Espace parents")} · {d.etablissement.nom}</div>
            <div className="h5 mb-0">{nomEleve}</div><div className="small opacity-75">{e.classe} · {t("Année scolaire {v0}", { v0: e.annee })} · {t("Matricule : {v0}", { v0: e.matricule })}</div></div>
          <ChoixLangue variante="sombre" />
          <button className="btn btn-sm btn-outline-light" onClick={deconnexion}>{t("Se déconnecter")}</button>
        </div>
      </header>
      <main className="container py-3">
        <ul className="nav nav-pills mb-3 gap-1 no-print onglets-parent">
          <li className="nav-item"><button className={`nav-link${onglet === "discipline" ? " active" : ""}`} onClick={() => setOnglet("discipline")}>{t("Bilan disciplinaire")}</button></li>
          <li className="nav-item"><button className={`nav-link${onglet === "bulletins" ? " active" : ""}`} onClick={() => setOnglet("bulletins")}>{t("Bulletins de {v0}", { v0: `${e.prenom} ${e.nom.toUpperCase()}`.trim() })}</button></li>
          <li className="nav-item"><button className={`nav-link${onglet === "pv" ? " active" : ""}`} onClick={() => setOnglet("pv")}>{t("PV de performances")}</button></li>
          <li className="nav-item"><button className={`nav-link${onglet === "distinctions" ? " active" : ""}`} onClick={() => setOnglet("distinctions")}>{t("Distinctions")}</button></li>
          <li className="nav-item"><button className={`nav-link${onglet === "orientation" ? " active" : ""}`} onClick={() => setOnglet("orientation")}>{t("Orientation")}</button></li>
          <li className="nav-item"><button className={`nav-link${onglet === "courrier" ? " active" : ""}`} onClick={lireReponses}>{t("Écrire à l'école")}
            {d.reponses_non_lues > 0 && <span className="badge text-bg-danger ms-1">{d.reponses_non_lues}</span>}</button></li>
        </ul>
        <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte>
        {onglet === "discipline" && <BilanDisciplinaire d={d} />}
        {onglet === "bulletins" && <BulletinsParent d={d} quitter={quitter} />}
        {onglet === "pv" && <PvParent quitter={quitter} />}
        {onglet === "distinctions" && <DistinctionsParent d={d} quitter={quitter} />}
        {onglet === "orientation" && <OrientationParent quitter={quitter} />}
        {onglet === "courrier" && <CourrierParent d={d} recharger={charger} />}
      </main>
      {d.reponses_non_lues > 0 && onglet !== "courrier" && (
        <div className="bulles-alertes no-print">
          <button type="button" className="bulle-alerte bulle-courrier" onClick={lireReponses}
                  title={t("{v0} réponse(s) de l'établissement à vos courriers", { v0: d.reponses_non_lues })}
                  aria-label={t("{v0} réponse(s) de l'établissement à vos courriers : les lire", { v0: d.reponses_non_lues })}>
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm9 7.2L4.4 7H19.6L12 12.2ZM4 8.5V17h16V8.5l-8 5.4-8-5.4Z" /></svg>
            <span className="bulle-alerte-compte">{d.reponses_non_lues}</span>
          </button>
        </div>)}
    </div>
  )
}

// --- Bilan disciplinaire séquentiel, avec les dates ----------------------------------------------------------
function BilanDisciplinaire({ d }) {
  const bareme = d.bareme || { note_max: 20, points_par_retard: 0.25, points_par_heure: 0.25 }
  const parSequence = useMemo(() => d.sequences.map((s) => {
    const dans = (x) => x.sequence_id === s.id
    const b = calculerBilans(["x"], d.absences.filter(dans).map((a) => ({ inscription_id: "x", heures_non_justifiees: a.non_justifiees, heures_justifiees: a.justifiees })),
      d.retards.filter(dans).map(() => ({ inscription_id: "x" })), d.incidents.filter(dans).map((i) => ({ inscription_id: "x", libelle: i.infraction, points: i.points })), bareme).get("x")
    return { s, b, n: d.absences.filter(dans).length + d.retards.filter(dans).length + d.incidents.filter(dans).length }
  }), [d])  // eslint-disable-line react-hooks/exhaustive-deps
  const numero = (id) => d.sequences.find((s) => s.id === id)?.numero
  const evenements = [
    ...d.absences.map((a) => ({ date: a.date, seq: numero(a.sequence_id), type: "absence",
      libelle: [a.non_justifiees ? t("Absence non justifiée : {v0} h", { v0: a.non_justifiees }) : null, a.justifiees ? t("Absence justifiée : {v0} h", { v0: a.justifiees }) : null].filter(Boolean).join(" · "), detail: a.motif })),
    ...d.retards.map((r) => ({ date: r.date, seq: numero(r.sequence_id), type: "retard", libelle: t("Retard"), detail: "" })),
    ...d.incidents.map((i) => ({ date: i.date, seq: numero(i.sequence_id), type: "sanction", libelle: `${i.sanction} — ${i.infraction}`, detail: i.observation,
      points: i.points })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1))
  return (
    <div className="bilan-parent">
      <div className="row g-2 mb-3">{parSequence.map(({ s, b }) => (
        <div className="col-6 col-md-4 col-lg-2" key={s.id}><div className="card h-100 bilan-sequence"><div className="card-body p-2">
          <div className="small text-muted">{t("Séquence {v0}", { v0: s.numero })}</div>
          <div className="small">{t("Abs. non justifiées")} : <strong>{b.nj} h</strong></div>
          <div className="small">{t("Abs. justifiées")} : {b.j} h</div>
          <div className="small">{t("Retards")} : {b.retards}</div>
          <div className="small">{t("Sanctions")} : {b.incidents.length}</div>
          <div className="small mt-1">{t("Note de discipline")} : <strong>{note(b.note)}/20</strong></div>
        </div></div></div>))}</div>
      <div className="card"><div className="card-header fw-semibold">{t("Dossier disciplinaire détaillé")}</div>
        <div className="table-responsive"><table className="table table-sm align-middle mb-0">
          <thead className="table-light"><tr><th>{t("Date")}</th><th>{t("Séquence")}</th><th>{t("Événement")}</th><th>{t("Observation")}</th></tr></thead>
          <tbody>{evenements.map((x, k) => (
            <tr key={k}><td className="text-nowrap">{date(x.date)}</td><td>{x.seq ? `S${x.seq}` : ""}</td>
              <td><span className={`badge me-1 text-bg-${x.type === "sanction" ? "danger" : x.type === "retard" ? "warning" : "secondary"}`}>{t({ absence: "Absence", retard: "Retard", sanction: "Sanction" }[x.type])}</span>
                {x.libelle}{x.points > 0 && <span className="text-danger small"> (−{note(x.points)} pt)</span>}</td><td className="small">{x.detail}</td></tr>))}
            {!evenements.length && <tr><td colSpan={4} className="text-center text-muted py-4">{t("Aucune absence, aucun retard ni aucune sanction : félicitations !")}</td></tr>}</tbody>
        </table></div></div>
    </div>
  )
}

// --- Bulletins publiés -----------------------------------------------------------------------------------------
function BulletinsParent({ d, quitter }) {
  const [choisi, setChoisi] = useState(d.bulletins.at(-1)?.periode || null)
  const [b, setB] = useState(null), [erreur, setErreur] = useState(""), [logo, setLogo] = useState(null), [fond, setFond] = useState(null), [pdf, setPdf] = useState(false)
  useEffect(() => {
    if (!choisi) return
    setB(null); setErreur("")
    rpcParent("parent_bulletin", { p_periode: choisi }).then(async (x) => {
      setB(x)
      const img = await image(x.commun.logo); setLogo(img); setFond(img ? await faireFiligrane(img) : null)
    }).catch((e) => (e.expiree ? quitter() : setErreur(e.message)))
  }, [choisi, quitter])
  if (!d.bulletins.length) return <div className="alert alert-info">{t("Aucun bulletin n'est encore publié. Les bulletins apparaîtront ici dès que l'établissement les aura publiés.")}</div>
  async function telecharger() {
    setPdf(true)
    try {
      const c = b.commun, x = b.contenu
      await telechargerBulletinsPdf({ etablissement: c.etablissement, logo, filigrane: fond, exercice: c.exercice, periode: c.periode, classe: c.classe, stats: c.stats, entetes: c.entetes,
        eleves: [{ r: x.r, photoUrl: x.photo, conduite: x.conduite, decision: x.decision, code: x.code }] },
        nomDeFichier(t("bulletin"), `${x.r.eleve.nom} ${x.r.eleve.prenom}`, c.periode.libelle, c.exercice.libelle))
    } catch (e) { setErreur(e.message) } finally { setPdf(false) }
  }
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">{d.bulletins.map((x) => (
        <button key={x.periode} className={`btn btn-sm ${choisi === x.periode ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setChoisi(x.periode)}>
          {t(x.libelle)}</button>))}
        {b && <span className="ms-auto d-flex gap-2"><button className="btn btn-sm btn-success" disabled={pdf} onClick={telecharger}>{pdf ? t("Préparation du PDF…") : t("Télécharger en PDF")}</button>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>{t("Imprimer")}</button></span>}
      </div>
      <Alerte>{erreur}</Alerte>
      {choisi && !b && !erreur && <Chargement />}
      {b && <div className="bulletin-parent"><Bulletin r={b.contenu.r} donnees={{ classe: b.commun.classe }} periode={b.commun.periode} stats={b.commun.stats}
        entetes={b.commun.entetes || []} etablissement={b.commun.etablissement} logo={b.commun.logo} filigrane={fond} exercice={b.commun.exercice}
        photo={b.contenu.photo} conduite={b.contenu.conduite} decision={b.contenu.decision} code={b.contenu.code} enCours={pdf ? "x" : null} onPdf={telecharger} />
        <p className="small text-muted no-print">{t("Publié par l'établissement le {v0}.", { v0: dateHeure(b.publie_le) })}</p></div>}
    </>
  )
}

// --- PV de performances publiés (toutes années) : uniquement ceux de l'enfant, PDF téléchargeable ---------------------
function PvParent({ quitter }) {
  const [liste, setListe] = useState(null), [erreur, setErreur] = useState(""), [choisi, setChoisi] = useState(0), [pdf, setPdf] = useState(false)
  useEffect(() => { rpcParent("parent_pv").then(setListe).catch((e) => (e.expiree ? quitter() : setErreur(e.message))) }, [quitter])
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  if (!liste.length) return <div className="alert alert-info">{t("Aucun PV de performances publié pour le moment. Il apparaîtra ici dès que l'établissement l'aura publié.")}</div>
  const x = liste[Math.min(choisi, liste.length - 1)]
  async function telecharger() {
    setPdf(true); setErreur("")
    try {
      const c = x.commun || {}
      await pvIndividuelsPdf([x.contenu], { etablissement: c.etablissement || {}, logo: await image(c.logo), signataires: c.signataires || [],
        lieu: c.etablissement?.ville || "", titre: t("PV de performances individuelles"), sousTitre: `${x.periode_libelle} · ${x.annee}`, reference: x.contenu.reference },
      nomDeFichier(t("pv"), `${x.contenu.eleve.nom} ${x.contenu.eleve.prenom}`, x.periode_libelle, x.annee))
    } catch (e) { setErreur(e.message) } finally { setPdf(false) }
  }
  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">{liste.map((p, k) => (
        <button key={`${p.annee}-${p.periode}`} className={`btn btn-sm ${k === choisi ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setChoisi(k)}>
          {p.periode_libelle} · {p.annee}</button>))}
        <span className="ms-auto d-flex gap-2"><button className="btn btn-sm btn-success" disabled={pdf} onClick={telecharger}>{pdf ? t("Préparation du PDF…") : t("Télécharger en PDF")}</button>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => window.print()}>{t("Imprimer")}</button></span>
      </div>
      <PvIndividuelVue c={x.contenu} />
      <p className="small text-muted no-print mt-2">{t("Publié par l'établissement le {v0}.", { v0: dateHeure(x.publie_le) })}</p>
    </>
  )
}

// --- Distinctions publiées (toutes années), certificat téléchargeable ------------------------------------------------
function DistinctionsParent({ d, quitter }) {
  const [liste, setListe] = useState(null), [erreur, setErreur] = useState(""), [pdf, setPdf] = useState(null)
  useEffect(() => { rpcParent("parent_distinctions").then(setListe).catch((e) => (e.expiree ? quitter() : setErreur(e.message))) }, [quitter])
  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!liste) return <Chargement />
  if (!liste.length) return <div className="alert alert-info">{t("Aucune distinction publiée pour le moment. Les tableaux d'honneur, félicitations et prix obtenus par votre enfant apparaîtront ici.")}</div>
  async function certificat(x, k) {
    setPdf(k); setErreur("")
    try {
      const distinction = { nom: x.nom, modele: x.modele, personnalisation: x.personnalisation }
      const logo = reglages(distinction, d.etablissement).afficherLogo && x.logo ? await image(x.logo) : null
      await certificatsPdf([{ eleve: x.eleve, matricule: x.matricule, classe: x.classe, periode: x.periode, annee: x.annee, valeurs: x.valeurs, code: x.code, emis_le: x.emis_le }],
        { distinction, etablissement: d.etablissement, logo, nom: nomDeFichier(t("certificat"), x.nom, x.periode, x.annee) })
    } catch (e) { setErreur(e.message) } finally { setPdf(null) }
  }
  return (
    <div className="row g-3 distinctions-parent">{liste.map((x, k) => (
      <div className="col-md-6 col-lg-4" key={x.code}><div className="card h-100"><div className="card-body">
        <div className="fs-3" aria-hidden="true">🏅</div>
        <h2 className="h6 mb-1">{x.nom}</h2>
        <div className="small text-muted">{x.periode} · {t("Année scolaire {v0}", { v0: x.annee })} · {x.classe}</div>
        {x.valeurs?.moyenne !== null && x.valeurs?.moyenne !== undefined && <div className="small mt-1">{t("Moyenne : {v0}/20", { v0: note(Number(x.valeurs.moyenne)) })}</div>}
        <div className="small text-muted mt-1">{t("Délivrée le {v0}", { v0: date(x.emis_le) })} · <code>{x.code}</code></div>
        {x.imprimable && <button className="btn btn-sm btn-success mt-2" disabled={pdf !== null} onClick={() => certificat(x, k)}>{pdf === k ? t("Préparation du PDF…") : t("Télécharger le certificat")}</button>}
      </div></div></div>))}
    </div>
  )
}

// --- Orientation : série actuelle, destinations possibles, demande, réponse de l'établissement ------------------
const STATUTS_DEMANDE = { en_attente: ["En cours d'examen", "warning"], acceptee: ["Acceptée", "success"], refusee: ["Refusée", "danger"], remplacee: ["Remplacée", "secondary"] }
function OrientationParent({ quitter }) {
  const [o, setO] = useState(null), [erreur, setErreur] = useState(""), [f, setF] = useState({ destination: "", type: "demande_orientation", parent_nom: "", motif: "" })
  const [envoi, setEnvoi] = useState(false), [ok, setOk] = useState("")
  const charger = useCallback(() => rpcParent("parent_orientation").then(setO).catch((e) => (e.expiree ? quitter() : setErreur(e.message))), [quitter])
  useEffect(() => { charger() }, [charger])
  if (!o) return erreur ? <Alerte>{erreur}</Alerte> : <Chargement />
  const enAttente = o.demandes.some((x) => x.statut === "en_attente" && x.origine === "parent")
  async function envoyer(e) {
    e.preventDefault(); setErreur(""); setOk(""); setEnvoi(true)
    const dest = o.destinations[Number(f.destination)] || {}
    try {
      await rpcParent("parent_demander_orientation", { p: { type: f.type, serie_id: dest.serie_id || null, niveau_id: dest.niveau_id || null, parent_nom: f.parent_nom, motif: f.motif } })
      setOk(t("Votre demande a été transmise à l'établissement. Vous verrez sa réponse ici.")); setF({ ...f, destination: "", motif: "" }); charger()
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="orientation-parent">
      <Alerte onFermer={() => setErreur("")}>{erreur}</Alerte><Alerte type="success" onFermer={() => setOk("")}>{ok}</Alerte>
      <div className="card mb-3"><div className="card-body">
        <div className="small text-muted">{t("Situation actuelle")}</div>
        <div className="fs-5 fw-semibold">{o.classe}{o.serie && <span className="badge text-bg-primary ms-2">{t("Série {v0}", { v0: o.serie.code })}</span>}</div>
        {o.niveau && <div className="small">{t("Niveau : {v0}", { v0: o.niveau })}</div>}
        {o.destinations.length > 0 && <div className="small mt-2">{t("Poursuites d'études possibles l'an prochain :")} {o.destinations.map((x) => x.libelle).join(" · ")}</div>}
      </div></div>
      {o.destinations.length > 0 && !enAttente && <form className="card mb-3" onSubmit={envoyer}><div className="card-body">
        <h2 className="h6">{t("Faire une demande d'orientation")}</h2>
        <div className="row g-2">
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="or-dest">{t("Série ou filière souhaitée")}</label>
            <select id="or-dest" className="form-select" required value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })}>
              <option value="">{t("Choisir…")}</option>{o.destinations.map((x, k) => <option key={k} value={k}>{x.libelle}{x.serie ? ` — ${x.serie}` : ""}{x.filiere ? ` (${x.filiere})` : ""}</option>)}</select></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="or-type">{t("Type de demande")}</label>
            <select id="or-type" className="form-select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="demande_orientation">{t("Orientation pour l'année prochaine")}</option><option value="changement_serie">{t("Changement de série dès cette année")}</option></select></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="or-nom">{t("Votre nom")}</label>
            <input id="or-nom" className="form-control" required maxLength={120} value={f.parent_nom} onChange={(e) => setF({ ...f, parent_nom: e.target.value })} /></div>
          <div className="col-12"><label className="form-label small mb-0" htmlFor="or-motif">{t("Motivation")}</label>
            <textarea id="or-motif" className="form-control" rows={3} required minLength={10} maxLength={1000} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} /></div>
        </div>
        <button className="btn btn-primary mt-2" disabled={envoi}>{envoi ? t("Envoi…") : t("Envoyer la demande")}</button>
      </div></form>}
      {enAttente && <div className="alert alert-info small">{t("Une demande est en cours d'examen par l'établissement.")}</div>}
      <h2 className="h6">{t("Demandes et décisions d'orientation")}</h2>
      {!o.demandes.length && <p className="text-muted small">{t("Aucune demande pour le moment.")}</p>}
      {o.demandes.map((x) => (
        <div className="card mb-2 demande-orientation" key={x.id}><div className="card-body py-2">
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <strong>{[x.niveau, x.serie, x.filiere].filter(Boolean).join(" · ") || "—"}</strong>
            <span className={`badge text-bg-${(STATUTS_DEMANDE[x.statut] || STATUTS_DEMANDE.remplacee)[1]}`}>{t((STATUTS_DEMANDE[x.statut] || STATUTS_DEMANDE.remplacee)[0])}</span>
            <span className="small text-muted ms-auto">{x.origine === "parent" ? t("Votre demande du {v0}", { v0: date(x.cree_le) }) : t("Décision de l'établissement du {v0}", { v0: date(x.decide_le || x.cree_le) })}</span></div>
          {x.motif && <div className="small mt-1">{x.motif}</div>}
          {x.reponse && <div className="small mt-1 text-primary-emphasis">↳ {x.reponse}</div>}
        </div></div>))}
    </div>
  )
}

// --- Courrier : écrire à l'école, aperçu, envoi, suivi des réponses --------------------------------------------
const VIDE = { parent_nom: "", parent_qualite: "pere", parent_telephone: "", ville: "", objet: "", precision_objet: "", details: { du: "", au: "", jusqu_au: "", montant: "" }, message: "" }

function CourrierParent({ d, recharger }) {
  const [etape, setEtape] = useState(null)            // null (liste) | « saisie » | « apercu » | « envoye »
  const [f, setF] = useState(() => { let mem = {}; try { mem = JSON.parse(localStorage.getItem("nexiaschool.parent.expediteur")) || {} } catch { /* rien */ }
    return { ...VIDE, ...mem, ville: mem.ville || d.etablissement.ville || "", details: { ...VIDE.details } } })
  const [erreur, setErreur] = useState(""), [envoi, setEnvoi] = useState(false), [merci, setMerci] = useState(""), [ouvert, setOuvert] = useState(null)
  const e = d.eleve
  const courrier = { ...f, eleve: `${e.nom.toUpperCase()} ${e.prenom}`.trim(), classe: e.classe, matricule: e.matricule,
    details: f.objet === "absence" ? { du: f.details.du, au: f.details.au || f.details.du } : f.objet === "moratoire" ? { jusqu_au: f.details.jusqu_au, montant: f.details.montant } : {} }
  const maj = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  const majD = (k) => (ev) => setF({ ...f, details: { ...f.details, [k]: ev.target.value } })

  function terminer(ev) {
    ev.preventDefault()
    let m = ""
    if (!f.objet) m = t("Choisissez l'objet de votre courrier.")
    else if (f.parent_nom.trim().length < 2) m = t("Indiquez votre nom et votre prénom.")
    else if (f.objet === "absence" && !f.details.du) m = t("Indiquez la date (ou les dates) de l'absence.")
    else if (f.objet === "absence" && f.details.au && f.details.au < f.details.du) m = t("La date de fin de l'absence précède la date de début.")
    else if (f.objet === "moratoire" && !f.details.jusqu_au) m = t("Indiquez la date jusqu'à laquelle vous sollicitez le moratoire.")
    else if (f.message.trim().length < 10) m = t("Votre message est trop court (10 caractères au moins).")
    setErreur(m)
    if (!m) { setEtape("apercu"); window.scrollTo({ top: 0, behavior: "smooth" }) }
  }
  async function envoyer() {
    setErreur(""); setEnvoi(true)
    try {
      const r = await rpcParent("parent_envoyer_courrier", { p: { ...courrier, details: Object.fromEntries(Object.entries(courrier.details).filter(([, v]) => v !== "" && v !== undefined)) } })
      try { localStorage.setItem("nexiaschool.parent.expediteur", JSON.stringify({ parent_nom: f.parent_nom, parent_qualite: f.parent_qualite, parent_telephone: f.parent_telephone, ville: f.ville })) } catch { /* rien */ }
      setMerci(remerciement(courrier, d.etablissement, r.reference)); setEtape("envoye"); recharger()
      setF({ ...f, objet: "", precision_objet: "", details: { ...VIDE.details }, message: "" })
    } catch (x) { setErreur(x.message) } finally { setEnvoi(false) }
  }

  if (etape === "envoye") return (
    <div className="carte-merci card border-success mb-3" role="status"><div className="card-body text-center p-4">
      <div className="se-confirmation-icone" aria-hidden="true">✓</div>
      <h2 className="h5">{t("Votre courrier a bien été envoyé")}</h2>
      <p className="mb-3">{merci}</p>
      <button className="btn btn-outline-primary" onClick={() => setEtape(null)}>{t("Voir mes courriers")}</button>
    </div></div>)

  if (etape === "apercu") return (
    <div className="apercu-courrier">
      <div className="alert alert-info small d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span>{t("Aperçu de votre lettre, telle qu'elle sera reçue par {v0}.", { v0: t(SERVICES[f.objet]) })}</span></div>
      <Alerte>{erreur}</Alerte>
      <Lettre courrier={courrier} etablissement={d.etablissement} className="mb-3" />
      <div className="d-flex flex-wrap gap-2 mb-4">
        <button className="btn btn-outline-secondary" disabled={envoi} onClick={() => setEtape("saisie")}>{t("Modifier")}</button>
        <button className="btn btn-success px-4" disabled={envoi} onClick={envoyer}>{envoi ? t("Envoi…") : t("Envoyer")}</button>
      </div>
    </div>)

  if (etape === "saisie") return (
    <form className="redaction-courrier card shadow-sm mb-4" onSubmit={terminer}><div className="card-body p-4">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div><h2 className="h5 mb-1">{t("Écrire à l'école")}</h2>
          <p className="small text-muted mb-0">{t("Votre courrier est transmis directement au service concerné, qui vous répondra dans cet espace.")}</p></div>
        <button type="button" className="btn-close" aria-label={t("Fermer")} onClick={() => setEtape(null)} /></div>
      <Alerte>{erreur}</Alerte>
      <div className="row g-3">
        <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="co-objet">{t("Objet du courrier")}</label>
          <select id="co-objet" className="form-select" value={f.objet} onChange={maj("objet")}>
            <option value="">{t("Choisir…")}</option>{OBJETS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
          {f.objet && <div className="form-text">{t("Destinataire : {v0}.", { v0: t(SERVICES[f.objet]) })}</div>}</div>
        {["reclamation", "audience", "suggestion", "absence"].includes(f.objet) && <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="co-precision">{t("Précisez l'objet (facultatif)")}</label>
          <input id="co-precision" className="form-control" maxLength={150} placeholder={t("ex. Note de mathématiques de la séquence 2")} value={f.precision_objet} onChange={maj("precision_objet")} /></div>}
        {f.objet === "absence" && <>
          <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-du">{t("Absent(e) le / du")}</label><input id="co-du" type="date" className="form-control" value={f.details.du} onChange={majD("du")} /></div>
          <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-au">{t("au (facultatif)")}</label><input id="co-au" type="date" className="form-control" value={f.details.au} onChange={majD("au")} /></div></>}
        {f.objet === "moratoire" && <>
          <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-jusqu">{t("Délai sollicité jusqu'au")}</label><input id="co-jusqu" type="date" className="form-control" value={f.details.jusqu_au} onChange={majD("jusqu_au")} /></div>
          <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-montant">{t("Montant concerné (FCFA, facultatif)")}</label><input id="co-montant" type="number" min={0} step={500} className="form-control" value={f.details.montant} onChange={majD("montant")} /></div></>}
        <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="co-nom">{t("Votre nom et prénom")}</label>
          <input id="co-nom" className="form-control" maxLength={120} autoComplete="name" value={f.parent_nom} onChange={maj("parent_nom")} /></div>
        <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-qualite">{t("Vous êtes")}</label>
          <select id="co-qualite" className="form-select" value={f.parent_qualite} onChange={maj("parent_qualite")}>{QUALITES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select></div>
        <div className="col-6 col-md-3"><label className="form-label small fw-semibold" htmlFor="co-tel">{t("Téléphone (facultatif)")}</label>
          <input id="co-tel" className="form-control" maxLength={30} autoComplete="tel" value={f.parent_telephone} onChange={maj("parent_telephone")} /></div>
        <div className="col-md-6"><label className="form-label small fw-semibold" htmlFor="co-ville">{t("Lieu (ville)")}</label>
          <input id="co-ville" className="form-control" maxLength={80} value={f.ville} onChange={maj("ville")} /></div>
        <div className="col-12"><label className="form-label small fw-semibold" htmlFor="co-message">{t("Votre message")}</label>
          <textarea id="co-message" className="form-control" rows={8} maxLength={8000} value={f.message} onChange={maj("message")}
                    placeholder={t("Exposez votre demande en quelques phrases. La formule d'introduction, la formule de politesse et la signature sont ajoutées automatiquement.")} />
          <div className="form-text text-end">{f.message.length} / 8000</div></div>
      </div>
      <div className="d-flex gap-2 mt-2"><button className="btn btn-primary px-4">{t("Terminer")}</button>
        <button type="button" className="btn btn-outline-secondary" onClick={() => setEtape(null)}>{t("Annuler")}</button></div>
    </div></form>)

  return (
    <div className="courriers-parent">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <p className="text-muted small mb-0">{t("Écrivez à l'établissement : réclamation, demande d'audience, suggestion, demande de moratoire pour les frais d'écolage ou demande d'autorisation d'absence.")}</p>
        <button className="btn btn-primary" onClick={() => { setErreur(""); setEtape("saisie") }}>✍ {t("Écrire à l'école")}</button>
      </div>
      <h2 className="h6">{t("Mes courriers")}</h2>
      {!d.courriers.length && <p className="text-muted small">{t("Aucun courrier envoyé pour le moment.")}</p>}
      {d.courriers.map((c) => (
        <div key={c.id} className="card mb-2 courrier-parent" data-courrier={c.reference}><div className="card-body py-2">
          <button type="button" className="btn btn-link text-start text-decoration-none p-0 w-100 d-flex flex-wrap justify-content-between gap-2" onClick={() => setOuvert(ouvert === c.id ? null : c.id)}>
            <span><span className="fw-semibold text-body">{libelleObjet(c.objet)}</span>{c.precision_objet && <span className="text-muted"> — {c.precision_objet}</span>}
              <span className="small text-muted d-block">{t("Réf. {v0} · envoyé le {v1}", { v0: c.reference, v1: dateHeure(c.envoye_le) })}</span></span>
            {c.reponses.length ? <span className="badge text-bg-success align-self-start">{t("{v0} réponse(s)", { v0: c.reponses.length })}</span>
                               : <span className="badge text-bg-secondary align-self-start">{t("En attente de réponse")}</span>}
          </button>
          {c.reponses.map((r) => <Reponse key={r.id} r={r} />)}
          {ouvert === c.id && <Lettre courrier={c} etablissement={d.etablissement} className="mt-2" />}
        </div></div>))}
    </div>
  )
}

export function Reponse({ r }) {
  return (
    <div className="reponse-courrier mt-2">
      <div className="small text-muted">{t("Réponse de {v0} ({v1}) — {v2}", { v0: r.auteur, v1: t(r.fonction), v2: dateHeure(r.envoye_le) })}</div>
      {r.moratoire_accorde === true && <div className="badge text-bg-success mb-1">{t("Moratoire accordé jusqu'au {v0}", { v0: dateLongue(r.moratoire_jusqu_au) })}</div>}
      {r.moratoire_accorde === false && <div className="badge text-bg-danger mb-1">{t("Moratoire refusé")}</div>}
      <div className="reponse-texte">{r.message}</div>
    </div>
  )
}
