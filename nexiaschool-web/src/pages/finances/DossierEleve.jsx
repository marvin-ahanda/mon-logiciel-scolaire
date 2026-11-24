// Dossier financier d'un élève : pension et autres frais, factures, remises, encaissements (reçus PDF avec QR code,
// partage, annulation tracée), paiements en attente, et formulaire d'encaissement (idempotent).
import { useEffect, useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { facturePdf, recuFinancePdf } from "../../lib/financeDocs.js"
import { fcfa, jour, MODES, modePaiement } from "../../lib/financePdf.js"
import { urlVerification } from "../../lib/bulletinVerif.js"
import { useSession } from "../../Session.jsx"
import { rpc, supabase, verifier } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, demanderMotif, Modale, nouvelleCle, signalerMajFinance, useDroits } from "./commun.jsx"

const NATURES = { reduction: "Réduction", exoneration: "Exonération", bourse: "Bourse", aide: "Aide", decision: "Décision administrative" }
const PENSION = ""                                                       // rubrique « pension » dans les listes

/** Rubrique (pension ou catégorie) -> { libelle, reste } d'après le dossier */
function rubriques(d) {
  return [{ id: PENSION, libelle: t("Pension / scolarité"), reste: d.pension.reste, du: d.pension.du },
          ...d.autres.map((a) => ({ id: a.categorie_id, libelle: a.libelle, reste: a.reste, du: a.du }))]
}

export async function imprimerRecu({ session, dossier, paiement, imprimer = false }) {
  const fenetre = imprimer ? window.open("", "_blank") : null
  const r = rubriques(dossier).find((x) => x.id === (paiement.categorie_id || PENSION))
  try {
    await recuFinancePdf({ etablissement: session.etablissement, logoUrl: session.logoUrl, eleve: dossier.eleve, paiement, reste: r?.reste,
      caissier: paiement.saisi_par, mention: session.mention }, { imprimer, fenetre })
  } catch (e) { fenetre?.close(); throw e }
}

export default function DossierEleve({ inscriptionId, onFermer, onMaj }) {
  const session = useSession(), droits = useDroits()
  const [d, erreur, rafraichir] = useDonnees(() => rpc("finance_situation_eleve", { p_insc: inscriptionId }), [inscriptionId])
  const [ref] = useDonnees(async () => {
    const [parametres, comptes] = await Promise.all([
      supabase.from("finance_parametres").select("modes_actifs, mention_documents").maybeSingle().then(verifier),
      supabase.from("comptes_financiers").select("id, libelle, type, modes").eq("actif", true).order("libelle").then(verifier)])
    return { parametres, comptes }
  }, [])
  const [msg, setMsg] = useState({}), [envoi, setEnvoi] = useState(false), [remise, setRemise] = useState(null)
  const [p, setP] = useState({ rubrique: PENSION, montant: "", mode: "especes", date: aujourdhui(), reference: "", payeur: "", observation: "", compte: "", attente: false, cle: nouvelleCle() })
  const modes = ref?.parametres?.modes_actifs || ["especes", "mtn_momo", "orange_money", "virement", "cheque"]
  useEffect(() => { if (ref && !modes.includes(p.mode)) setP((x) => ({ ...x, mode: modes[0] })) }, [ref]) // eslint-disable-line react-hooks/exhaustive-deps
  const maj = async (texte) => { setMsg({ ok: texte }); await rafraichir(); onMaj?.(); signalerMajFinance() }
  const ctx = { ...session, mention: ref?.parametres?.mention_documents }

  async function encaisser(ev) {
    ev.preventDefault(); setMsg({})
    const montant = Math.round(Number(p.montant)), r = rubriques(d).find((x) => x.id === p.rubrique)
    if (!(montant > 0)) return setMsg({ erreur: t("Indiquez un montant supérieur à 0.") })
    if (p.rubrique === PENSION && montant > r.reste && !confirm(t("Ce montant dépasse le reste à payer ({v0}). Enregistrer quand même ?", { v0: fcfa(r.reste) }))) return
    setEnvoi(true)
    try {
      const res = await rpc("finance_encaisser", { p: { inscription_id: inscriptionId, categorie_id: p.rubrique || null, montant, mode: p.mode, date: p.date,
        reference: p.reference.trim(), payeur: p.payeur.trim(), observation: p.observation.trim(), compte_id: p.compte || null, en_attente: p.attente, cle: p.cle } })
      setP((x) => ({ ...x, montant: "", reference: "", observation: "", attente: false, cle: nouvelleCle() }))
      await maj(res.attente_id ? t("Paiement de {v0} enregistré EN ATTENTE : il ne sera compté qu'après confirmation.", { v0: fcfa(montant) })
        : res.deja_enregistre ? t("Ce paiement avait déjà été enregistré (reçu n° {v0}) : aucun doublon créé.", { v0: res.numero })
        : t("Paiement de {v0} enregistré : reçu n° {v1}.", { v0: fcfa(montant), v1: res.numero }))
    } catch (x) { setMsg({ erreur: x.message }) } finally { setEnvoi(false) }
  }
  async function annuler(x) {
    const motif = demanderMotif(t("Motif de l'annulation du reçu n° {v0} ({v1}) ? Une contre-écriture sera enregistrée ; le reçu reste visible.", { v0: x.numero, v1: fcfa(x.montant) }))
    if (!motif) return
    try { await rpc("finance_annuler_paiement", { p_id: x.id, p_motif: motif }); await maj(t("Reçu n° {v0} annulé (contre-écriture).", { v0: x.numero })) }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  async function recu(x, imprimer) {
    try { await imprimerRecu({ session: ctx, dossier: d, paiement: x, imprimer }) } catch (e) { setMsg({ erreur: t("Reçu impossible : {v0}", { v0: e.message }) }) }
  }
  function partager(x, canal) {
    const texte = t("{v0} — Reçu n° {v1} du {v2} : {v3} ({v4}). Vérification : {v5}", { v0: session.etablissement.nom, v1: x.numero, v2: jour(x.date),
      v3: fcfa(x.montant), v4: `${d.eleve.nom} ${d.eleve.prenom || ""}`.trim(), v5: urlVerification(x.code_verif) })
    if (canal === "whatsapp") window.open(`https://wa.me/?text=${encodeURIComponent(texte)}`, "_blank", "noopener")
    else window.location.href = `mailto:?subject=${encodeURIComponent(t("Reçu n° {v0}", { v0: x.numero }))}&body=${encodeURIComponent(texte)}`
  }
  async function facture(f) {
    const s = f.categorie_id ? d.autres.find((a) => a.categorie_id === f.categorie_id) : { ...d.pension }
    try { await facturePdf({ etablissement: session.etablissement, logoUrl: session.logoUrl, eleve: d.eleve, facture: f, situation: s, mention: ctx.mention }) }
    catch (e) { setMsg({ erreur: e.message }) }
  }
  async function accorderRemise(ev) {
    ev.preventDefault()
    try {
      await rpc("finance_remise_accorder", { p: { inscription_id: inscriptionId, categorie_id: remise.rubrique || null, nature: remise.nature, type: remise.type,
        valeur: Number(remise.valeur), motif: remise.motif } })
      setRemise(null); await maj(t("Remise enregistrée."))
    } catch (e) { setMsg({ erreur: e.message }) }
  }
  async function annulerRemise(r) {
    const motif = demanderMotif(t("Motif de l'annulation de cette remise ?")); if (!motif) return
    try { await rpc("finance_remise_annuler", { p_id: r.id, p_motif: motif }); await maj(t("Remise annulée.")) } catch (e) { setMsg({ erreur: e.message }) }
  }

  const titre = d ? `${d.eleve.nom} ${d.eleve.prenom || ""} · ${d.eleve.classe}` : t("Dossier financier")
  return (
    <Modale titre={titre} onFermer={onFermer} large>
      <Alerte>{erreur}</Alerte>
      {!d && !erreur && <Chargement />}
      {d && <>
        <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte><Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
        <div className="small text-muted mb-2">{t("Matricule ")}{d.eleve.matricule || "—"} · {d.eleve.annee} · {d.eleve.nouveau ? t("Nouvel élève") : t("Ancien élève")}</div>
        <div className="table-responsive mb-3"><table className="table table-sm align-middle mb-0">
          <thead><tr><th>{t("Rubrique")}</th><th className="text-end">{t("Dû")}</th><th className="text-end">{t("Remises")}</th><th className="text-end">{t("Payé")}</th>
            <th className="text-end">{t("Reste")}</th><th className="text-end">{t("En retard")}</th></tr></thead>
          <tbody>
            <tr><td>{t("Pension / scolarité")}</td><td className="text-end">{fcfa(d.pension.brut)}</td><td className="text-end">{d.pension.remise ? `− ${fcfa(d.pension.remise)}` : "—"}</td>
              <td className="text-end">{fcfa(d.pension.paye)}</td><td className="text-end fw-semibold">{fcfa(d.pension.reste)}</td>
              <td className={`text-end${d.pension.retard ? " text-danger fw-semibold" : ""}`}>{d.pension.retard ? fcfa(d.pension.retard) : "—"}</td></tr>
            {d.autres.map((a) => (
              <tr key={a.categorie_id}><td>{a.libelle}{a.nature === "dette_anterieure" && <span className="badge text-bg-warning ms-1">{t("Dette antérieure")}</span>}</td>
                <td className="text-end">{fcfa(a.brut)}</td><td className="text-end">{a.remise ? `− ${fcfa(a.remise)}` : "—"}</td><td className="text-end">{fcfa(a.paye)}</td>
                <td className="text-end fw-semibold">{fcfa(a.reste)}</td><td className={`text-end${a.retard ? " text-danger fw-semibold" : ""}`}>{a.retard ? fcfa(a.retard) : "—"}</td></tr>))}
          </tbody></table></div>

        <h3 className="h6">{t("Encaissements")}</h3>
        <div className="table-responsive mb-3"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Reçu")}</th><th>{t("Date")}</th><th>{t("Rubrique")}</th><th className="text-end">{t("Montant")}</th><th>{t("Mode")}</th><th>{t("Agent")}</th><th /></tr></thead>
          <tbody>{d.paiements.map((x) => (
            <tr key={x.id} className={x.annule || x.annule_paiement_id ? "text-muted" : undefined}>
              <td className="text-nowrap">{String(x.numero).padStart(5, "0")}{x.annule && <span className="badge text-bg-dark ms-1">{t("annulé")}</span>}
                {x.annule_paiement_id && <span className="badge text-bg-light border ms-1" title={x.motif_annulation}>{t("contre-écriture")}</span>}</td>
              <td>{jour(x.date)}</td><td className="small">{t(x.rubrique)}</td><td className="text-end">{fcfa(x.montant)}</td><td className="small">{modePaiement(x.mode)}</td>
              <td className="small">{x.saisi_par || "—"}</td>
              <td className="text-end text-nowrap">
                <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => recu(x, false)}>{t("Reçu PDF")}</button>
                <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => recu(x, true)}>{t("Imprimer")}</button>
                {!x.annule_paiement_id && <>
                  <button className="btn btn-sm btn-outline-success me-1" title={t("Partager par WhatsApp")} onClick={() => partager(x, "whatsapp")}>WhatsApp</button>
                  <button className="btn btn-sm btn-outline-secondary me-1" title={t("Partager par e-mail")} onClick={() => partager(x, "mail")}>{t("E-mail")}</button></>}
                {x.annulable && <button className="btn btn-sm btn-outline-danger" onClick={() => annuler(x)}>{t("Annuler")}</button>}</td></tr>))}
            {!d.paiements.length && <tr><td colSpan={7} className="text-muted">{t("Aucun paiement enregistré.")}</td></tr>}</tbody>
        </table></div>
        {d.attentes.some((a) => a.statut === "en_attente") && <div className="alert alert-warning py-2 small">
          {t("Paiement(s) en attente de confirmation (non comptés) : {v0}", { v0: d.attentes.filter((a) => a.statut === "en_attente").map((a) => `${fcfa(a.montant)} (${modePaiement(a.mode)})`).join(", ") })}</div>}

        {droits.a("caisse") && (
          <form className="card card-body bg-light mb-3" onSubmit={encaisser}>
            <h3 className="h6">{t("Encaisser un paiement")}</h3>
            <div className="row g-2">
              <div className="col-md-4"><label className="form-label small" htmlFor="enc-rub">{t("Rubrique")}</label>
                <select id="enc-rub" className="form-select" value={p.rubrique} onChange={(x) => setP({ ...p, rubrique: x.target.value })}>
                  {rubriques(d).map((r) => <option key={r.id} value={r.id} disabled={r.id !== PENSION && r.reste <= 0}>{r.libelle} — {t("reste")} {fcfa(r.reste)}</option>)}</select></div>
              <div className="col-md-2"><label className="form-label small" htmlFor="enc-mt">{t("Montant (FCFA)")}</label>
                <input id="enc-mt" className="form-control" type="number" min={1} step={1} required value={p.montant} onChange={(x) => setP({ ...p, montant: x.target.value })} />
                <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setP({ ...p, montant: rubriques(d).find((r) => r.id === p.rubrique)?.reste || "" })}>{t("tout le reste")}</button></div>
              <div className="col-md-3"><label className="form-label small" htmlFor="enc-mode">{t("Mode")}</label>
                <select id="enc-mode" className="form-select" value={p.mode} onChange={(x) => setP({ ...p, mode: x.target.value })}>
                  {modes.map((k) => <option key={k} value={k}>{t(MODES[k] || k)}</option>)}</select></div>
              <div className="col-md-3"><label className="form-label small" htmlFor="enc-date">{t("Date")}</label>
                <input id="enc-date" className="form-control" type="date" required max={aujourdhui()} value={p.date} onChange={(x) => setP({ ...p, date: x.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small" htmlFor="enc-ref">{t("Référence (n° de transaction, chèque…)")}</label>
                <input id="enc-ref" className="form-control" maxLength={80} value={p.reference} onChange={(x) => setP({ ...p, reference: x.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small" htmlFor="enc-pay">{t("Payé par")}</label>
                <input id="enc-pay" className="form-control" maxLength={120} placeholder={t("parent, tuteur…")} value={p.payeur} onChange={(x) => setP({ ...p, payeur: x.target.value })} /></div>
              <div className="col-md-4"><label className="form-label small" htmlFor="enc-cpt">{t("Compte de trésorerie")}</label>
                <select id="enc-cpt" className="form-select" value={p.compte} onChange={(x) => setP({ ...p, compte: x.target.value })}>
                  <option value="">{t("Automatique (selon le mode)")}</option>{(ref?.comptes || []).map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}</select></div>
              <div className="col-12"><label className="form-label small" htmlFor="enc-obs">{t("Observation")}</label>
                <input id="enc-obs" className="form-control" maxLength={200} value={p.observation} onChange={(x) => setP({ ...p, observation: x.target.value })} /></div>
              <div className="col-12 form-check ms-2">
                <input id="enc-att" className="form-check-input" type="checkbox" checked={p.attente} onChange={(x) => setP({ ...p, attente: x.target.checked })} />
                <label className="form-check-label small" htmlFor="enc-att">{t("Paiement en attente de confirmation (mobile money non reçu, chèque à encaisser…) : il ne sera compté qu'après confirmation.")}</label></div>
            </div>
            <div className="mt-2"><button className="btn btn-success" disabled={envoi}>{envoi ? t("Enregistrement…") : p.attente ? t("Enregistrer en attente") : t("Enregistrer le paiement")}</button></div>
          </form>)}

        <div className="row g-3">
          <div className="col-md-6">
            <h3 className="h6">{t("Factures")}</h3>
            <ul className="list-group list-group-flush small">{d.factures.map((f) => (
              <li key={f.id} className="list-group-item d-flex justify-content-between align-items-center px-0">
                <span>FAC-{String(f.numero).padStart(6, "0")} · {f.libelle} · {fcfa(f.montant_brut)}{f.annulee_le && <span className="badge text-bg-dark ms-1">{t("annulée")}</span>}</span>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => facture(f)}>PDF</button></li>))}
              {!d.factures.length && <li className="list-group-item px-0 text-muted">{t("Aucune facture émise.")}</li>}</ul>
          </div>
          <div className="col-md-6">
            <div className="d-flex justify-content-between align-items-center"><h3 className="h6 mb-0">{t("Remises, bourses, exonérations")}</h3>
              {droits.a("facturation") && !remise && <button className="btn btn-sm btn-outline-primary" onClick={() => setRemise({ rubrique: PENSION, nature: "reduction", type: "montant", valeur: "", motif: "" })}>{t("Accorder")}</button>}</div>
            {remise && (
              <form className="border rounded p-2 my-2 small" onSubmit={accorderRemise}>
                <div className="row g-2">
                  <div className="col-6"><select className="form-select form-select-sm" aria-label={t("Rubrique")} value={remise.rubrique} onChange={(x) => setRemise({ ...remise, rubrique: x.target.value })}>
                    {rubriques(d).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)}</select></div>
                  <div className="col-6"><select className="form-select form-select-sm" aria-label={t("Nature")} value={remise.nature} onChange={(x) => setRemise({ ...remise, nature: x.target.value })}>
                    {Object.entries(NATURES).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
                  {remise.nature !== "exoneration" && <>
                    <div className="col-6"><select className="form-select form-select-sm" aria-label={t("Type")} value={remise.type} onChange={(x) => setRemise({ ...remise, type: x.target.value })}>
                      <option value="montant">{t("Montant (FCFA)")}</option><option value="pourcentage">{t("Pourcentage")}</option></select></div>
                    <div className="col-6"><input className="form-control form-control-sm" type="number" min={1} max={remise.type === "pourcentage" ? 100 : undefined} required
                      aria-label={t("Valeur")} value={remise.valeur} onChange={(x) => setRemise({ ...remise, valeur: x.target.value })} /></div></>}
                  <div className="col-12"><input className="form-control form-control-sm" required minLength={3} maxLength={300} placeholder={t("Motif (obligatoire)")}
                    value={remise.motif} onChange={(x) => setRemise({ ...remise, motif: x.target.value })} /></div>
                </div>
                <div className="mt-2 d-flex gap-2"><button className="btn btn-sm btn-primary">{t("Enregistrer")}</button>
                  <button type="button" className="btn btn-sm btn-link" onClick={() => setRemise(null)}>{t("Annuler")}</button></div>
              </form>)}
            <ul className="list-group list-group-flush small">{d.remises.map((r) => (
              <li key={r.id} className={`list-group-item px-0${r.annulee_le ? " text-muted" : ""}`}>
                <div className="d-flex justify-content-between"><span><strong>{t(NATURES[r.nature])}</strong> · {r.type === "pourcentage" ? `${r.valeur} %` : fcfa(r.valeur)}
                  {" · "}{r.categorie_id ? d.autres.find((a) => a.categorie_id === r.categorie_id)?.libelle || t("autre frais") : t("Pension")}</span>
                  {!r.annulee_le && droits.a("facturation") && <button className="btn btn-sm btn-link text-danger p-0" onClick={() => annulerRemise(r)}>{t("Annuler")}</button>}</div>
                <div>{r.motif} — {r.accorde_par} · {jour(r.accorde_le)}{r.annulee_le && ` · ${t("annulée")} (${r.motif_annulation})`}</div></li>))}
              {!d.remises.length && <li className="list-group-item px-0 text-muted">{t("Aucune remise.")}</li>}</ul>
          </div>
        </div>
      </>}
    </Modale>
  )
}
