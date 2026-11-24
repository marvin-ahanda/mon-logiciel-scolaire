// Rapports financiers : calculés par le serveur (finance_rapport), affichés, exportés en Excel et en PDF.
import { useState } from "react"
import { Alerte, Chargement, useDonnees } from "../../composants/Communs.jsx"
import { fcfa, jour, modePaiement } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { rpc } from "../../supabase.js"
import { t } from "../../i18n.jsx"
import { aujourdhui, BoutonsExport, EnTete, exporterTableau, Periode, useDroits } from "./commun.jsx"

export const RAPPORTS = [
  ["journal_encaissements", "Journal des encaissements"], ["encaissements_mode", "Encaissements par mode de paiement"], ["encaissements_classe", "Encaissements par classe"],
  ["impayes", "Impayés par élève"], ["remises", "Remises, exonérations et bourses"], ["annulations", "Annulations d'encaissements"], ["factures", "Factures émises"],
  ["depenses_categorie", "Dépenses par catégorie"], ["depenses_fournisseur", "Dépenses par fournisseur"], ["journal_tresorerie", "Journal de trésorerie"],
  ["clotures", "Clôtures de caisse"], ["rapprochement", "État du rapprochement bancaire"], ["synthese_mensuelle", "Synthèse mensuelle recettes / dépenses"],
  ["masse_salariale", "Masse salariale", "paie"],
]

function cellule(c, v) {
  if (v === null || v === undefined || v === "") return ""
  if (c.type === "montant") return fcfa(v)
  if (c.type === "date") return jour(v)
  if (c.type === "mode") return modePaiement(v)
  return String(v)
}

export default function Rapports() {
  const session = useSession(), droits = useDroits()
  const [type, setType] = useState("journal_encaissements")
  const [periode, setPeriode] = useState({ debut: `${aujourdhui().slice(0, 8)}01`, fin: aujourdhui() })
  const [d, erreur] = useDonnees(() => rpc("finance_rapport", { p_type: type, p_debut: periode.debut, p_fin: periode.fin, p_compte: null }), [type, periode.debut, periode.fin])
  const disponibles = RAPPORTS.filter(([, , droit]) => !droit || droits.a(droit))
  const colonnes = (d?.colonnes || []).map((c) => ({ ...c, libelle: t(c.libelle) }))
  return (
    <>
      <EnTete titre={t("Rapports financiers")} sousTitre={t("Calculés à partir des écritures enregistrées ; ces rapports sont des outils de gestion, pas des états comptables certifiés.")} />
      <div className="row g-3">
        <div className="col-lg-3">
          <nav className="list-group small" aria-label={t("Rapports")}>{disponibles.map(([k, lib]) => (
            <button key={k} type="button" className={`list-group-item list-group-item-action${type === k ? " active" : ""}`} onClick={() => setType(k)}>{t(lib)}</button>))}</nav>
        </div>
        <div className="col-lg-9">
          <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-2">
            <Periode valeur={periode} onChange={setPeriode} />
            {d && <BoutonsExport onExporter={(format) => exporterTableau({ format, titre: t(d.titre), sousTitre: `${jour(d.debut)} → ${jour(d.fin)}`, colonnes, lignes: d.lignes,
              totaux: d.totaux, etablissement: session.etablissement, logoUrl: session.logoUrl })} />}
          </div>
          <Alerte>{erreur}</Alerte>
          {!d && !erreur && <Chargement />}
          {d && <section className="card"><div className="card-body">
            <h2 className="h5">{t(d.titre)}</h2>
            <div className="small text-muted mb-2">{t("Du {v0} au {v1} · généré le {v2}", { v0: jour(d.debut), v1: jour(d.fin), v2: new Date(d.genere_le).toLocaleString() })}</div>
            <div className="table-responsive"><table className="table table-sm align-middle mb-0">
              <thead><tr>{colonnes.map((c) => <th key={c.cle} className={["montant", "nombre"].includes(c.type) ? "text-end" : undefined}>{c.libelle}</th>)}</tr></thead>
              <tbody>{d.lignes.map((l, k) => <tr key={k}>{colonnes.map((c) => <td key={c.cle} className={["montant", "nombre"].includes(c.type) ? "text-end" : "small"}>{cellule(c, l[c.cle])}</td>)}</tr>)}
                {!d.lignes.length && <tr><td colSpan={colonnes.length} className="text-muted">{t("Aucune donnée sur la période.")}</td></tr>}</tbody>
              {d.totaux && Object.keys(d.totaux).length > 0 && <tfoot><tr>{colonnes.map((c, k) => (
                <th key={c.cle} className={["montant", "nombre"].includes(c.type) ? "text-end" : undefined}>{k === 0 ? t("Total") : d.totaux[c.cle] != null ? cellule(c, d.totaux[c.cle]) : ""}</th>))}</tr></tfoot>}
            </table></div>
          </div></section>}
        </div>
      </div>
    </>
  )
}
