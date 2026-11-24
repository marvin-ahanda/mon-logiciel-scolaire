// Éléments communs de la rubrique Finances : onglets selon les droits, période, indicateurs, graphiques simples,
// export des tableaux (Excel et PDF), fenêtre modale, saisie d'un motif.
import { useEffect, useState } from "react"
import { NavLink } from "react-router-dom"
import { telechargerClasseur } from "../../lib/excel.js"
import { fcfa, fichier, jour, listePdf, modePaiement } from "../../lib/financePdf.js"
import { useSession } from "../../Session.jsx"
import { t } from "../../i18n.jsx"

/** Prévient les autres écrans (bulle d'alerte, listes) qu'une écriture financière vient d'être faite. */
export const signalerMajFinance = () => window.dispatchEvent(new Event("finance:maj"))
export const aujourdhui = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const debutMois = () => `${aujourdhui().slice(0, 8)}01`
/** Clé d'idempotence d'un envoi (un double clic ou un renvoi réseau ne crée pas deux encaissements). */
export const nouvelleCle = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** Droits financiers de la personne connectée (l'interface s'y adapte ; le serveur les vérifie à chaque action). */
export function useDroits() {
  const { droitsFinance = [] } = useSession()
  const a = (code) => droitsFinance.includes(code)
  return { a, liste: droitsFinance, voirEncaissements: ["caisse", "facturation", "validation", "tresorerie", "rapports"].some(a) }
}

const ONGLETS = [
  ["/finance", "Vue d'ensemble", (d) => ["rapports", "validation", "tresorerie"].some(d.a), true],
  ["/finance/facturation", "Frais et facturation", (d) => d.a("facturation")],
  ["/finance/encaissements", "Encaissements et reçus", (d) => d.voirEncaissements],
  ["/finance/classes", "Situation par classe", (d) => d.voirEncaissements],
  ["/finance/insolvables", "Élèves non en règle", (d) => d.voirEncaissements],
  ["/finance/relances", "Relances et recouvrement", (d) => d.voirEncaissements],
  ["/finance/depenses", "Dépenses et fournisseurs", (d) => ["depenses", "validation", "tresorerie", "rapports"].some(d.a)],
  ["/finance/tresorerie", "Trésorerie et banques", (d) => ["tresorerie", "rapports", "validation"].some(d.a)],
  ["/finance/paie", "Paie du personnel", (d) => d.a("paie")],
  ["/finance/rapports", "Rapports financiers", (d) => ["rapports", "validation"].some(d.a)],
  ["/finance/assistant", "Assistant IA Finance", (d) => d.a("assistant")],
  ["/finance/parametres", "Paramètres financiers", (d, admin) => admin],
]

export function OngletsFinance() {
  const d = useDroits(), { estAdmin } = useSession()
  return (
    <nav className="onglets-finance no-print mb-3" aria-label={t("Menus de la rubrique Finances")}>
      {ONGLETS.filter(([, , voir]) => voir(d, estAdmin)).map(([to, lib, , fin]) => (
        <NavLink key={to} to={to} end={!!fin} className={({ isActive }) => "onglet-finance" + (isActive ? " actif" : "")}>{t(lib)}</NavLink>))}
    </nav>
  )
}

/** Premier menu accessible (page d'accueil de la rubrique selon les droits). */
export function premierOnglet(d, estAdmin) {
  return ONGLETS.find(([, , voir]) => voir(d, estAdmin))?.[0] || "/"
}

export function EnTete({ titre, sousTitre, children }) {
  return (
    <div className="d-flex flex-wrap justify-content-between align-items-end gap-2 mb-3">
      <div><h1 className="h3 m-0">{titre}</h1>{sousTitre && <div className="text-muted small">{sousTitre}</div>}</div>
      <div className="d-flex flex-wrap gap-2 no-print">{children}</div>
    </div>
  )
}

export function Periode({ valeur, onChange }) {
  const raccourcis = [
    ["Ce mois", debutMois(), aujourdhui()],
    ["30 derniers jours", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), aujourdhui()],
    ["Depuis le 1er janvier", `${aujourdhui().slice(0, 4)}-01-01`, aujourdhui()],
  ]
  return (
    <div className="d-flex flex-wrap align-items-end gap-2">
      <div><label className="form-label small mb-0" htmlFor="per-debut">{t("Du")}</label>
        <input id="per-debut" type="date" className="form-control form-control-sm" value={valeur.debut} max={valeur.fin} onChange={(e) => onChange({ ...valeur, debut: e.target.value })} /></div>
      <div><label className="form-label small mb-0" htmlFor="per-fin">{t("Au")}</label>
        <input id="per-fin" type="date" className="form-control form-control-sm" value={valeur.fin} min={valeur.debut} onChange={(e) => onChange({ ...valeur, fin: e.target.value })} /></div>
      <div className="btn-group btn-group-sm" role="group" aria-label={t("Périodes rapides")}>
        {raccourcis.map(([lib, d, f]) => <button key={lib} type="button" className={"btn btn-outline-secondary" + (valeur.debut === d && valeur.fin === f ? " active" : "")}
          onClick={() => onChange({ debut: d, fin: f })}>{t(lib)}</button>)}
      </div>
    </div>
  )
}

/** Indicateur chiffré (ton : neutre, succes, alerte, danger). */
export function Indicateur({ libelle, valeur, detail, ton = "neutre", grand }) {
  return (
    <div className={`indicateur-finance ton-${ton}${grand ? " grand" : ""}`}>
      <div className="libelle">{libelle}</div>
      <div className="valeur">{valeur}</div>
      {detail && <div className="detail">{detail}</div>}
    </div>
  )
}

/** Barres horizontales (répartitions). donnees : [{ libelle, montant }] */
export function Barres({ donnees, vide = "Aucune donnée sur la période." }) {
  const max = Math.max(1, ...donnees.map((d) => Math.abs(Number(d.montant) || 0)))
  if (!donnees.length) return <p className="text-muted small mb-0">{t(vide)}</p>
  return (
    <ul className="barres-finance list-unstyled mb-0">
      {donnees.map((d) => (
        <li key={d.libelle}>
          <div className="d-flex justify-content-between small"><span>{d.libelle}</span><span className="fw-semibold">{fcfa(d.montant)}</span></div>
          <div className="piste" aria-hidden="true"><div className="barre" style={{ transform: `scaleX(${Math.abs(Number(d.montant) || 0) / max})` }} /></div>
        </li>))}
    </ul>
  )
}

/** Courbe jour par jour (entrées et sorties) en SVG, sans bibliothèque. series : [{ nom, couleur, points: [{ date, montant }] }] */
export function Courbe({ series, debut, fin }) {
  const jours = []
  for (let d = new Date(`${debut}T00:00:00Z`); d <= new Date(`${fin}T00:00:00Z`) && jours.length < 400; d = new Date(d.getTime() + 864e5)) jours.push(d.toISOString().slice(0, 10))
  const valeurs = series.map((s) => { const m = new Map(s.points.map((p) => [String(p.date).slice(0, 10), Number(p.montant)])); return jours.map((j) => m.get(j) || 0) })
  const max = Math.max(1, ...valeurs.flat())
  const L = 600, H = 160, pas = jours.length > 1 ? L / (jours.length - 1) : L
  if (!jours.length) return null
  return (
    <figure className="courbe-finance mb-0">
      <svg viewBox={`0 0 ${L} ${H + 4}`} role="img" aria-label={t("Évolution jour par jour")} preserveAspectRatio="none">
        <line x1="0" y1={H} x2={L} y2={H} className="axe" />
        {series.map((s, k) => <polyline key={s.nom} fill="none" stroke={s.couleur} strokeWidth="2.2" vectorEffect="non-scaling-stroke"
          points={valeurs[k].map((v, i) => `${i * pas},${H - (v / max) * (H - 8)}`).join(" ")} />)}
      </svg>
      <figcaption className="d-flex flex-wrap gap-3 small text-muted mt-1">
        {series.map((s) => <span key={s.nom}><span className="pastille" style={{ background: s.couleur }} /> {s.nom}</span>)}
        <span className="ms-auto">{jour(debut)} → {jour(fin)}</span>
      </figcaption>
    </figure>
  )
}

/** Exporte un tableau (colonnes [{ cle, libelle, type }]) en Excel ou en PDF. */
export async function exporterTableau({ format, titre, sousTitre, colonnes, lignes, totaux, etablissement, logoUrl }) {
  const valeur = (c, l, brut) => {
    const v = l[c.cle]
    if (v === null || v === undefined || v === "") return ""
    if (c.type === "montant") return brut ? Number(v) : fcfa(v)
    if (c.type === "date") return brut ? new Date(`${String(v).slice(0, 10)}T00:00:00`) : jour(v)
    if (c.type === "mode") return modePaiement(v)
    if (c.type === "nombre") return brut ? Number(v) : String(v)
    return String(v)
  }
  const nom = fichier(titre, sousTitre || "")
  if (format === "excel") {
    const pied = totaux ? [colonnes.map((c, k) => (k === 0 ? t("Total") : totaux[c.cle] ?? ""))] : []
    return telechargerClasseur([{ titre: titre.slice(0, 31), intitule: `${titre}${sousTitre ? ` — ${sousTitre}` : ""}`, entetes: colonnes.map((c) => c.libelle),
      lignes: [...lignes.map((l) => colonnes.map((c) => valeur(c, l, true))), ...pied] }], nom)
  }
  return listePdf({ etablissement, logoUrl, titre, sousTitre,
    colonnes: colonnes.map((c) => ({ titre: c.libelle, droite: ["montant", "nombre"].includes(c.type) })),
    lignes: lignes.map((l) => colonnes.map((c) => valeur(c, l, false))),
    pied: totaux ? colonnes.map((c, k) => (k === 0 ? t("Total") : totaux[c.cle] != null ? (c.type === "montant" ? fcfa(totaux[c.cle]) : String(totaux[c.cle])) : "")) : undefined,
    note: t("Document généré le {v0} par NexIA School.", { v0: new Date().toLocaleString() }) }, nom)
}

export function BoutonsExport({ onExporter }) {
  const [envoi, setEnvoi] = useState("")
  const lancer = async (format) => { setEnvoi(format); try { await onExporter(format) } catch (e) { alert(e.message) } finally { setEnvoi("") } }
  return (
    <div className="btn-group btn-group-sm">
      <button type="button" className="btn btn-outline-secondary" disabled={!!envoi} onClick={() => lancer("excel")}>{envoi === "excel" ? t("Préparation…") : t("Excel")}</button>
      <button type="button" className="btn btn-outline-secondary" disabled={!!envoi} onClick={() => lancer("pdf")}>{envoi === "pdf" ? t("Préparation…") : t("PDF")}</button>
    </div>
  )
}

export function Modale({ titre, onFermer, children, large, pied }) {
  useEffect(() => {
    const echap = (x) => x.key === "Escape" && onFermer()
    document.addEventListener("keydown", echap); return () => document.removeEventListener("keydown", echap)
  }, [onFermer])
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={titre} onClick={(x) => x.target === x.currentTarget && onFermer()}>
        <div className={`modal-dialog modal-dialog-scrollable${large ? " modal-xl" : " modal-lg"}`}><div className="modal-content">
          <div className="modal-header"><h2 className="modal-title h5">{titre}</h2><button type="button" className="btn-close" aria-label={t("Fermer")} onClick={onFermer} /></div>
          <div className="modal-body">{children}</div>
          {pied && <div className="modal-footer">{pied}</div>}
        </div></div>
      </div>
      <div className="modal-backdrop show" />
    </>
  )
}

/** Demande un motif (obligatoire, 3 caractères au moins). Renvoie null si l'utilisateur renonce. */
export function demanderMotif(question) {
  const m = window.prompt(question)
  if (m === null) return null
  if (m.trim().length < 3) { alert(t("Un motif d'au moins 3 caractères est obligatoire.")); return null }
  return m.trim()
}

export const STATUTS_DEPENSE = { brouillon: ["Brouillon", "secondary"], en_attente: ["En attente de validation", "warning"], approuvee: ["Approuvée", "info"],
  rejetee: ["Rejetée", "danger"], payee: ["Payée", "success"], annulee: ["Annulée", "dark"] }
export const STATUTS_PAIE = { brouillon: ["Brouillon", "secondary"], en_verification: ["En cours de vérification", "warning"], validee: ["Validée", "info"],
  payee: ["Payée", "success"], annulee: ["Annulée", "dark"] }
export function Statut({ table, valeur }) {
  const [lib, ton] = table[valeur] || [valeur, "secondary"]
  return <span className={`badge text-bg-${ton}`}>{t(lib)}</span>
}
