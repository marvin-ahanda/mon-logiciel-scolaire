import { lazy, Suspense, useState } from "react"
import { NavLink, Route, Routes } from "react-router-dom"
import ParametresDecisions from "./ParametresDecisions.jsx"
import { Alerte, Chargement, FicheCode, useDonnees } from "../composants/Communs.jsx"
import { date as formatDate, exerciceParDefaut, nomComplet, comparerNoms } from "../lib/format.js"
import { ChoixLogo } from "../composants/Logo.jsx"
import { envoyerLogo, retirerLogo, siteAffiche } from "../lib/logo.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t, locale } from "../i18n.jsx"
import { Cadenas, Verrou } from "../composants/Offre.jsx"
import { NOMS_OFFRES, PLAFONDS } from "../lib/offres.js"

const EmploiDuTemps = lazy(() => import("./edt/EmploiDuTemps.jsx"))     // module chargé à la demande (moteur, exports)

export default function Parametres() {
  const { aOffre } = useSession()
  const onglet = ({ isActive }) => "nav-link" + (isActive ? " active" : "")
  const cadenas = (f) => !aOffre(f) && <> <Cadenas /></>
  return (
    <>
      <h1 className="h3 mb-3">{t("Paramètres")}</h1>
      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        <li className="nav-item"><NavLink className={onglet} to="/parametres" end>{t("Établissement")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/exercices">{t("Exercices et séquences")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/sections">{t("Sections")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/classes">{t("Classes")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/matieres">{t("Matières")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/coefficients">{t("Matières par classe")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/discipline">{t("Discipline")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/decisions">{t("Décisions de fin de période")}{cadenas("decisions")}</NavLink></li>
        <li className="nav-item"><NavLink className={onglet} to="/parametres/emploi-du-temps">{t("Emploi du temps")}{cadenas("edt")}</NavLink></li>
      </ul>
      <Routes>
        <Route index element={<Etablissement />} />
        <Route path="exercices" element={<Exercices />} />
        <Route path="sections" element={<Sections />} />
        <Route path="classes" element={<Classes />} />
        <Route path="matieres" element={<Matieres />} />
        <Route path="coefficients" element={<Coefficients />} />
        <Route path="discipline" element={<ParametresDiscipline />} />
        <Route path="decisions" element={<Verrou fonction="decisions"><ParametresDecisions /></Verrou>} />
        <Route path="emploi-du-temps" element={<Verrou fonction="edt"><Suspense fallback={<Chargement />}><EmploiDuTemps /></Suspense></Verrou>} />
      </Routes>
    </>
  );
}

// --- Établissement ------------------------------------------------------------------------------------------
/** Offre souscrite par l'établissement (attribuée par NexIA après paiement). */
function OffreActuelle() {
  const { etablissement, offre } = useSession()
  const echue = offre !== etablissement.offre
  const plafond = PLAFONDS[offre]
  return (
    <div className={"card mb-3 carte-offre" + (echue ? " border-warning" : "")} data-offre={offre}><div className="card-body py-2 d-flex flex-wrap align-items-center gap-2">
      <span>{t("Offre actuelle :")}</span><span className="badge text-bg-primary fs-6">{t(NOMS_OFFRES[offre])}</span>
      {etablissement.offre !== "decouverte" && !echue && <span className="small text-muted">
        {t(etablissement.offre_periodicite === "annuel" ? "paiement annuel" : "paiement mensuel")}
        {etablissement.offre_expire_le && <> · {t("jusqu'au {v0}", { v0: formatDate(etablissement.offre_expire_le) })}</>}</span>}
      {echue && <span className="small text-warning-emphasis">{t("Votre offre {v0} est arrivée à échéance : les fonctions avancées sont en lecture seule.", { v0: t(NOMS_OFFRES[etablissement.offre]) })}</span>}
      {plafond && <span className="small text-muted">{plafond.personnels
        ? t("Jusqu'à {v0} élèves et {v1} comptes du personnel.", { v0: plafond.eleves, v1: plafond.personnels })
        : t("Jusqu'à {v0} élèves.", { v0: plafond.eleves })}</span>}
      <span className="small text-muted ms-auto">{t("Les rubriques marquées d'un cadenas sont comprises dans les offres supérieures.")}</span>
    </div></div>
  )
}

function Etablissement() {
  const { etablissement, logoUrl, recharger } = useSession()
  const [f, setF] = useState(() => ({ ville: etablissement.ville, adresse: etablissement.adresse, telephone: etablissement.telephone,
                                      devise: etablissement.devise, nom_chef: etablissement.nom_chef, site_web: siteAffiche(etablissement.site_web) }))
  const [msg, setMsg] = useState({}), [code, setCode] = useState(null), [envoiLogo, setEnvoiLogo] = useState(false), [cleLogo, setCleLogo] = useState(0)
  const champ = (k, lib, max) => (
    <div className="col-md-6 mb-3"><label className="form-label" htmlFor={k}>{lib}</label>
      <input className="form-control" id={k} maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)

  async function enregistrer(e) {
    e.preventDefault()
    try {
      verifier(await supabase.from("etablissements").update(f).eq("id", etablissement.id))
      const r = verifier(await supabase.from("etablissements").select("site_web").eq("id", etablissement.id).single())
      setF((x) => ({ ...x, site_web: siteAffiche(r.site_web) }))
      await recharger(); setMsg({ ok: t("Informations enregistrées.") })
    } catch (err) { setMsg({ erreur: err.message }) }
  }
  async function changerLogo(blob) {
    setMsg({}); setEnvoiLogo(true)
    try {
      if (blob) await envoyerLogo(etablissement.id, blob, etablissement.logo)
      else await retirerLogo(etablissement.id, etablissement.logo)
      await recharger(); setMsg({ ok: blob ? t(
      "Logo enregistré : il apparaît dans la barre de l'application et sur les bulletins."
    ) : t("Logo retiré.") })
    } catch (err) { setMsg({ erreur: err.message }) } finally { setEnvoiLogo(false); setCleLogo((k) => k + 1) }
  }
  async function nouveauCode() {
    if (!confirm(t(
      "Générer un nouveau code d'établissement ? L'ancien ne fonctionnera plus et tous les appareils devront saisir le nouveau."
    ))) return
    try { setCode((await rpc("nouveau_code_etablissement")).code) } catch (err) { setMsg({ erreur: err.message }) }
  }

  return (
    <>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      <OffreActuelle />
      {code && <FicheCode titre={t("Nouveau code de l'établissement — {v0}", {
        v0: etablissement.nom
      })} code={code} onTerminer={() => setCode(null)}
                          consignes={[t("Communiquez ce code au personnel de l'établissement uniquement."), t("Chacun garde son code personnel.")]} />}
      <form className="card card-body mb-3" onSubmit={enregistrer} style={{ maxWidth: 820 }}>
        <h2 className="h6">{etablissement.nom}</h2>
        <div className="row">{champ("ville", "Ville", 100)}{champ("telephone", t("Téléphone"), 50)}{champ("adresse", "Adresse", 200)}
          {champ("nom_chef", t("Chef d'établissement"), 150)}{champ("devise", t("Devise"), 200)}
          <div className="col-md-6 mb-3"><label className="form-label" htmlFor="site_web">{t("Site web")}</label>
            <input className="form-control" id="site_web" maxLength={200} inputMode="url" placeholder={t("ex. www.monecole.cm")} value={f.site_web}
                   onChange={(e) => setF({ ...f, site_web: e.target.value })} />
            <div className="form-text">{t("Affiché dans l'en-tête des bulletins.")}</div></div></div>
        <div><button className="btn btn-primary">{t("Enregistrer")}</button></div>
      </form>
      <div className="card card-body mb-3" style={{ maxWidth: 820 }}>
        <h2 className="h6">{t("Logo de l'établissement")}</h2>
        <p className="small text-muted mb-3">{t(
          "Visible en couleur dans la barre de l'application par tout le personnel, et au centre de l'en-tête des bulletins."
        )}</p>
        <ChoixLogo key={cleLogo} url={logoUrl} onChoix={changerLogo} desactive={envoiLogo} id="logo-parametres" />
        {envoiLogo && <div className="small text-muted mt-2">{t("Enregistrement du logo…")}</div>}
      </div>
      <div className="card card-body" style={{ maxWidth: 820 }}>
        <h2 className="h6">{t("Code de l'établissement")}</h2>
        <p className="small text-muted mb-2">{t("Généré le ")}{new Date(etablissement.code_genere_le).toLocaleString(locale())}{t(
          ". Il est enregistré chiffré et ne peut pas être relu. Changez-le par exemple après le départ d'un membre du personnel."
        )}</p>
        <div><button className="btn btn-warning" onClick={nouveauCode}>{t("Générer un nouveau code d'établissement")}</button></div>
      </div>
    </>
  );
}

// --- Exercices et séquences ---------------------------------------------------------------------------------
function Exercices() {
  const { recharger } = useSession()
  const [libelle, setLibelle] = useState(exerciceParDefaut()), [erreur, setErreur] = useState("")
  const [donnees, erreurChargement, rafraichir] = useDonnees(async () => ({
    exercices: verifier(await supabase.from("exercices").select("*").order("libelle", { ascending: false })),
    sequences: verifier(await supabase.from("sequences").select("*").order("numero")),
  }), [])

  async function action(f) {
    setErreur("")
    try { await f(); rafraichir(); await recharger() } catch (err) { setErreur(err.message) }
  }
  const creer = (e) => { e.preventDefault(); action(async () => verifier(await supabase.from("exercices").insert({ libelle, actif: true }))) }
  const activer = (ex) => action(async () => verifier(await supabase.from("exercices").update({ actif: true }).eq("id", ex.id)))
  const verrou = (s) => action(async () => verifier(await supabase.from("sequences").update({ verrouillee: !s.verrouillee }).eq("id", s.id)))
  const delai = (s, valeur) => action(async () => verifier(await supabase.from("sequences").update({ date_limite_notes: valeur || null }).eq("id", s.id)))

  if (!donnees) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <Alerte>{erreur}</Alerte>
      <form className="d-flex flex-wrap gap-2 mb-3" onSubmit={creer}>
        <input className="form-control" style={{ maxWidth: 200 }} value={libelle} onChange={(e) => setLibelle(e.target.value)}
               pattern="[0-9]{4}-[0-9]{4}" title={t("Format : 2026-2027")} required aria-label={t("Nouvel exercice")} />
        <button className="btn btn-primary">{t("Créer et activer l'exercice")}</button>
      </form>
      {donnees.exercices.map((ex) => (
        <div className="card mb-3" key={ex.id}><div className="card-body">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h2 className="h6 m-0">{t("Exercice ")}{ex.libelle} {ex.actif && <span className="badge text-bg-success">{t("actif")}</span>}</h2>
            {!ex.actif && <button className="btn btn-sm btn-outline-primary" onClick={() => activer(ex)}>{t("Activer")}</button>}
          </div>
          <div className="table-responsive"><table className="table table-sm align-middle mb-0 tableau-sequences" style={{ maxWidth: 640 }}>
            <thead><tr><th>{t("Séquence")}</th><th>{t("Délai de saisie des notes")}</th><th>{t("Saisie")}</th></tr></thead>
            <tbody>{donnees.sequences.filter((s) => s.exercice_id === ex.id).map((s) => (
              <tr key={s.id}>
                <td className="text-nowrap">{t("Séquence ")}{s.numero}{t(" (T")}{s.trimestre})</td>
                <td><input type="date" className="form-control form-control-sm" style={{ maxWidth: 180 }} defaultValue={s.date_limite_notes || ""}
                           aria-label={t("Délai de saisie des notes, séquence {v0}", { v0: s.numero })}
                           onChange={(e) => (e.target.value === "" || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) && delai(s, e.target.value)} /></td>
                <td><button className={`btn btn-sm ${s.verrouillee ? "btn-secondary" : "btn-outline-secondary"}`} onClick={() => verrou(s)}
                      title={s.verrouillee ? t("Séquence verrouillée : cliquer pour rouvrir la saisie") : t("Cliquer pour verrouiller la saisie")}>
                  {s.verrouillee ? t("🔒 Verrouillée") : t("Ouverte")}</button></td>
              </tr>))}</tbody>
          </table></div>
        </div></div>
      ))}
      <p className="small text-muted">{t(
        "Chaque exercice compte six séquences (deux par trimestre). Une séquence verrouillée n'accepte plus de saisie ni de correction."
      )}{" "}{t("Une fois le délai de saisie passé, l'administration est alertée des enseignants qui n'ont pas saisi toutes leurs notes.")}</p>
    </>
  );
}

// --- Liste éditable générique (classes, matières) -----------------------------------------------------------
function ListeEditable({ table, colonnes, vide, ordre }) {
  const [edition, setEdition] = useState(null), [erreur, setErreur] = useState("")
  const [lignes, erreurChargement, rafraichir] = useDonnees(async () => verifier(await supabase.from(table).select("*").order(ordre[0]).order(ordre[1])), [])

  async function enregistrer(e) {
    e.preventDefault(); setErreur("")
    const valeurs = Object.fromEntries(colonnes.map((c) => [c.cle, c.options ? (edition[c.cle] === "" || edition[c.cle] == null ? null : c.nombre ? Number(edition[c.cle]) : edition[c.cle])
      : c.nombre ? Number(edition[c.cle] || 0) : String(edition[c.cle] ?? "").trim()]))
    try {
      verifier(edition.id ? await supabase.from(table).update(valeurs).eq("id", edition.id) : await supabase.from(table).insert(valeurs))
      setEdition(null); rafraichir()
    } catch (err) { setErreur(err.message) }
  }
  async function supprimer(l) {
    if (!confirm(t("Supprimer cet élément ?"))) return
    try { verifier(await supabase.from(table).delete().eq("id", l.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }

  if (!lignes) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <Alerte>{erreur}</Alerte>
      {edition ? (
        <form className="card card-body mb-3" onSubmit={enregistrer} style={{ maxWidth: 820 }}>
          <div className="row g-2">
            {colonnes.map((c) => (
              <div className="col-md" key={c.cle}><label className="form-label" htmlFor={c.cle}>{t(c.libelle)}</label>
                {c.options ? (
                  <select className="form-select" id={c.cle} value={edition[c.cle] ?? ""} onChange={(e) => setEdition({ ...edition, [c.cle]: e.target.value })}>
                    <option value="">{c.vide ? t(c.vide) : "—"}</option>{c.options.map(([v, lib]) => <option key={v} value={v}>{lib}</option>)}</select>
                ) : (
                <input className="form-control" id={c.cle} type={c.nombre ? "number" : "text"} min={c.nombre ? 0 : undefined}
                       required={c.requis} maxLength={c.max} value={edition[c.cle] ?? ""} onChange={(e) => setEdition({ ...edition, [c.cle]: e.target.value })} />)}
                {c.aide && <div className="form-text">{c.aide}</div>}</div>))}
          </div>
          <div className="d-flex gap-2 mt-3"><button className="btn btn-primary">{t("Enregistrer")}</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => setEdition(null)}>{t("Annuler")}</button></div>
        </form>
      ) : <button className="btn btn-primary mb-3" onClick={() => setEdition({ ...vide })}>{t("+ Ajouter")}</button>}
      <div className="card" style={{ maxWidth: 820 }}><div className="table-responsive"><table className="table table-hover align-middle mb-0">
        <thead className="table-light"><tr>{colonnes.map((c) => <th key={c.cle}>{t(c.libelle)}</th>)}<th /></tr></thead>
        <tbody>{lignes.map((l) => (
          <tr key={l.id}>{colonnes.map((c) => <td key={c.cle}>{c.options ? (c.options.find(([v]) => String(v) === String(l[c.cle]))?.[1] || "—") : l[c.cle]}</td>)}
            <td className="text-end text-nowrap"><button className="btn btn-sm btn-outline-secondary me-1" onClick={() => setEdition(l)}>{t("Modifier")}</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => supprimer(l)}>{t("Supprimer")}</button></td></tr>))}
          {!lignes.length && <tr><td colSpan={colonnes.length + 1} className="text-center text-muted py-3">{t("Aucun élément.")}</td></tr>}</tbody>
      </table></div></div>
    </>
  );
}

export const CYCLES = [[1, "Premier cycle"], [2, "Second cycle"]]
function Classes() {
  const [sections, erreur] = useDonnees(async () => verifier(await supabase.from("sections").select("id, libelle").order("ordre").order("libelle")), [])
  if (!sections) return <><Alerte>{erreur}</Alerte><Chargement /></>
  return (
    <>
      {!sections.length && <p className="small text-muted">{t(
        "Astuce : créez d'abord les sections (anglophone, francophone, technique…) dans l'onglet « Sections », puis rattachez-y chaque classe."
      )}</p>}
      <ListeEditable table="classes" ordre={["ordre", "libelle"]} vide={{ libelle: "", niveau: "", section_id: "", cycle: "", ordre: 0, coef_min: 0 }}
        colonnes={[{ cle: "libelle", libelle: "Classe", requis: true, max: 50 }, { cle: "niveau", libelle: "Niveau", max: 50 },
                   { cle: "section_id", libelle: "Section", options: sections.map((x) => [x.id, x.libelle]), vide: "Aucune" },
                   { cle: "cycle", libelle: "Cycle", options: CYCLES.map(([v, l]) => [v, t(l)]), nombre: true, vide: t("Non précisé") },
                   { cle: "ordre", libelle: "Ordre d'affichage", nombre: true },
                   { cle: "coef_min", libelle: t("Coef. minimum pour être classé"), nombre: true, aide: t("0 = toujours classé") }]} />
    </>
  );
}

const Sections = () => (
  <>
    <p className="small text-muted">{t(
      "Les sections de l'établissement (par exemple : anglophone, francophone, technique). Chaque classe est rattachée à une section dans l'onglet « Classes »."
    )}</p>
    <ListeEditable table="sections" ordre={["ordre", "libelle"]} vide={{ libelle: "", ordre: 0 }}
      colonnes={[{ cle: "libelle", libelle: "Section", requis: true, max: 60 }, { cle: "ordre", libelle: "Ordre d'affichage", nombre: true }]} />
  </>
)

const Matieres = () => <ListeEditable table="matieres" ordre={["libelle", "code"]} vide={{ code: "", libelle: "" }}
  colonnes={[{ cle: "code", libelle: "Code", requis: true, max: 15 }, { cle: "libelle", libelle: t("Matière"), requis: true, max: 100 }]} />

// --- Matières par classe (attributions) ---------------------------------------------------------------------
function Coefficients() {
  const { exercice } = useSession()
  const [classeId, setClasseId] = useState(""), [erreur, setErreur] = useState(""), [ajout, setAjout] = useState(null)
  const [ref] = useDonnees(async () => ({
    classes: verifier(await supabase.from("classes").select("id, libelle").order("ordre").order("libelle")),
    matieres: verifier(await supabase.from("matieres").select("id, code, libelle").order("libelle")),
    personnels: verifier(await supabase.from("personnels").select("id, nom, prenom, role").eq("actif", true)).sort((a, b) => comparerNoms(nomComplet(a), nomComplet(b))),
  }), [])
  const [attributions, , rafraichir] = useDonnees(async () => !classeId || !exercice ? [] :
    await toutCharger(() => supabase.from("attributions").select("*, matieres(code, libelle)").eq("classe_id", classeId).eq("exercice_id", exercice.id)), [classeId, exercice?.id])

  async function maj(a, champs) {
    setErreur("")
    try { verifier(await supabase.from("attributions").update(champs).eq("id", a.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }
  async function ajouter(e) {
    e.preventDefault(); setErreur("")
    try {
      verifier(await supabase.from("attributions").insert({ exercice_id: exercice.id, classe_id: classeId, matiere_id: ajout.matiere_id,
        enseignant_id: ajout.enseignant_id || null, coefficient: Number(ajout.coefficient), groupe: Number(ajout.groupe) }))
      setAjout(null); rafraichir()
    } catch (err) { setErreur(err.message) }
  }
  async function retirer(a) {
    if (!confirm(t(
      "Retirer {v0} de cette classe ? Les notes de cette matière seront supprimées.",
      {
        v0: a.matieres.libelle
      }
    ))) return
    try { verifier(await supabase.from("attributions").delete().eq("id", a.id)); rafraichir() } catch (err) { setErreur(err.message) }
  }

  if (!exercice) return <div className="alert alert-warning">{t("Activez d'abord un exercice.")}</div>;
  if (!ref) return <Chargement />
  // toute personne active peut recevoir une matière (et en saisir les notes), quelle que soit sa fonction
  const enseignants = ref.personnels
  const libelleProf = (p) => `${nomComplet(p)}${{ admin: t(" (administration)"), surveillant: t(" (surveillant général)"), comptable: t(" (comptable / caissier)") }[p.role] || ""}`
  const parId = new Map(ref.personnels.map((p) => [p.id, p]))
  const dejaPrises = new Set((attributions || []).map((a) => a.matiere_id))
  return (
    <>
      <Alerte>{erreur}</Alerte>
      <select className="form-select mb-3" style={{ maxWidth: 320 }} value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label={t("Classe")}>
        <option value="">{t("Choisissez une classe…")}</option>{ref.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
      </select>
      {classeId && attributions && (
        <>
          <div className="card mb-3"><div className="table-responsive"><table className="table align-middle mb-0">
            <thead className="table-light"><tr><th>{t("Matière")}</th><th>{t("Enseignant")}</th><th>{t("Coefficient")}</th><th>{t("Groupe")}</th><th /></tr></thead>
            <tbody>{[...attributions].sort((a, b) => a.groupe - b.groupe || comparerNoms(a.matieres.libelle, b.matieres.libelle)).map((a) => (
              <tr key={a.id}><td>{a.matieres.libelle}</td>
                <td><select className={`form-select form-select-sm ${a.enseignant_id && !enseignants.some((p) => p.id === a.enseignant_id) ? "is-invalid" : ""}`}
                            value={a.enseignant_id || ""} onChange={(e) => maj(a, { enseignant_id: e.target.value || null })} aria-label={t("Enseignant")}>
                  <option value="">{t("— Aucun enseignant —")}</option>
                  {a.enseignant_id && !enseignants.some((p) => p.id === a.enseignant_id) &&
                    <option value={a.enseignant_id}>{parId.has(a.enseignant_id) ? t("{v0} (pas enseignant)", {
                      v0: nomComplet(parId.get(a.enseignant_id))
                    }) : t("Personnel désactivé")}</option>}
                  {enseignants.map((p) => <option key={p.id} value={p.id}>{libelleProf(p)}</option>)}</select>
                  {a.enseignant_id && !enseignants.some((p) => p.id === a.enseignant_id) &&
                    <div className="invalid-feedback d-block">{t("Cette personne ne peut pas saisir de notes : choisissez un enseignant.")}</div>}</td>
                <td><input className="form-control form-control-sm" type="number" min={1} max={20} defaultValue={a.coefficient} style={{ width: 80 }}
                           onBlur={(e) => Number(e.target.value) !== a.coefficient && maj(a, { coefficient: Number(e.target.value) })} aria-label={t("Coefficient")} /></td>
                <td><select className="form-select form-select-sm" value={a.groupe} onChange={(e) => maj(a, { groupe: Number(e.target.value) })} aria-label={t("Groupe")}>
                  {[1, 2, 3].map((g) => <option key={g} value={g}>{t("Groupe ")}{g}</option>)}</select></td>
                <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => retirer(a)}>{t("Retirer")}</button></td></tr>))}
              {!attributions.length && <tr><td colSpan={5} className="text-center text-muted py-3">{t("Aucune matière pour cette classe.")}</td></tr>}</tbody>
          </table></div></div>
          {ajout ? (
            <form className="card card-body" onSubmit={ajouter} style={{ maxWidth: 820 }}><div className="row g-2 align-items-end">
              <div className="col-md-4"><label className="form-label" htmlFor="am">{t("Matière")}</label>
                <select className="form-select" id="am" required value={ajout.matiere_id} onChange={(e) => setAjout({ ...ajout, matiere_id: e.target.value })}>
                  <option value="">…</option>{ref.matieres.filter((m) => !dejaPrises.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.libelle}</option>)}</select></div>
              <div className="col-md-4"><label className="form-label" htmlFor="ae">{t("Enseignant")}</label>
                <select className="form-select" id="ae" value={ajout.enseignant_id} onChange={(e) => setAjout({ ...ajout, enseignant_id: e.target.value })}>
                  <option value="">{t("— Aucun enseignant —")}</option>{enseignants.map((p) => <option key={p.id} value={p.id}>{libelleProf(p)}</option>)}</select>
                {!enseignants.some((p) => p.role === "enseignant") && <div className="form-text">{t("Créez d'abord les enseignants dans Personnel.")}</div>}</div>
              <div className="col-md-2"><label className="form-label" htmlFor="ac">{t("Coef.")}</label>
                <input className="form-control" id="ac" type="number" min={1} max={20} required value={ajout.coefficient} onChange={(e) => setAjout({ ...ajout, coefficient: e.target.value })} /></div>
              <div className="col-md-2"><label className="form-label" htmlFor="ag">{t("Groupe")}</label>
                <select className="form-select" id="ag" value={ajout.groupe} onChange={(e) => setAjout({ ...ajout, groupe: e.target.value })}>{[1, 2, 3].map((g) => <option key={g}>{g}</option>)}</select></div>
            </div><div className="d-flex gap-2 mt-3"><button className="btn btn-primary">{t("Ajouter")}</button>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setAjout(null)}>{t("Annuler")}</button></div></form>
          ) : <button className="btn btn-primary" onClick={() => setAjout({ matiere_id: "", enseignant_id: "", coefficient: 2, groupe: 1 })}>{t("+ Ajouter une matière à la classe")}</button>}
        </>
      )}
    </>
  );
}

// --- Discipline : sanctions, infractions, barème -------------------------------------------------------------
function ParametresDiscipline() {
  const { exercice } = useSession()
  const [erreur, setErreur] = useState(""), [ok, setOk] = useState("")
  const [sanction, setSanction] = useState({ libelle: "", points_perdus: 1 }), [infraction, setInfraction] = useState({ libelle: "", sanction_id: "" })
  const [d, erreurChargement, rafraichir] = useDonnees(async () => ({
    sanctions: verifier(await supabase.from("sanctions").select("*").order("points_perdus").order("libelle")),
    infractions: verifier(await supabase.from("infractions").select("*, sanctions(libelle)").order("libelle")),
    bareme: exercice ? verifier(await supabase.from("parametres_discipline").select("*").eq("exercice_id", exercice.id).maybeSingle()) : null,
  }), [exercice?.id])
  const [bareme, setBareme] = useState(null)
  const b = bareme || d?.bareme

  async function action(f, message) {
    setErreur(""); setOk("")
    try { await f(); rafraichir(); if (message) setOk(message) } catch (err) { setErreur(err.message) }
  }
  const ajouterSanction = (e) => { e.preventDefault(); action(async () => { verifier(await supabase.from("sanctions").insert({ libelle: sanction.libelle.trim(), points_perdus: Number(sanction.points_perdus) })); setSanction({ libelle: "", points_perdus: 1 }) }) }
  const ajouterInfraction = (e) => { e.preventDefault(); action(async () => { verifier(await supabase.from("infractions").insert({ libelle: infraction.libelle.trim(), sanction_id: infraction.sanction_id })); setInfraction({ libelle: "", sanction_id: "" }) }) }
  const supprimer = (table, x) => confirm(t("Supprimer cet élément ?")) && action(async () => verifier(await supabase.from(table).delete().eq("id", x.id)))
  const enregistrerBareme = (e) => { e.preventDefault(); action(async () => {
    verifier(await supabase.from("parametres_discipline").update({ note_max: Number(b.note_max), points_par_retard: Number(b.points_par_retard), points_par_heure: Number(b.points_par_heure) }).eq("exercice_id", exercice.id))
    setBareme(null) }, t("Barème enregistré.")) }

  if (!d) return <><Alerte>{erreurChargement}</Alerte><Chargement /></>
  return (
    <>
      <Alerte>{erreur}</Alerte><Alerte type="success">{ok}</Alerte>
      <div className="row g-3">
        <div className="col-lg-6"><div className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Sanctions (points perdus sur la note de discipline)")}</h2>
          <table className="table table-sm align-middle"><tbody>{d.sanctions.map((x) => (
            <tr key={x.id}><td>{x.libelle}</td><td className="text-end">−{Number(x.points_perdus).toLocaleString(locale())}{t(" pt")}</td>
              <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => supprimer("sanctions", x)}>{t("Supprimer")}</button></td></tr>))}
            {!d.sanctions.length && <tr><td className="text-muted">{t("Aucune sanction.")}</td></tr>}</tbody></table>
          <form className="d-flex gap-2" onSubmit={ajouterSanction}>
            <input className="form-control" required maxLength={150} placeholder={t("ex. Avertissement")} value={sanction.libelle} onChange={(e) => setSanction({ ...sanction, libelle: e.target.value })} aria-label={t("Sanction")} />
            <input className="form-control" style={{ maxWidth: 100 }} type="number" min={0} max={20} step="0.25" required value={sanction.points_perdus} onChange={(e) => setSanction({ ...sanction, points_perdus: e.target.value })} aria-label={t("Points perdus")} />
            <button className="btn btn-primary">{t("Ajouter")}</button></form>
        </div></div></div>
        <div className="col-lg-6"><div className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Types d'infractions")}</h2>
          <table className="table table-sm align-middle"><tbody>{d.infractions.map((x) => (
            <tr key={x.id}><td>{x.libelle}</td><td className="small text-muted">→ {x.sanctions.libelle}</td>
              <td className="text-end"><button className="btn btn-sm btn-outline-danger" onClick={() => supprimer("infractions", x)}>{t("Supprimer")}</button></td></tr>))}
            {!d.infractions.length && <tr><td className="text-muted">{t("Aucune infraction.")}</td></tr>}</tbody></table>
          <form className="d-flex flex-wrap gap-2" onSubmit={ajouterInfraction}>
            <input className="form-control" style={{ minWidth: 180, flex: 1 }} required maxLength={200} placeholder={t("ex. Bavardage en classe")} value={infraction.libelle} onChange={(e) => setInfraction({ ...infraction, libelle: e.target.value })} aria-label={t("Infraction")} />
            <select className="form-select" style={{ maxWidth: 220 }} required value={infraction.sanction_id} onChange={(e) => setInfraction({ ...infraction, sanction_id: e.target.value })} aria-label={t("Sanction associée")}>
              <option value="">{t("Sanction…")}</option>{d.sanctions.map((x) => <option key={x.id} value={x.id}>{x.libelle}</option>)}</select>
            <button className="btn btn-primary">{t("Ajouter")}</button></form>
        </div></div></div>
        <div className="col-12"><div className="card"><div className="card-body">
          <h2 className="h6">{t("Barème de la note de discipline ")}{exercice ? `(${exercice.libelle})` : ""}</h2>
          {!b ? <p className="text-muted mb-0">{t("Activez d'abord un exercice.")}</p> : (
            <form className="row g-2 align-items-end" onSubmit={enregistrerBareme} style={{ maxWidth: 820 }}>
              {[["note_max", t("Note maximale"), 1, 20], ["points_par_retard", t("Points perdus par retard"), 0, 20], ["points_par_heure", t("Points perdus par heure d'absence non justifiée"), 0, 20]].map(([k, lib, min, max]) => (
                <div className="col-md-3" key={k}><label className="form-label small" htmlFor={k}>{lib}</label>
                  <input className="form-control" id={k} type="number" step="0.25" min={min} max={max} required value={b[k]} onChange={(e) => setBareme({ ...b, [k]: e.target.value })} /></div>))}
              <div className="col-md-3"><button className="btn btn-primary w-100">{t("Enregistrer")}</button></div>
              <div className="form-text">{t(
                "Note = note maximale − (retards × points + heures non justifiées × points + points des sanctions), sans descendre sous 0."
              )}</div>
            </form>)}
        </div></div></div>
      </div>
    </>
  );
}
