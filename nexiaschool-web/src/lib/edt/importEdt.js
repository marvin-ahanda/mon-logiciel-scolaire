// Import Excel des affectations des enseignants (étape 2) : lecture, regroupement des lignes d'un même enseignant,
// validation stricte ligne par ligne. Aucune donnée invalide n'est acceptée silencieusement : chaque ligne porte ses
// erreurs (bloquantes) et ses avertissements (signalés, non bloquants) ; la suite n'est possible que sans erreur.
// Module pur (sans navigateur) : testé directement par vitest.
import { hm, minutes, normaliserTexte, t } from "./modele.js"

/** Colonnes du fichier (en-têtes acceptés en français ou en anglais, dans n'importe quel ordre). */
export const COLONNES_EDT = {
  nom: ["Nom", "Noms", "Last name", "Surname", "Nom de l'enseignant"],
  prenom: ["Prénom(s)", "Prénoms", "Prénom", "Prenom", "Prenoms", "First name", "First names", "First name(s)"],
  matricule: ["Matricule", "Matricule (facultatif)", "Staff ID", "Staff ID (optional)", "ID"],
  discipline: ["Discipline", "Matière", "Matiere", "Subject"],
  classe: ["Classe", "Class"],
  volume: ["Volume horaire", "Volume horaire hebdomadaire", "Heures", "Heures par semaine", "Weekly hours", "Hours", "Hours per week"],
  jours: ["Jours disponibles", "Disponibilités", "Jours", "Available days", "Days"],
  creneaux: ["Créneaux disponibles", "Créneaux disponibles (facultatif)", "Créneaux", "Plages horaires", "Available times", "Time slots", "Available time slots", "Available time slots (optional)"],
}
export const OBLIGATOIRES_EDT = ["nom", "discipline", "classe", "volume", "jours"]
export const ENTETES_MODELE = ["Nom", "Prénom(s)", "Matricule (facultatif)", "Discipline", "Classe", "Volume horaire", "Jours disponibles", "Créneaux disponibles (facultatif)"]
export const LIGNES_MAX_EDT = 3000

const JOURS_TEXTE = {
  1: ["lundi", "lun", "lu", "l", "monday", "mon", "mo"], 2: ["mardi", "mar", "ma", "tuesday", "tue", "tu"],
  3: ["mercredi", "mer", "me", "wednesday", "wed", "we"], 4: ["jeudi", "jeu", "je", "j", "thursday", "thu", "th"],
  5: ["vendredi", "ven", "ve", "v", "friday", "fri", "fr"], 6: ["samedi", "sam", "sa", "s", "saturday", "sat"],
  7: ["dimanche", "dim", "di", "d", "sunday", "sun", "su"],
}
const JOUR_DE = new Map(Object.entries(JOURS_TEXTE).flatMap(([j, noms]) => noms.map((n) => [n, Number(j)])))
const TOUS = new Set(["tous", "touslesjours", "toutelasemaine", "semaine", "all", "alldays", "everyday"])

/** Repère la ligne d'en-têtes parmi les 6 premières et renvoie les lignes de données (valeurs brutes). */
export function lireLignes(data) {
  let meilleure = -1, positions = null, score = 0
  for (let h = 0; h < Math.min(6, data.length); h++) {
    const index = new Map((data[h] || []).map((e, k) => [normaliserTexte(e), k]))
    const pos = {}
    for (const [cle, noms] of Object.entries(COLONNES_EDT)) {
      const trouve = noms.map(normaliserTexte).find((n) => index.has(n))
      if (trouve !== undefined) pos[cle] = index.get(trouve)
    }
    if (Object.keys(pos).length > score) { score = Object.keys(pos).length; meilleure = h; positions = pos }
  }
  if (meilleure < 0) return { manquantes: OBLIGATOIRES_EDT, lignes: [] }
  const manquantes = OBLIGATOIRES_EDT.filter((k) => !(k in positions))
  const lignes = []
  data.slice(meilleure + 1).forEach((ligne, k) => {
    if (!ligne || ligne.every((v) => v === null || v === undefined || String(v).trim() === "")) return
    const valeurs = {}
    for (const cle of Object.keys(COLONNES_EDT)) valeurs[cle] = cle in positions ? texteCellule(ligne[positions[cle]]) : ""
    lignes.push({ numero: meilleure + k + 2, valeurs })
  })
  return { manquantes, lignes }
}

function texteCellule(v) {
  if (v === null || v === undefined) return ""
  if (v instanceof Date && !isNaN(v)) return hm(v.getUTCHours() * 60 + v.getUTCMinutes())
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v)
  return String(v).trim().replace(/^'(?=[=+\-@])/, "")
}

/** « Lundi, mardi ; jeudi », « lun-ven », « Tous » -> [1, 2, 4] ; lève une erreur lisible sinon. */
export function lireJours(v, joursOuvres) {
  const brut = String(v ?? "").trim()
  if (!brut) return []
  if (TOUS.has(normaliserTexte(brut))) return [...joursOuvres]
  const res = new Set()
  // « lun - ven », « lundi à vendredi » -> « lun~ven » ; puis découpage aux virgules, points-virgules, espaces, « et »
  const x = brut.toLowerCase().replace(/\s*[-–—]\s*/g, "~").replace(/\s+(?:à|a|au|to)\s+/g, "~")
  for (const morceau of x.split(/[,;/+\s]+/).filter((m) => m && m !== "et" && m !== "and")) {
    const plage = morceau.split("~").filter(Boolean)
    if (plage.length === 2) {
      const a = JOUR_DE.get(normaliserTexte(plage[0])), b = JOUR_DE.get(normaliserTexte(plage[1]))
      if (!a || !b || b < a) throw t("plage de jours « {v0} » non reconnue", { v0: morceau.replace("~", "-") })
      for (let j = a; j <= b; j++) res.add(j)
      continue
    }
    const n = normaliserTexte(morceau)
    const j = JOUR_DE.get(n) ?? (/^[1-7]$/.test(n) ? Number(n) : undefined)
    if (!j) throw t("jour « {v0} » non reconnu", { v0: morceau })
    res.add(j)
  }
  return [...res].sort()
}

/**
 * « 08:00-12:00 ; 14h-16h », « matin », « après-midi », « P1-P4 » -> [{ debut, fin }] ; lève une erreur lisible sinon.
 * Les plages sont exprimées en heures ; « matin » / « après-midi » se calculent avec la pause de midi.
 */
export function lireCreneaux(v, horaires) {
  const brut = String(v ?? "").trim()
  if (!brut) return []
  const midi = (horaires.pauses || []).find((p) => p.type === "midi" && !(p.jours || []).length)
  const debutJ = minutes(horaires.periodes?.[0]?.debut ?? horaires.debut), finJ = minutes(horaires.periodes?.at(-1)?.fin ?? horaires.fin)
  const res = []
  for (const morceau of brut.split(/[;,/]|\bet\b|\band\b/i).map((x) => x.trim()).filter(Boolean)) {
    const n = normaliserTexte(morceau)
    if (["matin", "lematin", "morning", "matinee"].includes(n)) { res.push({ debut: hm(debutJ), fin: hm(midi ? minutes(midi.debut) : 750) }); continue }
    if (["apresmidi", "lapresmidi", "aprem", "soir", "afternoon"].includes(n)) { res.push({ debut: hm(midi ? minutes(midi.fin) : 750), fin: hm(finJ) }); continue }
    if (["journee", "toutelajournee", "allday", "tous", "tout"].includes(n)) { res.push({ debut: hm(debutJ), fin: hm(finJ) }); continue }
    const per = morceau.match(/^p?\s*(\d{1,2})\s*(?:-|–|à|a|to)\s*p?\s*(\d{1,2})$/i)
    if (per && /^p/i.test(morceau.trim())) {
      const a = +per[1], b = +per[2], P = horaires.periodes?.length || 0
      if (a < 1 || b < a || b > P) throw t("périodes « {v0} » hors de la journée (1 à {v1})", { v0: morceau, v1: P })
      res.push({ debut: horaires.periodes[a - 1].debut, fin: horaires.periodes[b - 1].fin }); continue
    }
    const h = morceau.split(/\s*(?:-|–|à|a|to)\s*/i)
    const a = h.length === 2 ? minutes(h[0]) : null, b = h.length === 2 ? minutes(h[1]) : null
    if (a === null || b === null) throw t("créneau « {v0} » non reconnu (exemples : 08:00-12:00, matin, P1-P4)", { v0: morceau })
    if (b <= a) throw t("créneau « {v0} » : la fin doit suivre le début", { v0: morceau })
    res.push({ debut: hm(a), fin: hm(b) })
  }
  return res.sort((x, y) => minutes(x.debut) - minutes(y.debut))
}

/** Volume horaire : nombre entier d'heures de 1 à 40 (« 3 », « 3h », « 3 heures »). */
export function lireVolume(v) {
  const brut = String(v ?? "").trim()
  if (!brut) throw t("volume horaire manquant")
  const m = brut.replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(?:h|heures?|hours?|hrs?)?$/i)
  if (!m) throw t("volume horaire « {v0} » illisible (nombre d'heures attendu)", { v0: brut })
  const n = Number(m[1])
  if (!Number.isInteger(n)) throw t("volume horaire « {v0} » : nombre entier d'heures attendu", { v0: brut })
  if (n < 1 || n > 40) throw t("volume horaire « {v0} » : entre 1 et 40 heures par semaine", { v0: brut })
  return n
}

const cleNom = (nom, prenom) => normaliserTexte(`${nom} ${prenom}`)

/**
 * Validation complète. ctx : { classes: [{ id, libelle }], matieres: [{ id, code, libelle }], personnels: [{ id, nom, prenom, matricule }], horaires }
 * Renvoie { lignes (avec erreurs / avertissements), enseignants, affectations, nbErreurs, nbAvertissements, ok, recap }.
 */
export function validerImport(lignesBrutes, ctx) {
  const classes = new Map(ctx.classes.map((c) => [normaliserTexte(c.libelle), c]))
  const matieres = new Map()
  for (const m of ctx.matieres || []) { matieres.set(normaliserTexte(m.libelle), m); matieres.set(normaliserTexte(m.code), m) }
  const parMatricule = new Map(), parNom = new Map()
  for (const p of ctx.personnels || []) {
    if (p.matricule) parMatricule.set(normaliserTexte(p.matricule), p)
    const k = cleNom(p.nom, p.prenom); parNom.set(k, [...(parNom.get(k) || []), p])
  }
  const joursOuvres = ctx.horaires.jours || []
  const lignes = lignesBrutes.map((l) => ({ ...l, erreurs: [], avertissements: [] }))
  if (lignes.length > LIGNES_MAX_EDT) return { lignes: [], enseignants: [], affectations: [], nbErreurs: 1, nbAvertissements: 0, ok: false, global: [t("Le fichier dépasse {v0} lignes.", { v0: LIGNES_MAX_EDT })] }

  // 1. lecture de chaque ligne
  for (const l of lignes) {
    const v = l.valeurs
    l.lu = { nom: v.nom.trim().replace(/\s+/g, " "), prenom: (v.prenom || "").trim().replace(/\s+/g, " "), matricule: (v.matricule || "").trim(), discipline: v.discipline.trim().replace(/\s+/g, " ") }
    if (!l.lu.nom) l.erreurs.push(t("nom de l'enseignant manquant"))
    if (l.lu.nom.length > 100 || l.lu.prenom.length > 100) l.erreurs.push(t("nom ou prénom trop long (100 caractères au plus)"))
    if (l.lu.matricule.length > 30) l.erreurs.push(t("matricule trop long (30 caractères au plus)"))
    if (!l.lu.discipline) l.erreurs.push(t("discipline manquante"))
    else if (l.lu.discipline.length > 100) l.erreurs.push(t("discipline trop longue (100 caractères au plus)"))
    else {
      const m = matieres.get(normaliserTexte(l.lu.discipline))
      if (m) { l.lu.matiere_id = m.id; l.lu.discipline = m.libelle }
      else l.avertissements.push(t("discipline « {v0} » absente des matières de l'établissement : gardée telle quelle", { v0: l.lu.discipline }))
    }
    const c = classes.get(normaliserTexte(v.classe))
    if (!String(v.classe).trim()) l.erreurs.push(t("classe manquante"))
    else if (!c) l.erreurs.push(t("classe « {v0} » inconnue : créez-la dans Paramètres > Classes ou corrigez son nom", { v0: v.classe }))
    else l.lu.classe = c
    try { l.lu.volume = lireVolume(v.volume) } catch (e) { l.erreurs.push(e) }
    try {
      l.lu.jours = lireJours(v.jours, joursOuvres)
      const hors = l.lu.jours.filter((j) => !joursOuvres.includes(j))
      if (hors.length) l.erreurs.push(t("jour(s) non travaillé(s) dans l'établissement : {v0}", { v0: hors.join(", ") }))
    } catch (e) { l.erreurs.push(e); l.lu.jours = null }
    try { l.lu.creneaux = lireCreneaux(v.creneaux, ctx.horaires) } catch (e) { l.erreurs.push(e); l.lu.creneaux = null }
  }

  // 2. regroupement par enseignant : matricule s'il est donné, sinon nom et prénom
  const groupes = new Map()
  const ajouter = (k, l) => { const g = groupes.get(k) || []; g.push(l); groupes.set(k, g); l.groupe = k }
  for (const l of lignes) if (l.lu.nom && l.lu.matricule) ajouter(`m:${normaliserTexte(l.lu.matricule)}`, l)
  for (const l of lignes) {
    if (!l.lu.nom || l.lu.matricule) continue
    const k = cleNom(l.lu.nom, l.lu.prenom)
    const avecMat = [...groupes.entries()].filter(([g, ls]) => g.startsWith("m:") && cleNom(ls[0].lu.nom, ls[0].lu.prenom) === k)
    if (avecMat.length > 1) l.erreurs.push(t("plusieurs enseignants portent ce nom : précisez le matricule"))
    else ajouter(avecMat.length ? avecMat[0][0] : `n:${k}`, l)
  }

  // 3. cohérence au sein d'un enseignant ; enseignants
  const enseignants = [], cleDe = new Map()
  for (const [k, ls] of groupes) {
    const premier = ls[0]
    const noms = new Set(ls.map((l) => cleNom(l.lu.nom, l.lu.prenom)))
    if (noms.size > 1) for (const l of ls.slice(1)) if (cleNom(l.lu.nom, l.lu.prenom) !== cleNom(premier.lu.nom, premier.lu.prenom))
      l.erreurs.push(t("matricule « {v0} » déjà utilisé ligne {v1} pour un autre nom", { v0: l.lu.matricule, v1: premier.numero }))
    const avecJours = ls.filter((l) => l.lu.jours && l.lu.jours.length)
    const ref = avecJours[0]
    for (const l of avecJours.slice(1)) if (l.lu.jours.join() !== ref.lu.jours.join())
      l.erreurs.push(t("jours disponibles différents de ceux de la ligne {v0} pour le même enseignant", { v0: ref.numero }))
    if (!ref) for (const l of ls) if (l.lu.jours) l.erreurs.push(t("jours disponibles manquants (à indiquer au moins sur une ligne de l'enseignant)"))
    const avecCr = ls.filter((l) => l.lu.creneaux && l.lu.creneaux.length)
    for (const l of avecCr.slice(1)) if (JSON.stringify(l.lu.creneaux) !== JSON.stringify(avecCr[0].lu.creneaux))
      l.erreurs.push(t("créneaux disponibles différents de ceux de la ligne {v0} pour le même enseignant", { v0: avecCr[0].numero }))
    // rapprochement avec la liste du personnel
    let personnel = null
    if (premier.lu.matricule) personnel = parMatricule.get(normaliserTexte(premier.lu.matricule)) || null
    if (!personnel) { const p = parNom.get(cleNom(premier.lu.nom, premier.lu.prenom)) || []; if (p.length === 1) personnel = p[0] }
    if (!personnel) premier.avertissements.push(t("enseignant absent de la liste du personnel : il figurera sur l'emploi du temps sans compte associé"))
    const cle = k                                    // clé stable (matricule ou nom) : les réglages de l'enseignant survivent aux corrections
    cleDe.set(k, cle)
    enseignants.push({ cle, nom: premier.lu.nom, prenom: premier.lu.prenom, matricule: premier.lu.matricule || personnel?.matricule || "",
      personnel_id: personnel?.id || null, jours: ref ? ref.lu.jours : [], creneaux: avecCr[0]?.lu.creneaux || [], jours_preferes: [], lignes: ls.map((l) => l.numero) })
  }

  // 4. affectations ; doublons
  const affectations = [], vus = new Map(), parClasseMatiere = new Map()
  for (const l of lignes) {
    if (!l.groupe || !l.lu.classe || !l.lu.discipline || !l.lu.volume) continue
    const kd = `${l.groupe}|${l.lu.classe.id}|${normaliserTexte(l.lu.discipline)}`
    if (vus.has(kd)) { l.erreurs.push(t("même enseignant, même classe et même discipline que la ligne {v0}", { v0: vus.get(kd) })); continue }
    vus.set(kd, l.numero)
    const kc = `${l.lu.classe.id}|${normaliserTexte(l.lu.discipline)}`
    if (parClasseMatiere.has(kc)) l.avertissements.push(t("{v0} en {v1} est aussi confiée à un autre enseignant (ligne {v2})", { v0: l.lu.discipline, v1: l.lu.classe.libelle, v2: parClasseMatiere.get(kc) }))
    else parClasseMatiere.set(kc, l.numero)
    if (l.erreurs.length) continue
    affectations.push({ id: `a${l.numero}`, enseignant: cleDe.get(l.groupe), classe_id: l.lu.classe.id, classe: l.lu.classe.libelle,
      discipline: l.lu.discipline, matiere_id: l.lu.matiere_id || null, volume: l.lu.volume, ligne: l.numero })
  }
  const nbErreurs = lignes.reduce((s, l) => s + l.erreurs.length, 0), nbAvertissements = lignes.reduce((s, l) => s + l.avertissements.length, 0)
  const ok = lignes.length > 0 && nbErreurs === 0
  return {
    lignes, ok, nbErreurs, nbAvertissements, global: lignes.length ? [] : [t("Aucune ligne de données dans le fichier.")],
    enseignants: ok ? enseignants : [], affectations: ok ? affectations : [],
    recap: { lignes: lignes.length, enseignants: enseignants.length, classes: new Set(affectations.map((a) => a.classe_id)).size, heures: affectations.reduce((s, a) => s + a.volume, 0) },
  }
}

/** Lignes d'exemple du modèle téléchargeable. */
export function lignesModele(classes) {
  const c1 = classes[0]?.libelle || "6e A", c2 = classes[1]?.libelle || "6e B"
  return [
    ["MBARGA", "Paul", "ENS001", "Mathématiques", c1, 5, "Lundi, Mardi, Jeudi, Vendredi", ""],
    ["MBARGA", "Paul", "ENS001", "Mathématiques", c2, 5, "", ""],
    ["NGO NJOCK", "Marie Claire", "", "Français", c1, 5, "Lundi-Vendredi", "07:30-12:20"],
    ["ESSOMBA", "Jean", "", "Informatique", c2, 2, "Mercredi; Vendredi", "matin"],
  ]
}
