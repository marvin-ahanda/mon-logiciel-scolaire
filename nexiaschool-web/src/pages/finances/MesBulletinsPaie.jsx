// Mes bulletins de paie : chaque membre du personnel voit et télécharge uniquement ses propres bulletins validés ou payés.
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { bulletinPaiePdf } from "../../lib/financeDocs.js"
import { fcfa, jour } from "../../lib/financePdf.js"
import { nomComplet } from "../../lib/format.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"

export default function MesBulletinsPaie() {
  const { profil, etablissement, logoUrl } = useSession()
  const [d, erreur] = useDonnees(() => rpc("mes_bulletins_paie"), [])
  return (
    <>
      <h1 className="h3">{t("Mes bulletins de paie")}</h1>
      <p className="text-muted small">{t("Bulletins validés par l'établissement. Seul vous y avez accès depuis votre compte.")}</p>
      <Alerte>{erreur}</Alerte>
      {!d && !erreur && <Chargement />}
      {d && (d.length ? <div className="table-responsive"><table className="table table-sm align-middle">
        <thead><tr><th>{t("Période")}</th><th className="text-end">{t("Brut")}</th><th className="text-end">{t("Net")}</th><th>{t("Statut")}</th><th /></tr></thead>
        <tbody>{d.map((b) => (
          <tr key={b.id}><td>{new Date(`${b.periode}T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</td>
            <td className="text-end">{fcfa(b.brut)}</td><td className="text-end fw-semibold">{fcfa(b.net)}</td>
            <td>{b.statut === "payee" ? <span className="badge text-bg-success">{t("Payé le {v0}", { v0: jour(b.date_paiement) })}</span> : <span className="badge text-bg-info">{t("Validé")}</span>}</td>
            <td className="text-end"><button className="btn btn-sm btn-outline-secondary" onClick={() => bulletinPaiePdf({ etablissement, logoUrl,
              employe: { nom: nomComplet(profil), matricule: profil?.matricule, poste: profil?.poste }, paie: b })}>{t("Télécharger")}</button></td></tr>))}</tbody>
      </table></div> : <p className="text-muted">{t("Aucun bulletin de paie disponible.")}</p>)}
    </>
  )
}
