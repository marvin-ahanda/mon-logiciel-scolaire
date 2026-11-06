import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { chargerClasse, resultatsPeriode } from "../lib/donneesClasse.js"
import { enDate, enNote, enSexe, lireClasseur, normaliser, telechargerClasseur, texte } from "../lib/excel.js"
import { comparerNoms, nomComplet } from "../lib/format.js"
import { periodes } from "../lib/periodes.js"
import { useSession } from "../Session.jsx"
import { rpc, supabase, toutCharger, verifier } from "../supabase.js"
import { t, locale } from "../i18n.jsx"
import ExcelEcole from "./ExcelEcole.jsx"

const ENTETES_ELEVES = ["Matricule", "Nom", "Prénom", "Sexe", "Date de naissance", "Lieu de naissance", "Téléphone du parent", "Classe"]
// en-têtes reconnus à l'import (français et anglais)
const COLONNES_ELEVES = { matricule: ["Matricule", "Student ID"], nom: ["Nom", "Last name", "Surname"], prenom: ["Prénom", "Prenom", "First name"], sexe: ["Sexe", "Sex", "Gender"],
  date_naissance: ["Date de naissance", "Né le", "Ne le", "Date of birth"], lieu_naissance: ["Lieu de naissance", "Place of birth"],
  telephone_parent: ["Téléphone du parent", "Téléphone", "Telephone", "Parent's phone", "Phone"], classe: ["Classe", "Class"] }

function Carte({ titre, children }) {
  return <div className="col-xl-6"><div className="card h-100"><div className="card-header fw-semibold">{t(titre)}</div><div className="card-body">{children}</div></div></div>
}

// --- Élèves ------------------------------------------------------------------------------------------------
function Eleves({ ref_ }) {
  const { exercice } = useSession()
  const [classe, setClasse] = useState(""), [apercu, setApercu] = useState(null), [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)

  function modele() {
    telechargerClasseur([
      { titre: t("Élèves"), entetes: ENTETES_ELEVES, lignes: [["2026-0001", "NGONO", "Marie", "F", new Date(Date.UTC(2014, 1, 14)), t("Yaoundé"), "+237 600 000 000", ref_.classes[0]?.libelle || "6e A"]] },
      { titre: t("Mode d'emploi"), entetes: [t("Consignes")], largeurs: [110], lignes: [
        [t(
          "Une ligne par élève. Colonnes obligatoires : Matricule, Nom, Sexe (M ou F)."
        )],
        [t(
          "Classe : libellé exact d'une classe existante (ex. « 6e A ») ; vide = l'élève n'est pas inscrit dans une classe."
        )],
        [t("Date de naissance : au format jj/mm/aaaa (ou date Excel).")],
        [t(
          "Un matricule déjà connu met à jour l'élève ; un nouveau matricule crée l'élève."
        )],
        [t(
          "L'import est tout ou rien : s'il y a une erreur, rien n'est enregistré et les lignes à corriger sont signalées."
        )]] }], "modele-import-eleves")
  }

  async function exporter() {
    setMsg({})
    try {
      const eleves = await toutCharger(() => supabase.from("eleves").select("*"))
      const inscriptions = exercice ? await toutCharger(() => supabase.from("inscriptions").select("eleve_id, classe_id").eq("exercice_id", exercice.id)) : []
      const classeDe = new Map(inscriptions.map((i) => [i.eleve_id, i.classe_id])), libelle = new Map(ref_.classes.map((c) => [c.id, c.libelle]))
      const lignes = eleves.filter((e) => !classe || classeDe.get(e.id) === classe)
        .map((e) => ({ e, c: libelle.get(classeDe.get(e.id)) || "" }))
        .sort((a, b) => comparerNoms(a.c, b.c) || comparerNoms(nomComplet(a.e), nomComplet(b.e)))
        .map(({ e, c }) => [e.matricule, e.nom, e.prenom, e.sexe, e.date_naissance ? new Date(e.date_naissance + "T00:00:00Z") : null, e.lieu_naissance, e.telephone_parent, c])
      await telechargerClasseur([{ titre: t("Élèves"), entetes: ENTETES_ELEVES, lignes }], classe ? `eleves-${libelle.get(classe)}` : "eleves")
    } catch (x) { setMsg({ erreur: x.message }) }
  }

  async function analyser(fichier) {
    setMsg({}); setApercu(null)
    try {
      const { lignes, presentes } = await lireClasseur(fichier, COLONNES_ELEVES)
      const manquantes = ["matricule", "nom", "sexe"].filter((c) => !presentes.has(c))
      if (manquantes.length) throw new Error(t("Colonnes manquantes : {v0}. Utilisez le modèle.", {
        v0: manquantes.join(", ")
      }))
      const existants = new Set((await toutCharger(() => supabase.from("eleves").select("matricule"))).map((e) => e.matricule))
      const classes = new Map(ref_.classes.map((c) => [normaliser(c.libelle), c]))
      const vus = new Set()
      setApercu({ fichier: fichier.name, lignes: lignes.map(({ numero, valeurs: v }) => {
        const erreurs = [], d = { matricule: texte(v.matricule, 30), nom: texte(v.nom, 100), prenom: texte(v.prenom, 100),
          lieu_naissance: texte(v.lieu_naissance, 100), telephone_parent: texte(v.telephone_parent, 30) }
        if (!d.matricule) erreurs.push(t("matricule manquant"))
        else if (vus.has(d.matricule)) erreurs.push(t("matricule en double dans le fichier"))
        vus.add(d.matricule)
        if (!d.nom) erreurs.push(t("nom manquant"))
        d.sexe = enSexe(v.sexe); if (!d.sexe) erreurs.push(`sexe « ${texte(v.sexe)} » : M ou F attendu`)
        try { d.date_naissance = enDate(v.date_naissance) } catch (x) { erreurs.push(x.message) }
        const libelleClasse = texte(v.classe)
        const c = libelleClasse ? classes.get(normaliser(libelleClasse)) : null
        if (libelleClasse && !c) erreurs.push(`classe « ${libelleClasse} » inconnue`)
        if (c && !exercice) erreurs.push(t("aucun exercice actif pour inscrire l'élève"))
        d.classe_id = c?.id || null
        return { numero, donnees: d, classe: c?.libelle || "", action: existants.has(d.matricule) ? t("mise à jour") : t("création"), erreurs };
      }) })
    } catch (x) { setMsg({ erreur: x.message }) }
  }

  async function confirmer() {
    setEnvoi(true)
    try {
      const r = await rpc("importer_eleves", { p_lignes: apercu.lignes.map((l) => l.donnees) })
      setMsg({ ok: t("Import terminé : {v0} élève(s) créé(s), {v1} mis à jour.", {
        v0: r.crees,
        v1: r.modifies
      }) }); setApercu(null)
    } catch (x) { setMsg({ erreur: t("Rien n'a été enregistré : {v0}", {
      v0: x.message
    }) }) } finally { setEnvoi(false) }
  }

  const nbErreurs = apercu?.lignes.filter((l) => l.erreurs.length).length || 0
  return (
    <Carte titre={t("Élèves")}>
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      <p className="small text-muted">{t(
        "Création ou mise à jour selon le matricule, avec aperçu avant enregistrement (tout ou rien)."
      )}</p>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <label className="btn btn-primary mb-0">{t("Importer des élèves…")}<input type="file" hidden accept=".xlsx" onChange={(e) => { e.target.files[0] && analyser(e.target.files[0]); e.target.value = "" }} /></label>
        <button className="btn btn-outline-secondary" onClick={modele}>{t("Télécharger le modèle")}</button>
      </div>
      <div className="d-flex gap-2 mb-2">
        <select className="form-select" value={classe} onChange={(e) => setClasse(e.target.value)} aria-label={t("Classe à exporter")}>
          <option value="">{t("Toutes les classes")}</option>{ref_.classes.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select>
        <button className="btn btn-outline-primary text-nowrap" onClick={exporter}>{t("Exporter")}</button>
      </div>
      {apercu && (
        <div className="mt-3">
          <h3 className="h6">{t("Aperçu : ")}{apercu.fichier} — {apercu.lignes.length}{t(" ligne(s)")}{nbErreurs > 0 && <span className="text-danger">, {nbErreurs}{t(" à corriger")}</span>}</h3>
          <div className="table-responsive border rounded" style={{ maxHeight: 360 }}><table className="table table-sm mb-0 small">
            <thead className="table-light"><tr><th>{t("Ligne")}</th><th>{t("Matricule")}</th><th>{t("Élève")}</th><th>{t("Classe")}</th><th>{t("Action")}</th></tr></thead>
            <tbody>{apercu.lignes.map((l) => (
              <tr key={l.numero} className={l.erreurs.length ? "table-danger" : ""}><td>{l.numero}</td><td>{l.donnees.matricule}</td>
                <td>{l.donnees.nom} {l.donnees.prenom}{l.erreurs.map((x) => <div key={x} className="text-danger">{x}</div>)}</td><td>{l.classe}</td><td>{l.action}</td></tr>))}</tbody>
          </table></div>
          <div className="d-flex gap-2 mt-2">
            <button className="btn btn-success" disabled={nbErreurs > 0 || envoi || !apercu.lignes.length} onClick={confirmer}>{envoi ? t("Enregistrement…") : "Confirmer l'import"}</button>
            <button className="btn btn-outline-secondary" onClick={() => setApercu(null)}>{t("Annuler")}</button>
          </div>
          {nbErreurs > 0 && <p className="small text-danger mt-1">{t(
            "Corrigez le fichier puis importez-le de nouveau : rien n'est enregistré tant qu'il reste une erreur."
          )}</p>}
        </div>
      )}
    </Carte>
  );
}

// --- Notes -------------------------------------------------------------------------------------------------
function Notes({ ref_ }) {
  const { exercice } = useSession()
  const [attributionId, setAttributionId] = useState(""), [sequenceId, setSequenceId] = useState("")
  const [apercu, setApercu] = useState(null), [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false)
  const attribution = ref_.attributions.find((a) => a.id === attributionId), sequence = ref_.sequences.find((s) => s.id === sequenceId)

  async function donneesNotes() {
    const inscriptions = await toutCharger(() => supabase.from("inscriptions").select("id, eleves(matricule, nom, prenom)").eq("classe_id", attribution.classe_id).eq("exercice_id", exercice.id))
    const notes = await toutCharger(() => supabase.from("notes").select("inscription_id, valeur").eq("attribution_id", attribution.id).eq("sequence_id", sequence.id))
    return { inscriptions: inscriptions.sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves))), notes: new Map(notes.map((n) => [n.inscription_id, Number(n.valeur)])) }
  }

  async function liste() {
    setMsg({})
    try {
      const { inscriptions, notes } = await donneesNotes()
      await telechargerClasseur([{ titre: t("Notes"), entetes: ["Matricule", t("Élève"), "Note"], largeurs: [16, 40, 10],
        lignes: inscriptions.map((i) => [i.eleves.matricule, nomComplet(i.eleves), notes.get(i.id) ?? null]) },
        { titre: t("Mode d'emploi"), entetes: [t("Consignes")], largeurs: [110], lignes: [
          [t("{v0} — {v1} — Séquence {v2} ({v3})", {
            v0: attribution.classes.libelle,
            v1: attribution.matieres.libelle,
            v2: sequence.numero,
            v3: exercice.libelle
          })],
          [t(
            "Saisissez les notes sur 20 dans la colonne « Note » (deux décimales au plus, virgule ou point)."
          )],
          [t(
            "Une case vide ne modifie ni ne supprime aucune note. Ne modifiez pas la colonne « Matricule »."
          )]] }],
        `notes-${attribution.classes.libelle}-${attribution.matieres.code}-S${sequence.numero}`)
    } catch (x) { setMsg({ erreur: x.message }) }
  }

  async function analyser(fichier) {
    setMsg({}); setApercu(null)
    try {
      if (sequence.verrouillee) throw new Error(t("La séquence est verrouillée : aucune note ne peut être importée."))
      const { lignes, presentes } = await lireClasseur(fichier, { matricule: ["Matricule", "Student ID"], note: ["Note", "Note /20", "Note sur 20", "Grade", "Grade /20"] })
      if (!presentes.has("matricule") || !presentes.has("note")) throw new Error(t(
        "Colonnes « Matricule » et « Note » obligatoires : utilisez la liste téléchargée."
      ))
      const { inscriptions, notes } = await donneesNotes()
      const parMatricule = new Map(inscriptions.map((i) => [i.eleves.matricule, i]))
      const vus = new Set()
      setApercu({ fichier: fichier.name, lignes: lignes.map(({ numero, valeurs: v }) => {
        const erreurs = [], matricule = texte(v.matricule), ins = parMatricule.get(matricule)
        if (!ins) erreurs.push(t("matricule « {v0} » absent de la classe", {
          v0: matricule
        }))
        else if (vus.has(matricule)) erreurs.push(t("élève en double dans le fichier"))
        vus.add(matricule)
        let nouvelle = null
        try { nouvelle = enNote(v.note) } catch (x) { erreurs.push(x.message) }
        return { numero, matricule, ins, eleve: ins ? nomComplet(ins.eleves) : "", actuelle: ins ? notes.get(ins.id) ?? null : null, nouvelle, erreurs }
      }) })
    } catch (x) { setMsg({ erreur: x.message }) }
  }

  async function confirmer() {
    const aEcrire = apercu.lignes.filter((l) => l.nouvelle !== null && l.nouvelle !== l.actuelle)
      .map((l) => ({ inscription_id: l.ins.id, attribution_id: attribution.id, sequence_id: sequence.id, valeur: l.nouvelle }))
    setEnvoi(true)
    try {
      if (aEcrire.length) verifier(await supabase.from("notes").upsert(aEcrire, { onConflict: "inscription_id,attribution_id,sequence_id" }))
      setMsg({ ok: t("{v0} note(s) enregistrée(s).", {
        v0: aEcrire.length
      }) }); setApercu(null)
    } catch (x) { setMsg({ erreur: t("Rien n'a été enregistré : {v0}", {
      v0: x.message
    }) }) } finally { setEnvoi(false) }
  }

  const nbErreurs = apercu?.lignes.filter((l) => l.erreurs.length).length || 0
  return (
    <Carte titre="Notes">
      <Alerte>{msg.erreur}</Alerte><Alerte type="success">{msg.ok}</Alerte>
      <p className="small text-muted">{t(
        "Téléchargez la liste de la classe, saisissez les notes dans Excel, puis importez-la. Une case vide ne supprime aucune note."
      )}</p>
      <div className="row g-2 mb-2">
        <div className="col-md-7"><select className="form-select" value={attributionId} onChange={(e) => { setAttributionId(e.target.value); setApercu(null) }} aria-label={t("Classe et matière")}>
          <option value="">{t("Classe et matière…")}</option>{ref_.attributions.map((a) => <option key={a.id} value={a.id}>{a.classes.libelle} — {a.matieres.libelle}</option>)}</select></div>
        <div className="col-md-5"><select className="form-select" value={sequenceId} onChange={(e) => { setSequenceId(e.target.value); setApercu(null) }} aria-label={t("Séquence")}>
          <option value="">{t("Séquence…")}</option>{ref_.sequences.map((s) => <option key={s.id} value={s.id}>{t("Séquence ")}{s.numero}{s.verrouillee ? t(" (verrouillée)") : ""}</option>)}</select></div>
      </div>
      <div className="d-flex flex-wrap gap-2">
        <button className="btn btn-outline-secondary" disabled={!attribution || !sequence} onClick={liste}>{t("Télécharger la liste")}</button>
        <label className={`btn btn-primary mb-0 ${!attribution || !sequence ? "disabled" : ""}`}>{t("Importer les notes…")}<input type="file" hidden accept=".xlsx" disabled={!attribution || !sequence} onChange={(e) => { e.target.files[0] && analyser(e.target.files[0]); e.target.value = "" }} /></label>
      </div>
      {apercu && (
        <div className="mt-3">
          <h3 className="h6">{t("Aperçu : ")}{apercu.fichier}{nbErreurs > 0 && <span className="text-danger"> — {nbErreurs}{t(" ligne(s) à corriger")}</span>}</h3>
          <div className="table-responsive border rounded" style={{ maxHeight: 360 }}><table className="table table-sm mb-0 small">
            <thead className="table-light"><tr><th>{t("Ligne")}</th><th>{t("Élève")}</th><th className="text-end">{t("Actuelle")}</th><th className="text-end">{t("Nouvelle")}</th></tr></thead>
            <tbody>{apercu.lignes.map((l) => (
              <tr key={l.numero} className={l.erreurs.length ? "table-danger" : l.nouvelle !== null && l.nouvelle !== l.actuelle ? "table-success" : ""}>
                <td>{l.numero}</td><td>{l.eleve || l.matricule}{l.erreurs.map((x) => <div key={x} className="text-danger">{x}</div>)}</td>
                <td className="text-end">{l.actuelle?.toLocaleString(locale()) ?? ""}</td><td className="text-end">{l.nouvelle?.toLocaleString(locale()) ?? ""}</td></tr>))}</tbody>
          </table></div>
          <div className="d-flex gap-2 mt-2">
            <button className="btn btn-success" disabled={nbErreurs > 0 || envoi} onClick={confirmer}>{envoi ? t("Enregistrement…") : "Confirmer l'import"}</button>
            <button className="btn btn-outline-secondary" onClick={() => setApercu(null)}>{t("Annuler")}</button>
          </div>
        </div>
      )}
    </Carte>
  );
}

// --- Export des résultats ----------------------------------------------------------------------------------
function ExportResultats({ ref_ }) {
  const { exercice } = useSession()
  const [classeId, setClasseId] = useState(""), [code, setCode] = useState(""), [msg, setMsg] = useState(""), [envoi, setEnvoi] = useState(false)
  async function exporter() {
    setMsg(""); setEnvoi(true)
    try {
      const classe = ref_.classesResultats.find((c) => c.id === classeId), periode = ref_.periodes.find((p) => p.code === code)
      const donnees = await chargerClasse(classe, exercice)
      const { resultats, stats } = resultatsPeriode(donnees, periode)
      const n = donnees.attributions.length
      const lignes = [...resultats].sort((a, b) => (a.rang ?? 1e9) - (b.rang ?? 1e9)).map((r) => [
        r.rang ? `${r.rang}${r.exAequo ? t(" ex") : ""}` : t("NC"), r.eleve.matricule, nomComplet(r.eleve), ...r.lignes.map((l) => l.note),
        r.totalCoef, r.totalPoints, r.moyenne ?? r.moyenneNonClassee, t(r.appreciation)])
      lignes.push([], ["", "", t("Moyenne de la classe"), ...Array(n).fill(null), null, null, stats.moyenneClasse],
                  ["", "", t("Taux de réussite (%)"), ...Array(n).fill(null), null, null, stats.tauxReussite])
      await telechargerClasseur([{ titre: `${classe.libelle} ${periode.libelle}`, lignes,
        entetes: [t("Rang"), "Matricule", t("Élève"), ...donnees.attributions.map((a) => `${a.code} (coef. ${a.coefficient})`), t("Total coef."), t("Total points"), t("Moyenne"), t("Appréciation")] }],
        `resultats-${classe.libelle}-${periode.code}`)
    } catch (x) { setMsg(x.message) } finally { setEnvoi(false) }
  }
  return (
    <Carte titre={t("Résultats")}>
      <Alerte>{msg}</Alerte>
      <p className="small text-muted">{t(
        "Classement d'une classe pour une séquence, un trimestre ou l'année, avec les notes de chaque matière."
      )}</p>
      <div className="row g-2">
        <div className="col-md-5"><select className="form-select" value={classeId} onChange={(e) => setClasseId(e.target.value)} aria-label={t("Classe")}>
          <option value="">{t("Classe…")}</option>{ref_.classesResultats.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
        <div className="col-md-4"><select className="form-select" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("Période")}>
          <option value="">{t("Période…")}</option>{ref_.periodes.map((p) => <option key={p.code} value={p.code}>{p.libelle}</option>)}</select></div>
        <div className="col-md-3"><button className="btn btn-outline-primary w-100" disabled={!classeId || !code || envoi} onClick={exporter}>{envoi ? "…" : t("Exporter")}</button></div>
      </div>
    </Carte>
  );
}

export default function Excel() {
  const { exercice, estAdmin, profil } = useSession()
  const [ref_, erreur] = useDonnees(async () => {
    const classes = verifier(await supabase.from("classes").select("*").order("ordre").order("libelle"))
    if (!exercice) return { classes, attributions: [], sequences: [], periodes: [], classesResultats: [] }
    let q = supabase.from("attributions").select("id, classe_id, classes(libelle, ordre), matieres(code, libelle)").eq("exercice_id", exercice.id)
    if (!estAdmin) q = q.eq("enseignant_id", profil.id)
    const attributions = verifier(await q).sort((a, b) => a.classes.ordre - b.classes.ordre || comparerNoms(a.classes.libelle, b.classes.libelle) || comparerNoms(a.matieres.libelle, b.matieres.libelle))
    const sequences = verifier(await supabase.from("sequences").select("*").eq("exercice_id", exercice.id).order("numero"))
    const siennes = new Set(attributions.map((a) => a.classe_id))
    return { classes, attributions, sequences, periodes: periodes(sequences), classesResultats: estAdmin ? classes : classes.filter((c) => siennes.has(c.id)) }
  }, [exercice?.id])
  return (
    <>
      <h1 className="h3 mb-3">{t("Import et export Excel")}</h1>
      {/* hors du chargement : le bilan de l'import (codes du personnel) reste affiché quand l'année scolaire change */}
      {estAdmin && <div className="row g-3 mb-3"><ExcelEcole /></div>}
      {!ref_ ? <><Alerte>{erreur}</Alerte><Chargement /></> : <>
      {!exercice && <div className="alert alert-warning">{t(
        "Aucun exercice actif : seuls l'import et l'export des élèves sont possibles."
      )}</div>}
      <div className="row g-3">
        {estAdmin && <Eleves ref_={ref_} />}
        {exercice && <Notes ref_={ref_} />}
        {exercice && <ExportResultats ref_={ref_} />}
      </div></>}
    </>
  );
}
