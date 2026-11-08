import { locale, t } from "../i18n.jsx"
const formats = {}
const nombre = () => (formats[locale()] ||= new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const note = (v) => (v === null || v === undefined ? "" : nombre().format(v))
const pourcents = {}
/** Pourcentage à une décimale au plus : « 66,7 % ». */
export const pourcentage = (v) => (v === null || v === undefined ? "—" : `${(pourcents[locale()] ||= new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 })).format(v)} %`)
export const date = (v) => (v ? new Date(v).toLocaleDateString(locale()) : "—")
export const dateHeure = (v) => (v ? new Date(v).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "—")
export const nomComplet = (p) => [p?.nom?.toUpperCase(), p?.prenom].filter(Boolean).join(" ")
export const comparerNoms = new Intl.Collator("fr", { sensitivity: "base" }).compare

/** « 12,5 » -> 12.5 ; « » -> null ; valeur invalide -> exception avec message. */
export function lireNote(brut) {
  const x = String(brut ?? "").trim().replace(",", ".")
  if (x === "") return null
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(x)) throw new Error(t("« {v0} » n'est pas une note valide (deux décimales au plus)", {
    v0: brut
  }))
  const v = Number(x)
  if (v < 0 || v > 20) throw new Error(t("{v0} n'est pas compris entre 0 et 20", {
    v0: brut
  }))
  return v
}

export function exerciceParDefaut(aujourdhui = new Date()) {
  const a = aujourdhui.getFullYear(), debut = aujourdhui.getMonth() >= 7 ? a : a - 1   // l'année scolaire commence en septembre
  return `${debut}-${debut + 1}`
}
