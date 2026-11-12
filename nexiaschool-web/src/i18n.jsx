// Bilinguisme français / anglais. Le texte français sert de clé : t("Élèves") -> « Students » en anglais.
// La langue choisie (sur la page d'accueil ou dans l'application) est mémorisée sur l'appareil et s'applique partout.
import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react"

const CLE = "nexiaschool.langue"
export const LANGUES = [["fr", "Français", "FR"], ["en", "English", "EN"]]

function langueInitiale() {
  try { const l = localStorage.getItem(CLE); if (l === "fr" || l === "en") return l } catch { /* stockage indisponible */ }
  const n = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || []
  for (const x of n) { const c = String(x).slice(0, 2).toLowerCase(); if (c === "fr" || c === "en") return c }
  return "fr"
}

let langue = langueInitiale()
// Dictionnaire anglais chargé à la demande : les utilisateurs francophones ne le téléchargent pas (connexions lentes)
let EN = {}
let chargement = null
export function chargerAnglais() {
  chargement ||= import("./i18n-en.js").then((m) => { EN = m.EN }).catch((e) => { chargement = null; throw e })
  return chargement
}
/** À appeler avant le premier affichage : charge le dictionnaire si l'anglais est la langue choisie. */
export const preparerLangue = () => (langue === "en" ? chargerAnglais().catch(() => { langue = "fr" }) : Promise.resolve())
export const langueCourante = () => langue
/** Locale pour Intl : dates, nombres. */
export const locale = () => (langue === "en" ? "en-GB" : "fr-FR")

/**
 * Traduction. Les espaces de début et de fin sont conservés (morceaux de phrases en JSX).
 * vars : { nom: valeur } remplace {nom} dans le texte.
 */
export function t(fr, vars) {
  let s = String(fr ?? "")
  if (langue === "en") {
    const debut = s.match(/^\s*/)[0], fin = s.match(/\s*$/)[0], coeur = s.trim()
    if (coeur && EN[coeur] !== undefined) s = debut + EN[coeur] + fin
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])))
  return s
}

/** Message d'erreur venant de la base (en français) : traduit s'il est connu (texte exact ou modèle). */
export function traduireErreur(m) {
  if (langue !== "en" || !m) return m
  if (EN[m] !== undefined) return EN[m]
  for (const [motif, remplacement] of EN.__modeles || []) if (motif.test(m)) return m.replace(motif, remplacement)
  return m
}

const Contexte = createContext({ langue, setLangue: () => {} })

export function LangueProvider({ children }) {
  const [courante, setCourante] = useState(langue)
  const setLangue = useCallback(async (l) => {
    if (l !== "fr" && l !== "en") return
    if (l === "en") { try { await chargerAnglais() } catch { return } }      // hors ligne et jamais chargé : on reste en français
    langue = l
    try { localStorage.setItem(CLE, l) } catch { /* stockage indisponible */ }
    setCourante(l)
  }, [])
  useEffect(() => { document.documentElement.lang = courante }, [courante])
  // la clé remonte l'arbre : tous les textes sont recalculés dans la nouvelle langue
  return <Contexte.Provider value={{ langue: courante, setLangue }}><Fragment key={courante}>{children}</Fragment></Contexte.Provider>
}

export const useLangue = () => useContext(Contexte)

/** Sélecteur de langue (FR / EN). variante : "clair" (fond clair) ou "sombre" (barre bleue de l'application). */
export function ChoixLangue({ variante = "clair", className = "" }) {
  const { langue: l, setLangue } = useLangue()
  return (
    <div className={`choix-langue choix-langue-${variante} ${className}`} role="group" aria-label={l === "en" ? "Language" : "Langue"}>
      {LANGUES.map(([code, nom, court]) => (
        <button key={code} type="button" lang={code} className={l === code ? "actif" : ""} aria-pressed={l === code}
                title={nom} onClick={() => setLangue(code)}>{court}</button>))}
    </div>
  )
}
