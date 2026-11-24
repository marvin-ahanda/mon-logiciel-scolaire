// Vue d'ensemble : recettes, dépenses, trésorerie, créances et points de vigilance sur une période (calculés par le serveur).
import { useState } from "react"
import { Link } from "react-router-dom"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour, modePaiement } from "../../lib/financePdf.js"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, Barres, Courbe, debutMois, EnTete, Indicateur, Periode, useDroits } from "./commun.jsx"

const TYPES_COMPTE = { caisse: "Caisse", banque: "Banque", mtn_momo: "MTN MoMo", orange_money: "Orange Money", autre: "Autre" }

export default function VueEnsemble() {
  const [periode, setPeriode] = useState({ debut: debutMois(), fin: aujourdhui() })
  const [d, erreur] = useDonnees(() => rpc("finance_tableau_bord", { p_debut: periode.debut, p_fin: periode.fin }), [periode.debut, periode.fin])
  const droits = useDroits()
  if (!d) return <><EnTete titre={t("Vue d'ensemble financière")} /><Alerte>{erreur}</Alerte>{!erreur && <Chargement />}</>
  const enc = d.encaissements, dep = d.depenses, cr = d.creances
  const solde = enc.total - dep.total                                 // dep.total inclut les salaires si la personne a le droit « paie »
  const tresorerie = d.tresorerie.reduce((s, c) => s + Number(c.solde || 0), 0)
  const vigilance = [
    cr.eleves_en_retard > 0 && [t("{v0} élève(s) non en règle : {v1} en retard", { v0: cr.eleves_en_retard, v1: fcfa(cr.pension_retard + cr.autres_retard) }), "/finance/insolvables"],
    d.attentes > 0 && [t("{v0} paiement(s) en attente de confirmation (non comptés)", { v0: d.attentes }), "/finance/encaissements?vue=attentes"],
    dep.en_attente > 0 && [t("{v0} dépense(s) en attente de validation", { v0: dep.en_attente }), "/finance/depenses?statut=en_attente"],
    dep.a_payer > 0 && [t("{v0} dépense(s) approuvée(s) à payer", { v0: dep.a_payer }), "/finance/depenses?statut=approuvee"],
    ...d.ecarts_caisse.map((e) => [t("Écart de caisse de {v0} le {v1} ({v2})", { v0: fcfa(e.ecart), v1: jour(e.date), v2: e.compte }), "/finance/tresorerie"]),
    ...d.tresorerie.filter((c) => c.solde < 0).map((c) => [t("Solde négatif sur « {v0} » : {v1}", { v0: c.libelle, v1: fcfa(c.solde) }), "/finance/tresorerie"]),
    !d.tresorerie.length && [t("Aucun compte de trésorerie : créez la caisse et les comptes pour suivre les soldes."), "/finance/tresorerie"],
  ].filter(Boolean)
  return (
    <>
      <EnTete titre={t("Vue d'ensemble financière")} sousTitre={t("Montants calculés à partir des écritures enregistrées · paiements en attente exclus")}>
        <Periode valeur={periode} onChange={setPeriode} />
      </EnTete>
      <div className="grille-indicateurs mb-3">
        <Indicateur grand libelle={t("Encaissé sur la période")} valeur={fcfa(enc.total)} ton="succes"
          detail={t("{v0} reçu(s) · {v1} annulation(s)", { v0: enc.recus, v1: enc.annulations })} />
        <Indicateur grand libelle={t("Dépenses payées")} valeur={fcfa(dep.total)} ton="alerte"
          detail={dep.salaires != null ? t("dont salaires : {v0}", { v0: fcfa(dep.salaires) }) : t("hors salaires (droit paie requis)")} />
        <Indicateur grand libelle={t("Solde de la période")} valeur={fcfa(solde)} ton={solde >= 0 ? "succes" : "danger"} detail={t("encaissements − dépenses payées")} />
        <Indicateur grand libelle={t("Trésorerie disponible")} valeur={d.tresorerie.length ? fcfa(tresorerie) : "—"} detail={t("{v0} compte(s) actif(s), au {v1}", { v0: d.tresorerie.length, v1: jour(d.aujourdhui) })} />
      </div>
      <div className="grille-indicateurs petits mb-4">
        <Indicateur libelle={t("Reste à recouvrer (année)")} valeur={fcfa(cr.pension_reste + cr.autres_reste)} detail={t("pension {v0} · autres frais {v1}", { v0: fcfa(cr.pension_reste), v1: fcfa(cr.autres_reste) })} />
        <Indicateur libelle={t("Montant en retard")} valeur={fcfa(cr.pension_retard + cr.autres_retard)} ton={cr.pension_retard + cr.autres_retard > 0 ? "danger" : "neutre"} detail={t("{v0} élève(s) concerné(s)", { v0: cr.eleves_en_retard })} />
        <Indicateur libelle={t("Taux de recouvrement")} valeur={cr.taux_recouvrement != null ? `${String(cr.taux_recouvrement).replace(".", ",")} %` : "—"} detail={t("payé / dû sur l'année en cours")} />
        <Indicateur libelle={t("Dettes antérieures")} valeur={fcfa(cr.dettes_anterieures)} detail={t("créances des années précédentes")} />
        {d.masse_salariale && <Indicateur libelle={t("Masse salariale")} valeur={fcfa(d.masse_salariale.net)} detail={t("net · {v0} bulletin(s) validé(s)", { v0: d.masse_salariale.bulletins })} />}
      </div>
      <div className="row g-3">
        <div className="col-lg-8"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Encaissements et dépenses jour par jour")}</h2>
          <Courbe debut={periode.debut} fin={periode.fin} series={[
            { nom: t("Encaissements"), couleur: "var(--fin-entree)", points: enc.par_jour },
            { nom: t("Dépenses payées"), couleur: "var(--fin-sortie)", points: dep.par_jour }]} />
        </div></section></div>
        <div className="col-lg-4"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Points de vigilance")}</h2>
          {vigilance.length ? <ul className="list-unstyled vigilance mb-0">{vigilance.map(([texte, lien]) => <li key={texte}><Link to={lien}>{texte}</Link></li>)}</ul>
            : <p className="text-muted small mb-0">{t("Rien à signaler sur la période.")}</p>}
        </div></section></div>
        <div className="col-md-6 col-xl-4"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Encaissements par mode de paiement")}</h2>
          <Barres donnees={enc.par_mode.map((m) => ({ libelle: modePaiement(m.mode), montant: m.montant }))} />
        </div></section></div>
        <div className="col-md-6 col-xl-4"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Encaissements par rubrique")}</h2>
          <Barres donnees={enc.par_rubrique.map((m) => ({ libelle: t(m.rubrique), montant: m.montant }))} />
        </div></section></div>
        <div className="col-md-6 col-xl-4"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Dépenses par catégorie")}</h2>
          <Barres donnees={dep.par_categorie.map((m) => ({ libelle: m.categorie, montant: m.montant }))} />
        </div></section></div>
        <div className="col-md-6"><section className="card h-100"><div className="card-body">
          <h2 className="h6">{t("Soldes de trésorerie")}</h2>
          {d.tresorerie.length ? <table className="table table-sm mb-0"><tbody>{d.tresorerie.map((c) => (
            <tr key={c.id}><td>{c.libelle} <span className="text-muted small">{t(TYPES_COMPTE[c.type])}</span></td>
              <td className={`text-end fw-semibold${c.solde < 0 ? " text-danger" : ""}`}>{fcfa(c.solde)}</td></tr>))}</tbody></table>
            : <p className="text-muted small mb-0">{t("Aucun compte de trésorerie configuré.")}{droits.a("tresorerie") && <> <Link to="/finance/tresorerie">{t("Créer un compte")}</Link></>}</p>}
        </div></section></div>
      </div>
    </>
  )
}
