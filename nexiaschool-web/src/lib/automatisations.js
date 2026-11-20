// Automatisations personnelles (catalogue guidé) : une demande écrite en langage naturel (« Chaque vendredi à 16 h, prépare un
// rapport des absences de la semaine et envoie-le au directeur ») est traduite, sans IA externe, en une règle structurée tirée
// d'un catalogue d'actions sûres. La règle est montrée et modifiable avant d'être enregistrée ; la base la revérifie
// (migration 0049_automatisations.sql) et l'exécute côté serveur.

/** Catalogue : actions possibles et rôles autorisés (même règle que la base). */
export const ACTIONS = {
  rapport_absences: { libelle: "Rapport des absences et retards", roles: ["admin", "surveillant", "enseignant"] },
  rapport_saisie: { libelle: "Rapport des notes non saisies", roles: ["admin", "enseignant"] },
  rapport_discipline: { libelle: "Rapport des incidents de discipline", roles: ["admin", "surveillant"] },
  rapport_paiements: { libelle: "Rapport des paiements encaissés", roles: ["admin", "comptable"] },
  rapport_impayes: { libelle: "Rapport des élèves non en règle (frais)", roles: ["admin", "comptable"] },
  rappel: { libelle: "Rappel personnel", roles: ["admin", "surveillant", "enseignant", "comptable"] },
}
// Rapport envoyé avant midi : la période se termine la veille (journée écoulée) ; à partir de midi, aujourd'hui compris.
export const PERIODES = { jour: "La journée (la veille si le rapport part le matin)", semaine: "Les 7 derniers jours", mois: "Les 30 derniers jours" }
export const DESTINATAIRES = { moi: "Moi-même", direction: "La direction (administration)" }
export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

const sansAccents = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ")
const JOURS_RE = [
  [1, /\b(lundis?|mondays?)\b/], [2, /\b(mardis?|tuesdays?)\b/], [3, /\b(mercredis?|wednesdays?)\b/], [4, /\b(jeudis?|thursdays?)\b/],
  [5, /\b(vendredis?|fridays?)\b/], [6, /\b(samedis?|saturdays?)\b/], [7, /\b(dimanches?|sundays?)\b/],
]

/** Heure « 16 h », « 16h30 », « 7:45 », « midi », « 4 pm » → « HH:MM » (null si absente). */
export function lireHeure(t) {
  if (/\bmidi\b|\bnoon\b/.test(t)) return "12:00"
  if (/\bminuit\b|\bmidnight\b/.test(t)) return "00:00"
  let m = t.match(/\b(\d{1,2})\s*(?:h|heures?|:)\s*(\d{2})?\b/)
  if (m) { const h = Number(m[1]), mn = Number(m[2] || 0); if (h < 24 && mn < 60) return `${String(h).padStart(2, "0")}:${String(mn).padStart(2, "0")}` }
  m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (m) { let h = Number(m[1]) % 12; if (m[3] === "pm") h += 12; return `${String(h).padStart(2, "0")}:${String(Number(m[2] || 0)).padStart(2, "0")}` }
  return null
}

/** Fréquence : { type: quotidien | hebdo | mensuel, jours: [1..7], jour_mois, heure }. */
export function lireFrequence(t) {
  const heure = lireHeure(t) || "07:00"
  const m = t.match(/\ble\s+(\d{1,2})(?:er|e)?\s+(?:de\s+)?(?:chaque|du|of each|of the)\s+mois\b|\b(?:on the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:each|every|the)\s+month\b/)
  if (m) return { type: "mensuel", jours: [], jour_mois: Math.min(31, Math.max(1, Number(m[1] || m[2]))), heure }
  if (/\bchaque mois\b|\btous les mois\b|\bmensuel|\bmonthly\b|\bevery month\b/.test(t)) return { type: "mensuel", jours: [], jour_mois: 1, heure }
  if (/\bdu lundi au vendredi\b|\ben semaine\b|\bjours? ouvrables?\b|\bweekdays?\b/.test(t)) return { type: "hebdo", jours: [1, 2, 3, 4, 5], jour_mois: null, heure }
  const jours = JOURS_RE.filter(([, re]) => re.test(t)).map(([n]) => n)
  if (jours.length) return { type: "hebdo", jours, jour_mois: null, heure }
  if (/\bchaque semaine\b|\btoutes les semaines\b|\bhebdomadaire|\bweekly\b|\bevery week\b/.test(t)) return { type: "hebdo", jours: [1], jour_mois: null, heure }
  return { type: "quotidien", jours: [1, 2, 3, 4, 5, 6, 7], jour_mois: null, heure }
}

/** Action du catalogue reconnue dans le texte, et texte du rappel le cas échéant. */
export function lireAction(t, brut = "") {
  if (/\babsence|\babsent|\bretards? (?:des|d)\s*eleves|\bassiduit|\battendance\b/.test(t)) return { action: "rapport_absences" }
  if (/\bnotes? (?:non|pas) (?:encore )?saisies?|\bnotes? manquantes?|\bretards? de saisie|\bsaisie des notes|\bmissing (?:marks|grades)\b/.test(t)) return { action: "rapport_saisie" }
  if (/\bimpaye|\binsolvab|\bnon en regle|\bpensions? (?:non|impay)|\bunpaid\b|\bdebts?\b/.test(t)) return { action: "rapport_impayes" }
  if (/\bpaiements?|\bencaissements?|\bcaisse\b|\bversements?|\bpayments?\b/.test(t)) return { action: "rapport_paiements" }
  if (/\bdisciplin|\bincidents?|\bsanctions?|\binfractions?\b/.test(t)) return { action: "rapport_discipline" }
  if (/\brappelle[- ]?moi|\brappel\b|\bremind me\b|\breminder\b/.test(t)) {
    const m = String(brut).match(/(?:rappelle[- ]?moi|remind me)\s*(?:de|d'|d’|to)?\s*(.+)$/i)
    return { action: "rappel", texte: (m ? m[1] : brut).trim().replace(/[.!]+$/, "").slice(0, 300) }
  }
  return { action: null }
}

/** Période couverte par le rapport (par défaut selon la fréquence). */
export function lirePeriode(t, frequence) {
  if (/\b(du jour|d aujourd hui|de la journee|today|daily)\b/.test(t)) return "jour"
  if (/\b(du mois|mensuel|of the month|monthly)\b/.test(t)) return "mois"
  if (/\b(de la semaine|hebdomadaire|of the week|weekly)\b/.test(t)) return "semaine"
  return frequence.type === "mensuel" ? "mois" : frequence.type === "hebdo" ? "semaine" : "jour"
}

/** Seuil d'heures d'absence non justifiées (« plus de 10 h », « au moins 8 heures », « more than 5 hours ») ; null si absent. */
export function lireSeuilHeures(t) {
  const m = t.match(/\b(?:plus de|au moins|au-dela de|au dela de|depassant|superieur(?:e|es|s)? a|more than|at least|over)\s*(\d{1,3})\s*(?:h\b|heures?\b|hours?\b)/)
    || t.match(/(?:>=?|≥)\s*(\d{1,3})\s*(?:h\b|heures?\b)/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 500 ? n : null
}

/** Destinataire : la direction (directeur, proviseur, principal, administration) ou soi-même. */
export function lireDestinataire(t) {
  return /\b(directeur|directrice|direction|proviseur|principal|principale|administration|chef d etablissement|censeur|head ?teacher|principal|management)\b/.test(t) ? "direction" : "moi"
}

/**
 * Traduit une demande en règle. Renvoie { action, parametres: { periode, texte? }, frequence, destinataire, manquants: [..],
 * remarques: [..] }. « manquants » liste ce qu'il faut préciser (action non reconnue, action interdite au rôle).
 */
export function interpreter(texte, role = "admin") {
  const t = sansAccents(texte)
  const frequence = lireFrequence(t)
  const { action, texte: rappel } = lireAction(t, texte)
  const manquants = [], remarques = []
  if (!action) manquants.push("action")
  else if (!ACTIONS[action].roles.includes(role)) manquants.push("droit")
  if (!lireHeure(t)) remarques.push("heure_defaut")
  const destinataire = action === "rappel" ? "moi" : lireDestinataire(t)
  // l'heure du rapport (« à 16 h ») n'est pas un seuil : on ne cherche le seuil que dans les expressions « plus de N h », « au moins N h »…
  const seuil = action === "rapport_absences" ? lireSeuilHeures(t) : null
  return {
    action, frequence, destinataire, manquants, remarques,
    parametres: action === "rappel" ? { texte: rappel || "" } : { periode: lirePeriode(t, frequence), ...(seuil ? { seuil_heures: seuil } : {}) },
  }
}

/** Phrase de résumé de la règle (pour la confirmation), traduite par la fonction t fournie. */
export function resumer(r, t = (x, v) => x.replace(/\{(\w+)\}/g, (_, k) => v?.[k] ?? "")) {
  const f = r.frequence
  const quand = f.type === "mensuel" ? t("Le {v0} de chaque mois à {v1}", { v0: f.jour_mois, v1: f.heure })
    : f.type === "hebdo" ? (f.jours.length === 5 && f.jours.every((j, k) => j === k + 1) ? t("Du lundi au vendredi à {v0}", { v0: f.heure })
      : t("Chaque {v0} à {v1}", { v0: f.jours.map((j) => t(JOURS[j - 1])).join(", "), v1: f.heure }))
      : t("Chaque jour à {v0}", { v0: f.heure })
  const quoi = r.action === "rappel" ? t("rappel : « {v0} »", { v0: r.parametres.texte })
    : `${t(ACTIONS[r.action]?.libelle || "")} — ${t(PERIODES[r.parametres.periode] || "").toLowerCase()}`
      + (r.parametres.seuil_heures ? ` (${t("élèves ayant au moins {v0} h non justifiée(s)", { v0: r.parametres.seuil_heures })})` : "")
  return `${quand} : ${quoi}, ${t("envoyé à")} ${t(DESTINATAIRES[r.destinataire]).toLowerCase()}.`
}
