// Paramètres → Cartes scolaires (administration) :
//  1. Modèle et contenu : cinq modèles, couleurs, éléments affichés, textes, aperçu pour un élève
//  2. Cachet et signature : import (PNG, JPG, SVG), recadrage et compression automatiques, historique, révocation
//  3. Générer : par élève, classe, niveau, cycle, section ou tout l'établissement ; filtre « à jour de pension » ;
//     planche A4 recto-verso, une carte par page, ou archive ZIP
//  4. Cartes émises : statut, suspension, réactivation, révocation, journal
import { useEffect, useMemo, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { CHAMPS_CARTE, COULEURS_MODELES, FICHES_MODELES, MODELES_CARTE, USAGES_CARTE, cartesPdf, cartesZip, champActif, donneesCarte,
  empreinteCarte, urlVerificationCarte } from "../lib/cartePdf.js"
import { photoCarte, preparerSignature } from "../lib/imagesCarte.js"
import { image, nomDeFichier } from "../lib/bulletinPdf.js"
import { adressesPhotos } from "../lib/photos.js"
import { signaturesEnService } from "../lib/signatures.js"
import { comparerNoms, date, dateHeure, nomComplet } from "../lib/format.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t } from "../i18n.jsx"

const STATUTS = { active: ["Active", "success"], suspendue: ["Suspendue", "warning"], revoquee: ["Révoquée", "danger"], remplacee: ["Remplacée", "secondary"] }
const CONFIG_DEFAUT = { modele: "classique", couleur: COULEURS_MODELES.classique[0], couleur2: COULEURS_MODELES.classique[1], champs: {}, textes: {}, expire_le: null, verification_paiement: false }

const chargerSignatures = (liste) => signaturesEnService(liste)

export default function ParametresCartes() {
  const { exercice } = useSession()
  const [vue, setVue] = useState("modele")
  const [ref, erreur, recharger] = useDonnees(async () => {
    const [config, classes, sections, signatures] = await Promise.all([
      supabase.from("cartes_config").select("*").maybeSingle().then(verifier),
      supabase.from("classes").select("*").order("ordre").order("libelle").then(verifier),
      supabase.from("sections").select("id, libelle").order("libelle").then(verifier),
      supabase.from("signatures_etablissement").select("*").order("ajoute_le", { ascending: false }).then(verifier)])
    const inscriptions = exercice ? await toutCharger(() => supabase.from("inscriptions").select("id, classe_id, eleves(*)").eq("exercice_id", exercice.id)) : []
    return { config: config || CONFIG_DEFAUT, classes, sections, signatures, inscriptions }
  }, [exercice?.id])
  if (!ref) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  return (
    <div className="cartes-scolaires">
      <p className="text-muted small">{t("Choisissez un modèle de carte, importez le cachet et la signature du chef d'établissement, réglez les informations affichées, puis générez les cartes (planche A4 recto-verso, une carte par page ou archive ZIP). Chaque carte porte un QR code de vérification.")}</p>
      <ul className="nav nav-pills mb-3">
        {[["modele", "Modèle et contenu"], ["signatures", "Cachet et signature"], ["generer", "Générer les cartes"], ["emises", "Cartes émises"]].map(([k, l]) => (
          <li className="nav-item" key={k}><button type="button" className={`nav-link${vue === k ? " active" : ""}`} onClick={() => setVue(k)}>{t(l)}</button></li>))}
      </ul>
      {vue === "modele" && <Modele reference={ref} recharger={recharger} />}
      {vue === "signatures" && <Signatures reference={ref} recharger={recharger} />}
      {vue === "generer" && (exercice ? <Generer reference={ref} /> : <div className="alert alert-warning">{t("Activez d'abord un exercice.")}</div>)}
      {vue === "emises" && <Emises />}
    </div>
  )
}

// --- Données d'une carte ----------------------------------------------------------------------------------
function carteDe(ins, reference, exercice, statut) {
  const classe = reference.classes.find((c) => c.id === ins.classe_id)
  const section = reference.sections.find((s) => s.id === classe?.section_id)?.libelle || ""
  return donneesCarte({ eleve: ins.eleves, classe, section, annee: exercice.libelle, statut })
}

// --- 1. Modèle et contenu ------------------------------------------------------------------------------------
function Modele({ reference, recharger }) {
  const { etablissement, exercice, logoUrl } = useSession()
  const [cfg, setCfg] = useState(() => ({ ...CONFIG_DEFAUT, ...reference.config }))
  const [msg, setMsg] = useState({}), [occupe, setOccupe] = useState(false), [apercu, setApercu] = useState(null), [eleve, setEleve] = useState("")
  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu) }, [apercu])
  const maj = (k, v) => setCfg({ ...cfg, [k]: v })
  const majTexte = (k, v) => setCfg({ ...cfg, textes: { ...cfg.textes, [k]: v } })
  const fiche = FICHES_MODELES[cfg.modele]
  const eleves = useMemo(() => [...reference.inscriptions].sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves))), [reference.inscriptions])

  async function enregistrer() {
    setMsg({}); setOccupe(true)
    try { await rpc("cartes_config_enregistrer", { p: cfg }); setMsg({ ok: t("Modèle et contenu enregistrés.") }); recharger() }
    catch (e) { setMsg({ erreur: e.message }) } finally { setOccupe(false) }
  }
  async function voirApercu() {
    setMsg({})
    try {
      const ins = eleves.find((x) => x.id === eleve) || eleves[0]
      const carte = ins && exercice ? carteDe(ins, reference, exercice, t("Actif"))
        : donneesCarte({ eleve: { nom: "Ngono", prenom: "Marie-Claire", matricule: "2026-0142", sexe: "F", date_naissance: "2013-04-07" }, classe: { libelle: "3e A", niveau: "3e", cycle: 1 }, section: "", annee: exercice?.libelle || "", statut: t("Actif") })
      const photos = ins?.eleves.photo ? await adressesPhotos([ins.eleves.photo]) : {}
      const [logo, signatures, photo] = await Promise.all([image(logoUrl), chargerSignatures(reference.signatures), photoCarte(photos[ins?.eleves.photo])])
      const url = await cartesPdf([{ carte, photo }], { cfg, etab: etablissement, images: { logo, ...signatures }, format: "carte", mode: "url" })
      if (apercu) URL.revokeObjectURL(apercu)
      setApercu(url)
    } catch (e) { setMsg({ erreur: e.message }) }
  }
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("1. Modèle")}</h2>
        <div className="d-flex flex-wrap gap-2 mb-3" role="radiogroup" aria-label={t("Modèle de carte")}>
          {Object.entries(MODELES_CARTE).map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={cfg.modele === k} className={`btn modele-carte carte-${k}${cfg.modele === k ? " active" : ""}`}
              style={{ "--c1": COULEURS_MODELES[k][0], "--c2": COULEURS_MODELES[k][1] }}
              onClick={() => setCfg({ ...cfg, modele: k, couleur: COULEURS_MODELES[k][0], couleur2: COULEURS_MODELES[k][1] })}>
              <span className="miniature" aria-hidden="true"><i /><b /></span><span className="small">{t(l)}</span></button>))}
        </div>
        <dl className="row small fiche-modele mb-0">
          {[["Structure", fiche.structure], ["Couleurs recommandées", fiche.couleurs], ["Hiérarchie de l'information", fiche.hierarchie], ["Photo", fiche.photo],
            ["Logo", fiche.logo], ["QR code", fiche.qr], ["Cachet et signature", fiche.cachet], ["Polices", fiche.polices],
            ["Recto / verso", "Recto : identité de l'élève, cachet et signature. Verso : coordonnées de l'établissement, règles d'usage, QR code de vérification, dates d'émission et de validité."],
            ["Usages", USAGES_CARTE]].map(([k, v]) => (
            <div className="col-md-6 d-flex gap-2" key={k}><dt className="text-muted fw-normal text-nowrap">{t(k)} :</dt><dd className="mb-1">{t(v)}</dd></div>))}
        </dl>
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("2. Couleurs")}</h2>
        <div className="d-flex flex-wrap gap-3 align-items-end">
          <div><label className="form-label small mb-0" htmlFor="k-c1">{t("Couleur principale")}</label>
            <input id="k-c1" type="color" className="form-control form-control-color" value={cfg.couleur} onChange={(e) => maj("couleur", e.target.value)} /></div>
          <div><label className="form-label small mb-0" htmlFor="k-c2">{t("Couleur d'accent")}</label>
            <input id="k-c2" type="color" className="form-control form-control-color" value={cfg.couleur2} onChange={(e) => maj("couleur2", e.target.value)} /></div>
          <button type="button" className="btn btn-sm btn-link" onClick={() => setCfg({ ...cfg, couleur: COULEURS_MODELES[cfg.modele][0], couleur2: COULEURS_MODELES[cfg.modele][1] })}>{t("Couleurs du modèle")}</button>
        </div>
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("3. Informations affichées")}</h2>
        <div className="row">{Object.entries(CHAMPS_CARTE).map(([k, [l]]) => (
          <div className="col-sm-6 col-lg-4" key={k}><label className="form-check small mb-1"><input type="checkbox" className="form-check-input" checked={champActif(cfg, k)}
            onChange={(e) => maj("champs", { ...cfg.champs, [k]: e.target.checked })} /> {t(l)}</label></div>))}</div>
        <div className="row g-2 mt-1">
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="k-titre">{t("Titre de la carte")}</label>
            <input id="k-titre" className="form-control form-control-sm" maxLength={40} placeholder={t("CARTE D'IDENTITÉ SCOLAIRE")} value={cfg.textes.titre || ""} onChange={(e) => majTexte("titre", e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="k-mail">{t("E-mail de l'établissement")}</label>
            <input id="k-mail" type="email" className="form-control form-control-sm" maxLength={80} value={cfg.textes.email || ""} onChange={(e) => majTexte("email", e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="k-sig">{t("Libellé du signataire")}</label>
            <input id="k-sig" className="form-control form-control-sm" maxLength={40} placeholder={t("Le chef d'établissement")} value={cfg.textes.signataire || ""} onChange={(e) => majTexte("signataire", e.target.value)} /></div>
          <div className="col-md-6"><label className="form-label small mb-0" htmlFor="k-exp">{t("Date d'expiration")}</label>
            <input id="k-exp" type="date" className="form-control form-control-sm" value={cfg.expire_le || ""} onChange={(e) => maj("expire_le", e.target.value || null)} />
            <div className="form-text">{t("Vide : fin de l'année scolaire (31 août).")}</div></div>
          <div className="col-12"><label className="form-label small mb-0" htmlFor="k-mention">{t("Mention au verso")}</label>
            <textarea id="k-mention" className="form-control form-control-sm" rows={2} maxLength={260} placeholder={t("Cette carte est strictement personnelle. Elle doit être présentée à toute demande du personnel de l'établissement. Toute falsification est interdite.")}
              value={cfg.textes.mention || ""} onChange={(e) => majTexte("mention", e.target.value)} /></div>
        </div>
        <label className="form-check small mt-2"><input type="checkbox" className="form-check-input" checked={!!cfg.verification_paiement} onChange={(e) => maj("verification_paiement", e.target.checked)} />{" "}
          {t("Au scan du QR code, indiquer si l'élève est à jour de pension (contrôle d'accès). Aucun montant n'est affiché.")}</label>
      </div></div>

      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("4. Aperçu")}</h2>
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <select className="form-select form-select-sm w-auto" value={eleve} onChange={(e) => setEleve(e.target.value)} aria-label={t("Élève pour l'aperçu")}>
            <option value="">{t("Premier élève de la liste")}</option>{eleves.slice(0, 500).map((i) => <option key={i.id} value={i.id}>{nomComplet(i.eleves)}</option>)}</select>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={voirApercu}>{t("Aperçu de la carte (recto et verso)")}</button>
        </div>
        {apercu && <iframe src={apercu} title={t("Aperçu de la carte")} className="apercu-carte mt-3" />}
      </div></div>
      <button className="btn btn-primary mb-4" disabled={occupe} onClick={enregistrer}>{t("Enregistrer le modèle et le contenu")}</button>
    </>
  )
}

// --- 2. Cachet et signature --------------------------------------------------------------------------------
function Signatures({ reference, recharger }) {
  const { etablissement } = useSession()
  const [msg, setMsg] = useState({}), [apercus, setApercus] = useState({})
  useEffect(() => {
    let vivant = true
    ;(async () => {
      const r = {}
      for (const s of reference.signatures.filter((x) => x.statut === "active")) {
        const { data } = await supabase.storage.from("signatures").createSignedUrl(s.chemin, 300)
        if (data?.signedUrl) r[s.type] = data.signedUrl
      }
      if (vivant) setApercus(r)
    })()
    return () => { vivant = false }
  }, [reference.signatures])
  async function revoquer(s) {
    const m = prompt(t("Motif de la révocation (perte, vol, départ du chef d'établissement…) :"))
    if (m === null) return
    setMsg({})
    try { await rpc("signature_revoquer", { p_id: s.id, p_motif: m.trim() }); setMsg({ ok: t("Révocation enregistrée : les cartes concernées seront signalées à la vérification jusqu'à leur régénération.") }); recharger() }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <div className="row g-3 mb-3">
        {["cachet", "signature"].map((type) => (
          <div className="col-md-6" key={type}><ImportSignature type={type} etablissement={etablissement} actuelle={apercus[type]}
            onFait={(texte) => { setMsg({ ok: texte }); recharger() }} onErreur={(e) => setMsg({ erreur: e })} /></div>))}
      </div>
      <div className="card mb-3"><div className="card-body"><h2 className="h6">{t("Historique")}</h2>
        <div className="table-responsive"><table className="table table-sm align-middle mb-0 historique-signatures">
          <thead className="table-light"><tr><th>{t("Type")}</th><th>{t("Importé le")}</th><th>{t("Statut")}</th><th>{t("Motif")}</th><th /></tr></thead>
          <tbody>{reference.signatures.map((s) => (
            <tr key={s.id}><td>{t(s.type === "cachet" ? "Cachet" : "Signature")}</td><td>{dateHeure(s.ajoute_le)}</td>
              <td><span className={`badge text-bg-${s.statut === "active" ? "success" : s.statut === "revoquee" ? "danger" : "secondary"}`}>{t({ active: "En service", remplacee: "Remplacé(e)", revoquee: "Révoqué(e)" }[s.statut])}</span></td>
              <td className="small">{s.motif}{s.revoque_le && <div className="text-muted">{dateHeure(s.revoque_le)}</div>}</td>
              <td className="text-end">{s.statut !== "revoquee" && <button className="btn btn-sm btn-outline-danger" onClick={() => revoquer(s)}>{t("Révoquer")}</button>}</td></tr>))}
            {!reference.signatures.length && <tr><td colSpan={5} className="text-muted text-center py-3">{t("Aucun cachet ni signature importé.")}</td></tr>}</tbody>
        </table></div>
      </div></div>
      <div className="card border-info mb-4 politique-signatures"><div className="card-body small">
        <h2 className="h6">🔒 {t("Politique de sécurité des cachets et signatures")}</h2>
        <ul className="mb-0">
          <li><strong>{t("Stockage sécurisé :")}</strong> {t("compartiment privé, un dossier par établissement, sans accès public ; chaque import crée un nouveau fichier et l'ancien est conservé pour l'historique.")}</li>
          <li><strong>{t("Accès restreint :")}</strong> {t("seule l'administration de l'établissement peut voir, importer ou révoquer un cachet ou une signature ; les enseignants, surveillants, comptables et parents n'y ont jamais accès.")}</li>
          <li><strong>{t("Journalisation :")}</strong> {t("chaque import, remplacement, révocation et chaque génération de cartes est enregistré (qui, quand, combien).")}</li>
          <li><strong>{t("Contre la réutilisation abusive :")}</strong> {t("sur chaque carte, le cachet et la signature sont recouverts d'un filigrane portant le code de la carte, et chaque carte enregistre le cachet et la signature utilisés.")}</li>
          <li><strong>{t("Révocation :")}</strong> {t("une signature révoquée n'est plus utilisée ; toute carte qui la porte est signalée « signature révoquée » lors de la vérification par QR code, jusqu'à sa régénération.")}</li>
        </ul>
      </div></div>
    </>
  )
}

function ImportSignature({ type, etablissement, actuelle, onFait, onErreur }) {
  const [prepare, setPrepare] = useState(null), [transparence, setTransparence] = useState(true), [fichier, setFichier] = useState(null), [envoi, setEnvoi] = useState(false)
  const titre = type === "cachet" ? t("Cachet de l'établissement") : t("Signature du chef d'établissement")
  async function traiter(f, transp = transparence) {
    if (!f) return
    setFichier(f)
    try { setPrepare(await preparerSignature(f, { transparence: transp })) } catch (e) { setPrepare(null); onErreur(e.message) }
  }
  async function enregistrer() {
    setEnvoi(true)
    try {
      const chemin = `${etablissement.id}/${type}-${Date.now()}.png`
      const { error } = await supabase.storage.from("signatures").upload(chemin, prepare.blob, { contentType: "image/png", upsert: false })
      if (error) throw new Error(error.message)
      await rpc("signature_enregistrer", { p_type: type, p_chemin: chemin, p_empreinte: prepare.empreinte })
      setPrepare(null); setFichier(null)
      onFait(type === "cachet" ? t("Cachet enregistré : il sera utilisé pour les prochaines cartes.") : t("Signature enregistrée : elle sera utilisée pour les prochaines cartes."))
    } catch (e) { onErreur(e.message) } finally { setEnvoi(false) }
  }
  return (
    <div className="card h-100 import-signature" data-type={type}><div className="card-body">
      <h2 className="h6">{titre}</h2>
      <div className="zone-signature mb-2">{actuelle ? <img src={actuelle} alt={titre} /> : <span className="text-muted small">{t("Aucun(e) en service")}</span>}</div>
      <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="form-control form-control-sm mb-2" aria-label={t("Importer : {v0}", { v0: titre })}
        onChange={(e) => traiter(e.target.files?.[0])} />
      <label className="form-check small"><input type="checkbox" className="form-check-input" checked={transparence}
        onChange={(e) => { setTransparence(e.target.checked); if (fichier) traiter(fichier, e.target.checked) }} /> {t("Rendre le fond blanc transparent (scan sur papier)")}</label>
      <div className="form-text">{t("PNG, JPG ou SVG. L'image est recadrée sur le tracé et compressée automatiquement.")}</div>
      {prepare && <div className="mt-2">
        <div className="zone-signature apercu mb-2"><img src={prepare.apercu} alt={t("Aperçu après traitement")} /></div>
        <div className="small text-muted mb-2">{t("{v0} × {v1} px, {v2} Ko après traitement", { v0: prepare.largeur, v1: prepare.hauteur, v2: Math.max(1, Math.round(prepare.blob.size / 1024)) })}</div>
        <button className="btn btn-sm btn-primary" disabled={envoi} onClick={enregistrer}>{envoi ? t("Enregistrement…") : t("Enregistrer et utiliser")}</button>
      </div>}
    </div></div>
  )
}

// --- 3. Génération ---------------------------------------------------------------------------------------------
function Generer({ reference }) {
  const { exercice, etablissement, logoUrl } = useSession()
  const [portee, setPortee] = useState("classe"), [valeur, setValeur] = useState(""), [aJour, setAJour] = useState(false), [forcer, setForcer] = useState(false)
  const [format, setFormat] = useState("planche"), [etat, setEtat] = useState(null), [msg, setMsg] = useState({}), [q, setQ] = useState("")
  const cfg = { ...CONFIG_DEFAUT, ...reference.config }
  const niveaux = [...new Set(reference.classes.map((c) => c.niveau).filter(Boolean))].sort(comparerNoms)
  const options = portee === "classe" ? reference.classes.map((c) => [c.id, c.libelle]) : portee === "niveau" ? niveaux.map((n) => [n, n])
    : portee === "cycle" ? [["1", t("Premier cycle")], ["2", t("Second cycle")]] : portee === "section" ? reference.sections.map((s) => [s.id, s.libelle]) : []
  const classeDe = (ins) => reference.classes.find((c) => c.id === ins.classe_id) || {}
  const dansPortee = (ins) => {
    const c = classeDe(ins)
    if (portee === "eleve") return ins.id === valeur
    if (portee === "classe") return ins.classe_id === valeur
    if (portee === "niveau") return c.niveau === valeur
    if (portee === "cycle") return String(c.cycle ?? "") === valeur
    if (portee === "section") return c.section_id === valeur
    return true
  }
  const resultatsRecherche = portee === "eleve" && q.trim().length >= 2
    ? reference.inscriptions.filter((i) => `${nomComplet(i.eleves)} ${i.eleves.matricule}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []

  async function generer() {
    setMsg({}); setEtat({ etape: t("Préparation…") })
    try {
      let liste = reference.inscriptions.filter(dansPortee)
      let exclus = 0
      if (aJour) {
        const f = await rpc("finance_eleves", { p_classe: null })
        if (!f?.configure) throw new Error(t("Les frais de scolarité ne sont pas configurés : le filtre « à jour de pension » est impossible."))
        const enRegle = new Set(f.eleves.filter((e) => e.en_regle).map((e) => e.inscription_id))
        exclus = liste.filter((i) => !enRegle.has(i.id)).length
        liste = liste.filter((i) => enRegle.has(i.id))
      }
      if (!liste.length) throw new Error(t("Aucun élève à traiter avec ces critères."))
      liste.sort((a, b) => comparerNoms(classeDe(a).libelle || "", classeDe(b).libelle || "") || comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves)))
      setEtat({ etape: t("Photos des élèves…") })
      const adresses = await adressesPhotos(liste.map((i) => i.eleves.photo))
      const statut = t("Actif")          // la situation de pension change : elle se lit au scan du QR code, pas sur la carte
      const cartes = []
      for (const [k, ins] of liste.entries()) {
        const photo = champActif(cfg, "photo") ? await photoCarte(adresses[ins.eleves.photo]) : null
        const carte = carteDe(ins, reference, exercice, statut)
        cartes.push({ ins, carte, photo, empreinte: await empreinteCarte(carte, cfg, photo) })
        if (k % 20 === 0) setEtat({ etape: t("Préparation des cartes… {v0}/{v1}", { v0: k + 1, v1: liste.length }) })
      }
      setEtat({ etape: t("Enregistrement des cartes…") })
      const codes = new Map()
      for (let i = 0; i < cartes.length; i += 500) {
        const r = await rpc("cartes_emettre", { p_cartes: cartes.slice(i, i + 500).map((x) => ({ inscription_id: x.ins.id, empreinte: x.empreinte })), p_forcer: forcer })
        for (const x of r) codes.set(x.inscription_id, x)
      }
      const imprimer = cartes.filter((x) => codes.get(x.ins.id)?.statut === "active")
      const suspendues = cartes.length - imprimer.length
      for (const x of imprimer) { const c = codes.get(x.ins.id); Object.assign(x.carte, { code: c.code, version: c.version, expire_le: c.expire_le, emise_le: new Date().toISOString() }) }
      if (!imprimer.length) throw new Error(t("Toutes les cartes demandées sont suspendues : réactivez-les d'abord (onglet « Cartes émises »)."))
      setEtat({ etape: t("Création du document…") })
      const [logo, signatures] = await Promise.all([image(logoUrl), chargerSignatures(reference.signatures)])
      const opts = { cfg, etab: etablissement, images: { logo, ...signatures } }
      const nom = nomDeFichier(t("cartes scolaires"), portee === "eleve" ? imprimer[0].carte.nom : portee === "etablissement" ? etablissement.nom : options.find(([k]) => k === valeur)?.[1] || portee, exercice.libelle)
      if (format === "zip") await cartesZip(imprimer, opts, nom, (f, n) => setEtat({ etape: t("Archive ZIP… {v0}/{v1}", { v0: f, v1: n }) }))
      else await cartesPdf(imprimer, { ...opts, format, nom })
      const nouvelles = imprimer.filter((x) => codes.get(x.ins.id)?.nouvelle).length
      setMsg({ ok: [t("{v0} carte(s) générée(s) : {v1} nouvelle(s), {v2} réimprimée(s) à l'identique.", { v0: imprimer.length, v1: nouvelles, v2: imprimer.length - nouvelles }),
        suspendues ? t("{v0} carte(s) suspendue(s) non imprimée(s).", { v0: suspendues }) : "", exclus ? t("{v0} élève(s) non à jour de pension écarté(s).", { v0: exclus }) : ""].filter(Boolean).join(" ") })
      if (!signatures.cachet && champActif(cfg, "cachet") || !signatures.signature && champActif(cfg, "signature")) setMsg((m) => ({ ...m, info: t("Aucun cachet ou aucune signature en service : importez-les dans l'onglet « Cachet et signature ».") }))
    } catch (e) { setMsg({ erreur: e.message }) } finally { setEtat(null) }
  }
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte><Alerte type="info">{msg.info}</Alerte>
      <div className="card mb-3"><div className="card-body">
        <div className="row g-2 align-items-end mb-2">
          <div className="col-sm-4"><label className="form-label small mb-0" htmlFor="g-portee">{t("Générer pour")}</label>
            <select id="g-portee" className="form-select" value={portee} onChange={(e) => { setPortee(e.target.value); setValeur(""); setQ("") }}>
              {[["eleve", "Un élève"], ["classe", "Une classe"], ["niveau", "Un niveau"], ["cycle", "Un cycle"], ["section", "Une section"], ["etablissement", "Tout l'établissement"]]
                .map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></div>
          {options.length > 0 && <div className="col-sm-5"><label className="form-label small mb-0" htmlFor="g-valeur">{t("Choix")}</label>
            <select id="g-valeur" className="form-select" value={valeur} onChange={(e) => setValeur(e.target.value)}>
              <option value="">{t("Choisir…")}</option>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>}
          {portee === "eleve" && <div className="col-sm-8 position-relative"><label className="form-label small mb-0" htmlFor="g-eleve">{t("Élève")}</label>
            <input id="g-eleve" className="form-control" placeholder={t("Nom ou matricule…")} value={q} onChange={(e) => { setQ(e.target.value); setValeur("") }} />
            {resultatsRecherche.length > 0 && !valeur && <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 5 }}>{resultatsRecherche.map((i) => (
              <button type="button" key={i.id} className="list-group-item list-group-item-action small" onClick={() => { setValeur(i.id); setQ(`${nomComplet(i.eleves)} · ${i.eleves.matricule}`) }}>
                {nomComplet(i.eleves)} <span className="text-muted">· {i.eleves.matricule} · {classeDe(i).libelle}</span></button>))}</div>}</div>}
        </div>
        <div className="d-flex flex-wrap gap-3 small mb-2">
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={aJour} onChange={(e) => setAJour(e.target.checked)} /> {t("Uniquement les élèves à jour de pension")}</label>
          <label className="form-check mb-0"><input type="checkbox" className="form-check-input" checked={forcer} onChange={(e) => setForcer(e.target.checked)} /> {t("Régénérer (carte perdue, abîmée…) : nouveau code, l'ancienne carte devient invalide")}</label>
        </div>
        <div className="d-flex flex-wrap gap-3 small mb-3" role="radiogroup" aria-label={t("Format")}>
          {[["planche", "Planche A4 recto-verso (10 cartes par feuille)"], ["carte", "Une carte par page (imprimante à cartes)"], ["zip", "Archive ZIP (un PDF par élève)"]].map(([k, l]) => (
            <label key={k} className="form-check mb-0"><input type="radio" className="form-check-input" name="format" checked={format === k} onChange={() => setFormat(k)} /> {t(l)}</label>))}
        </div>
        <button className="btn btn-primary" disabled={!!etat || (portee !== "etablissement" && !valeur)} onClick={generer}>{etat ? etat.etape : t("Générer les cartes")}</button>
        <div className="form-text">{t("Une carte déjà émise est réimprimée avec le même code si rien n'a changé ; si la classe, la photo ou une information change, une nouvelle carte est émise et l'ancienne est remplacée.")}</div>
      </div></div>
    </>
  )
}

// --- 4. Cartes émises -------------------------------------------------------------------------------------------
function Emises() {
  const { exercice } = useSession()
  const [cle, setCle] = useState(0), [q, setQ] = useState(""), [filtre, setFiltre] = useState("en_cours"), [msg, setMsg] = useState({})
  const [d, erreur] = useDonnees(async () => ({
    cartes: exercice ? await toutCharger(() => supabase.from("cartes_scolaires").select("*").eq("exercice_id", exercice.id).order("emise_le", { ascending: false })) : [],
    journal: await supabase.from("cartes_journal").select("*").order("le", { ascending: false }).limit(80).then(verifier),
  }), [exercice?.id, cle])
  if (!d) return <><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  async function changer(c, statut) {
    let motif = ""
    if (statut !== "active") { const m = prompt(statut === "revoquee" ? t("Motif de la révocation (définitive) :") : t("Motif de la suspension (carte perdue, sanction…) :")); if (m === null) return; motif = m.trim() }
    setMsg({})
    try { await rpc("carte_changer_statut", { p_carte: c.id, p_statut: statut, p_motif: motif }); setCle((k) => k + 1) } catch (e) { setMsg({ erreur: e.message }) }
  }
  const f = q.trim().toLowerCase()
  const liste = d.cartes.filter((c) => (filtre === "toutes" || (filtre === "en_cours" ? ["active", "suspendue"].includes(c.statut) : c.statut === filtre))
    && (!f || `${c.eleve} ${c.classe} ${c.code}`.toLowerCase().includes(f)))
  const compte = (s) => d.cartes.filter((c) => c.statut === s).length
  return (
    <>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input className="form-control" style={{ maxWidth: 320 }} placeholder={t("Élève, classe ou code…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Rechercher une carte")} />
        <select className="form-select w-auto" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label={t("Statut")}>
          <option value="en_cours">{t("En circulation")}</option><option value="active">{t("Actives")} ({compte("active")})</option>
          <option value="suspendue">{t("Suspendues")} ({compte("suspendue")})</option><option value="revoquee">{t("Révoquées")} ({compte("revoquee")})</option>
          <option value="remplacee">{t("Remplacées")} ({compte("remplacee")})</option><option value="toutes">{t("Toutes")}</option></select>
      </div>
      <div className="table-responsive mb-3"><table className="table table-sm align-middle tableau-cartes">
        <thead className="table-light"><tr><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Code")}</th><th className="text-center">{t("Version")}</th><th>{t("Émise le")}</th><th>{t("Valable jusqu'au")}</th><th>{t("Statut")}</th><th /></tr></thead>
        <tbody>{liste.slice(0, 500).map((c) => (
          <tr key={c.id}><td><strong>{c.eleve}</strong></td><td>{c.classe}</td>
            <td><a href={urlVerificationCarte(c.code)} target="_blank" rel="noopener noreferrer"><code>{c.code}</code></a></td>
            <td className="text-center">{c.version}</td><td>{date(c.emise_le)}</td><td>{date(c.expire_le)}</td>
            <td><span className={`badge text-bg-${STATUTS[c.statut][1]}`}>{t(STATUTS[c.statut][0])}</span>{c.motif && <div className="small text-muted">{c.motif}</div>}</td>
            <td className="text-end text-nowrap">
              {c.statut === "active" && <button className="btn btn-sm btn-outline-warning me-1" onClick={() => changer(c, "suspendue")}>{t("Suspendre")}</button>}
              {c.statut === "suspendue" && <button className="btn btn-sm btn-outline-success me-1" onClick={() => changer(c, "active")}>{t("Réactiver")}</button>}
              {["active", "suspendue"].includes(c.statut) && <button className="btn btn-sm btn-outline-danger" onClick={() => changer(c, "revoquee")}>{t("Révoquer")}</button>}
            </td></tr>))}
          {!liste.length && <tr><td colSpan={8} className="text-center text-muted py-3">{t("Aucune carte.")}</td></tr>}</tbody>
      </table></div>
      {d.journal.length > 0 && <details className="small mb-4"><summary>{t("Journal ({v0})", { v0: d.journal.length })}</summary>
        <ul className="list-unstyled mt-2 journal-cartes">{d.journal.map((j) => (
          <li key={j.id}><span className="text-muted">{dateHeure(j.le)}</span> · <strong>{t(ACTIONS[j.action] || j.action)}</strong>
            {j.details?.eleve && <> · {j.details.eleve}</>}
            {j.action === "emission" && <> · {t("{v0} nouvelle(s), {v1} réimprimée(s)", { v0: j.details.nouvelles, v1: j.details.reimprimees })}</>}
            {j.motif && <> · <em>{j.motif}</em></>}</li>))}</ul></details>}
    </>
  )
}
const ACTIONS = { configuration: "Modèle modifié", emission: "Cartes générées", suspension: "Carte suspendue", reactivation: "Carte réactivée", revocation: "Carte révoquée",
  cachet_importe: "Cachet importé", signature_importe: "Signature importée", cachet_revoque: "Cachet révoqué", signature_revoque: "Signature révoquée" }
