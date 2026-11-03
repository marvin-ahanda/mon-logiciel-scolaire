const nombre = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const note = (v) => (v === null || v === undefined ? "" : nombre.format(v))
export const date = (v) => (v ? new Date(v).toLocaleDateString("fr-FR") : "—")
export const dateHeure = (v) => (v ? new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—")
export const nomComplet = (p) => [p?.nom?.toUpperCase(), p?.prenom].filter(Boolean).join(" ")
export const comparerNoms = new Intl.Collator("fr", { sensitivity: "base" }).compare

/** « 12,5 » -> 12.5 ; « » -> null ; valeur invalide -> exception avec message. */
export function lireNote(brut) {
  const t = String(brut ?? "").trim().replace(",", ".")
  if (t === "") return null
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) throw new Error(`« ${brut} » n'est pas une note valide (deux décimales au plus)`)
  const v = Number(t)
  if (v < 0 || v > 20) throw new Error(`${brut} n'est pas compris entre 0 et 20`)
  return v
}

export function exerciceParDefaut(aujourdhui = new Date()) {
  const a = aujourdhui.getFullYear(), debut = aujourdhui.getMonth() >= 7 ? a : a - 1   // l'année scolaire commence en septembre
  return `${debut}-${debut + 1}`
}
