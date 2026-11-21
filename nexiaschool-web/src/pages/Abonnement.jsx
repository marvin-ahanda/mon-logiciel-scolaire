// Abonnement de l'établissement (administrateur) : offre en vigueur, capacité d'élèves, élèves inscrits, places restantes,
// augmentation de capacité (on paie la différence, l'échéance est conservée), renouvellement (capacité conservée ou modifiée),
// historique et reçus. Montants calculés en base ; activation uniquement après paiement vérifié côté serveur.
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../composants/Communs.jsx"
import { date, dateHeure } from "../lib/format.js"
import { NOMS_OFFRES } from "../lib/offres.js"
import { fcfa, montantEtablissement, payer, STATUTS, useRetourPaiement } from "../lib/paiement.js"
import { recuPdf } from "../lib/recuPdf.js"
import { useSession } from "../Session.jsx"
import { rpc } from "../supabase.js"
import { t } from "../i18n.jsx"

const TYPES = { souscription: "Souscription", renouvellement: "Renouvellement", extension: "Augmentation de capacité",
                console: "Attribution par NexIA", migration: "Passage au nouveau modèle", decouverte: "Découverte" }

function Jauge({ actifs, capacite }) {
  if (capacite == null) return <p className="text-muted small mb-0">{t("Effectif sans limite (abonnement antérieur ou attribution par NexIA).")}</p>
  const taux = capacite ? Math.min(100, Math.round((actifs / capacite) * 100)) : 100
  const couleur = taux >= 100 ? "danger" : taux >= 90 ? "warning" : "success"
  return (
    <div className="progress" role="progressbar" aria-label={t("Remplissage de la capacité")} aria-valuenow={taux} aria-valuemin={0} aria-valuemax={100} style={{ height: 10 }}>
      <div className={`progress-bar bg-${couleur}`} style={{ width: `${taux}%` }} />
    </div>
  )
}

function Etat({ a }) {
  const expire = a.expire_le ? new Date(a.expire_le) : null
  const jours = expire ? Math.ceil((expire - Date.now()) / 864e5) : null
  return (
    <div className="card mb-4"><div className="card-body">
      <div className="d-flex flex-wrap justify-content-between gap-2 align-items-start">
        <div>
          <h2 className="h5 mb-1">{t("Offre actuelle")}</h2>
          <p className="fs-4 fw-bold mb-1">{t(NOMS_OFFRES[a.offre])}</p>
          {a.offre === "premium" && expire && <p className={`mb-0 ${jours <= 15 ? "text-danger fw-semibold" : "text-muted"}`}>
            {a.grace ? t("Échéance dépassée le {v0} : délai de grâce en cours, renouvelez sans attendre.", { v0: date(expire) })
                     : t("Valable jusqu'au {v0} ({v1} jours restants).", { v0: date(expire), v1: Math.max(jours, 0) })}</p>}
          {a.offre === "decouverte" && <p className="text-muted mb-0">{a.decouverte_fin
            ? t("Offre gratuite jusqu'au {v0} : fonctions de base, effectif limité.", { v0: date(a.decouverte_fin) })
            : t("Offre gratuite : fonctions de base, effectif limité.")}</p>}
          {a.offre === "expiree" && <p className="text-danger mb-0">{t("Votre abonnement (ou votre période de découverte) est terminé : vos données restent consultables. Souscrivez à l'offre Premium pour continuer à les modifier.")}</p>}
          {a.renouvellement_programme && <p className="text-success small mb-0">{t("Renouvellement payé : il commencera à l'échéance actuelle.")}</p>}
        </div>
        <dl className="row mb-0 small text-md-end" style={{ minWidth: 260 }}>
          <dt className="col-7 fw-normal text-muted">{t("Capacité souscrite")}</dt><dd className="col-5 fw-semibold mb-1">{a.capacite ?? t("illimitée")}</dd>
          <dt className="col-7 fw-normal text-muted">{t("Élèves inscrits cette année")}</dt><dd className="col-5 fw-semibold mb-1">{a.eleves_actifs}</dd>
          <dt className="col-7 fw-normal text-muted">{t("Places restantes")}</dt><dd className="col-5 fw-semibold mb-0">{a.places_restantes ?? "—"}</dd>
        </dl>
      </div>
      <div className="mt-3"><Jauge actifs={a.eleves_actifs} capacite={a.capacite} /></div>
    </div></div>
  )
}

/** Souscription / renouvellement (12 mois) ou augmentation de capacité de la période en cours. */
function Commande({ a, setMsg, relire, recharger }) {
  const tarifs = a.tarifs
  const e = tarifs.etablissement
  const periode = a.periode
  const extensionPossible = a.offre === "premium" && periode && !a.grace
  const [mode, setMode] = useState(extensionPossible && !a.renouvelable ? "extension" : "abonnement")
  const defaut = Math.max(a.capacite || 0, a.eleves_actifs || 0, e.capacite_minimum)
  const [capacite, setCapacite] = useState(mode === "extension" ? (a.capacite || 0) + 50 : defaut)
  const [occupe, setOccupe] = useState(false)
  const cap = Math.floor(Number(capacite) || 0)
  const montantAbonnement = montantEtablissement(cap, tarifs)
  const difference = periode ? Math.max(0, montantEtablissement(cap, tarifs) - periode.montant_paye) : 0
  const montant = mode === "extension" ? difference : montantAbonnement
  const invalide = cap < 1 || cap > e.capacite_max || (mode === "extension" && cap <= (a.capacite || 0))
  const sousEffectif = mode === "abonnement" && cap < a.eleves_actifs

  async function valider() {
    setOccupe(true); setMsg({})
    try {
      const r = await payer(mode === "extension" ? "etab_extension" : "etab_abonnement", "/abonnement", { capacite: cap })
      if (r?.gratuit) { setMsg({ ok: t("Capacité portée à {v0} élèves : le montant déjà payé la couvre.", { v0: r.capacite }) }); relire(); recharger(); setOccupe(false) }
    } catch (x) { setMsg({ erreur: x.message }); setOccupe(false) }
  }

  return (
    <div className="card mb-4"><div className="card-body">
      <h2 className="h5">{t("Augmenter ou renouveler mon abonnement")}</h2>
      <div className="btn-group mb-3 flex-wrap" role="group" aria-label={t("Type d'opération")}>
        <button type="button" className={`btn ${mode === "abonnement" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={mode === "abonnement"}
                disabled={!a.renouvelable} onClick={() => { setMode("abonnement"); setCapacite(defaut) }}>
          {a.offre === "premium" ? t("Renouveler (12 mois)") : t("Souscrire à Premium (12 mois)")}</button>
        <button type="button" className={`btn ${mode === "extension" ? "btn-primary" : "btn-outline-primary"}`} aria-pressed={mode === "extension"}
                disabled={!extensionPossible} onClick={() => { setMode("extension"); setCapacite((a.capacite || 0) + 50) }}>
          {t("Augmenter ma capacité")}</button>
      </div>
      {!a.renouvelable && mode === "abonnement" && <p className="small text-muted">{t("Le renouvellement s'ouvre {v0} jours avant l'échéance.", { v0: e.renouvellement_jours || 60 })}</p>}
      <div className="row g-3 align-items-end">
        <div className="col-sm-5">
          <label className="form-label" htmlFor="ab-capacite">{mode === "extension" ? t("Nouvelle capacité totale (élèves)") : t("Nombre d'élèves souscrits")}</label>
          <input id="ab-capacite" type="number" min={1} max={e.capacite_max} step={1} className="form-control" value={capacite}
                 onChange={(x) => setCapacite(x.target.value)} aria-describedby="ab-aide" />
        </div>
        <div className="col-sm-4">
          <div className="small text-muted">{mode === "extension" ? t("Différence à payer") : t("Montant annuel")}</div>
          <div className="fs-4 fw-bold">{fcfa(montant)}</div>
        </div>
        <div className="col-sm-3 d-grid">
          <button type="button" className="btn btn-success" disabled={occupe || invalide} onClick={valider}>
            {occupe ? t("Patientez…") : montant > 0 ? t("Payer {v0}", { v0: fcfa(montant) }) : t("Appliquer")}</button>
        </div>
      </div>
      <p className="small text-muted mt-3 mb-0" id="ab-aide">
        {t("Tarif : {v0} par élève et par an, minimum {v1} par an (soit {v2} élèves). Toutes les fonctionnalités sont incluses.",
           { v0: fcfa(e.prix_eleve), v1: fcfa(e.minimum_annuel), v2: e.capacite_minimum })}{" "}
        {mode === "extension"
          ? t("Augmentation : vous ne payez que la différence avec le montant déjà réglé ({v0}) ; l'échéance du {v1} est conservée.",
              { v0: fcfa(periode?.montant_paye), v1: date(periode?.fin) })
          : a.offre === "premium"
            ? t("Renouvellement : la nouvelle période de 12 mois commence à l'échéance actuelle, sans perdre de jours. Vous pouvez conserver, augmenter ou diminuer la capacité.")
            : t("L'abonnement est actif dès la confirmation du paiement, pour 12 mois.")}</p>
      {sousEffectif && <p className="small text-warning-emphasis mt-2 mb-0">{t("Attention : {v0} élèves sont déjà inscrits cette année. Avec une capacité inférieure, aucune nouvelle inscription ne sera possible.", { v0: a.eleves_actifs })}</p>}
      <p className="small text-muted mt-2 mb-0">{t("Paiement sécurisé par SasPay (mobile money ou carte) : vous êtes redirigé vers sa page de paiement, puis ramené ici. Un reçu est envoyé par e-mail à chaque paiement.")}</p>
    </div></div>
  )
}

export default function Abonnement() {
  const { recharger } = useSession()
  const [a, erreur, relire] = useDonnees(() => rpc("mon_abonnement"), [])
  const [msg, setMsg] = useRetourPaiement(a?.paiements?.some((p) => p.statut === "en_attente"), () => { relire(); recharger() })

  if (erreur) return <Alerte>{erreur}</Alerte>
  if (!a) return <Chargement />
  const telechargerRecu = async (id) => {
    setMsg({})
    try { await recuPdf(await rpc("recu_paiement", { p_id: id })) } catch (e) { setMsg({ erreur: e.message }) }
  }

  return (
    <div className="container-fluid px-0" style={{ maxWidth: 980 }}>
      <h1 className="h3 mb-3">{t("Mon abonnement")}</h1>
      <Alerte type="success" onFermer={() => setMsg({})}>{msg.ok}</Alerte>
      <Alerte type="info">{msg.info}</Alerte>
      <Alerte onFermer={() => setMsg({})}>{msg.erreur}</Alerte>
      <Etat a={a} />
      <Commande key={`${a.offre}-${a.capacite}-${a.renouvelable}`} a={a} setMsg={setMsg} relire={relire} recharger={recharger} />

      <h2 className="h5">{t("Historique de l'abonnement")}</h2>
      {!a.historique?.length ? <p className="text-muted">{t("Aucun mouvement pour le moment.")}</p> : (
        <div className="table-responsive mb-4"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Date")}</th><th>{t("Opération")}</th><th className="text-end">{t("Capacité")}</th><th className="text-end">{t("Montant")}</th><th>{t("Valable jusqu'au")}</th></tr></thead>
          <tbody>{a.historique.map((h, i) => (
            <tr key={i}><td>{dateHeure(h.le)}</td><td>{t(TYPES[h.type] || h.type)}</td>
              <td className="text-end">{h.capacite_avant != null && h.capacite_apres != null && h.capacite_avant !== h.capacite_apres ? `${h.capacite_avant} → ${h.capacite_apres}` : (h.capacite_apres ?? "—")}</td>
              <td className="text-end">{h.montant != null ? fcfa(h.montant) : "—"}</td><td>{h.fin ? date(h.fin) : "—"}</td></tr>))}</tbody>
        </table></div>)}

      <h2 className="h5">{t("Historique des paiements")}</h2>
      {!a.paiements.length ? <p className="text-muted">{t("Aucun paiement pour le moment.")}</p> : (
        <div className="table-responsive"><table className="table table-sm align-middle">
          <thead><tr><th>{t("Date")}</th><th>{t("Objet")}</th><th className="text-end">{t("Montant")}</th><th>{t("Statut")}</th><th>{t("Valable jusqu'au")}</th><th>{t("Reçu")}</th></tr></thead>
          <tbody>{a.paiements.map((p) => {
            const [lib, coul] = STATUTS[p.statut] || [p.statut, "secondary"]
            const objet = p.libelle || `${t(NOMS_OFFRES[p.offre] || p.offre)} (${t(p.periode === "annuel" ? "1 an" : "1 mois")})`
            return <tr key={p.id}><td>{dateHeure(p.cree_le)}</td><td>{objet}</td>
              <td className="text-end">{fcfa(p.montant)}</td><td><span className={`badge text-bg-${coul}`}>{t(lib)}</span></td><td>{p.fin ? date(p.fin) : "—"}</td>
              <td>{p.numero_recu ? <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => telechargerRecu(p.id)}
                aria-label={t("Télécharger le reçu {v0}", { v0: p.numero_recu })}>{t("Télécharger")}</button> : "—"}</td></tr>
          })}</tbody>
        </table></div>)}
    </div>
  )
}
