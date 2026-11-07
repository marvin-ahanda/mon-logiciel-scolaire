// Listes Excel de l'établissement, importées et exportées séparément (élèves, classes, matières, personnel, matières par classe, notes) :
// lecture tolérante (désordre, cases vides ou mal remplies : complétées et signalées ; seul un fichier d'une autre liste est refusé),
// envoi par lots courts, et export au même format (l'export sert de modèle).
import { t } from "../i18n.jsx"
import { enDate, enNote, enOuiNon, enSexe, lireFeuilles, normaliser, telechargerClasseur, texte } from "./excel.js"
import { comparerNoms, nomComplet } from "./format.js"
import { supabase, toutCharger, verifier } from "../supabase.js"

export const TAILLE_MAX_LISTE = 5 * 1024 * 1024

// --- Listes reconnues à l'import (en-têtes en français ou en anglais, dans n'importe quel ordre) ----------------------
const FEUILLES = {
  sections: { noms: ["Sections", "Liste des sections"],
    colonnes: { libelle: ["Section", "Nom de la section", "Libellé"], ordre: ["Ordre", "Ordre d'affichage", "Order"] } },
  classes: { noms: ["Classes", "Liste des classes"],
    colonnes: { libelle: ["Classe", "Class", "Libellé", "Nom de la classe"], niveau: ["Niveau", "Level"], section: ["Section"], cycle: ["Cycle"],
                ordre: ["Ordre", "Ordre d'affichage", "Order"] } },
  matieres: { noms: ["Matières", "Matieres", "Subjects", "Liste des matières"],
    colonnes: { code: ["Code", "Code matière", "Subject code", "Code de la matière"], libelle: ["Matière", "Subject", "Libellé", "Nom de la matière"] } },
  personnels: { noms: ["Personnel", "Staff", "Liste du personnel"],
    colonnes: { nom: ["Nom", "Last name", "Surname", "Noms"], prenom: ["Prénom", "Prenom", "Prénoms", "First name"], role: ["Fonction", "Rôle", "Role", "Function"],
                matricule: ["Matricule du personnel", "Matricule", "Staff ID"], telephone: ["Téléphone", "Telephone", "Phone", "Contact"],
                poste: ["Poste / spécialité", "Poste / spécialité (information)", "Poste ou spécialité", "Poste", "Spécialité", "Position", "Speciality"] } },
  programme: { noms: ["Matières par classe", "Matieres par classe", "Subjects per class", "Programme", "Coefficients"],
    colonnes: { classe: ["Classe", "Class"], code: ["Code matière", "Subject code", "Code"], matiere: ["Matière", "Matière (rappel)", "Subject", "Nom de la matière"],
                coefficient: ["Coefficient", "Coef", "Coef."], groupe: ["Groupe", "Group"], enseignant: ["Enseignant", "Teacher", "Professeur"],
                annee: ["Année scolaire", "School year"] } },
  eleves: { noms: ["Élèves", "Eleves", "Students", "Liste des élèves"],
    colonnes: { matricule: ["Matricule", "Student ID"], nom: ["Nom", "Last name", "Surname", "Noms", "Nom et prénom", "Noms et prénoms", "Élève"],
                prenom: ["Prénom", "Prenom", "Prénoms", "First name"],
                sexe: ["Sexe", "Sex", "Gender", "Genre"], date_naissance: ["Date de naissance", "Né le", "Ne le", "Née le", "Date of birth"],
                lieu_naissance: ["Lieu de naissance", "Place of birth"],
                telephone_parent: ["Contact du parent", "Parent's contact", "Parent contact", "Téléphone du parent", "Téléphone", "Telephone", "Parent's phone", "Phone", "Contact"],
                classe: ["Classe", "Class"], redoublant: ["Redoublant", "Repeater", "Repeating"], nouveau: ["Nouvel élève", "Nouveau", "New student", "New"] } },
  // même présentation que l'export des notes : un fichier exporté se réimporte tel quel
  notes: { noms: ["Notes", "Grades", "Marks", "Notes des élèves", "Liste des notes"],
    colonnes: { matricule: ["Matricule", "Student ID"], eleve: ["Élève", "Eleve", "Student", "Nom", "Nom et prénom"],
                code: ["Code matière", "Subject code"], matiere: ["Matière", "Subject"],
                sequence: ["Séquence", "Sequence", "Séq.", "Seq"], note: ["Note", "Note /20", "Note sur 20", "Grade", "Grade /20", "Mark"],
                annee: ["Année scolaire", "School year"], classe: ["Classe", "Class"] } },
}

// En-têtes propres à chaque liste : ils permettent de reconnaître le fichier, quel que soit son nom.
const SIGNATURES = {
  eleves: ["Sexe", "Sex", "Gender", "Genre", "Date de naissance", "Né le", "Née le", "Date of birth", "Lieu de naissance", "Place of birth",
           "Contact du parent", "Parent's contact", "Téléphone du parent", "Parent's phone", "Redoublant", "Repeater", "Nouvel élève", "New student"],
  personnels: ["Fonction", "Rôle", "Role", "Function", "Poste / spécialité", "Poste / spécialité (information)", "Poste ou spécialité", "Poste", "Spécialité",
               "Position", "Speciality", "Matricule du personnel", "Staff ID"],
  classes: ["Niveau", "Level", "Section", "Cycle", "Ordre", "Ordre d'affichage", "Order"],
  programme: ["Coefficient", "Coef", "Coef.", "Groupe", "Group", "Enseignant", "Teacher", "Professeur"],
  notes: ["Séquence", "Sequence", "Séq.", "Seq", "Note", "Note /20", "Note sur 20", "Grade", "Grade /20", "Mark"],
  matieres: [],
}
// Colonnes minimales quand aucun en-tête propre n'est présent (au moins une colonne de chaque groupe)
const MINIMUM = { eleves: [["nom", "matricule"]], classes: [["libelle"]], matieres: [["code", "libelle"]], personnels: [["nom"]],
                  programme: [["classe"], ["code", "matiere"]], notes: [["matricule", "eleve"], ["note"]] }

export const ROLES_IMPORT = { admin: "Administration", enseignant: "Enseignant", surveillant: "Surveillant général", comptable: "Comptable / caissier" }

export function enRole(v) {
  const n = normaliser(v)
  if (!n) return null
  if (["administration", "admin", "administrateur", "administrator", "directeur", "directrice", "principal", "proviseur", "chefdetablissement",
       "censeur", "viceprincipal", "conseillerdorientation", "chefdestravaux"].includes(n)) return "admin"
  if (["enseignant", "enseignante", "professeur", "prof", "teacher", "instituteur", "institutrice", "maitre", "maitresse"].includes(n)) return "enseignant"
  if (["surveillant", "surveillantgeneral", "surveillante", "surveillantegenerale", "disciplinemaster", "surveillance", "sg"].includes(n)) return "surveillant"
  if (["comptable", "caissier", "caissiere", "comptablecaissier", "econome", "intendant", "intendante", "bursar", "accountant", "cashier", "bursarcashier",
       "accountantcashier"].includes(n)) return "comptable"
  return null
}

export function enCycle(v) {
  const n = normaliser(v)
  if (!n) return undefined
  if (["1", "premier", "premiercycle", "1ercycle", "1er", "first", "firstcycle"].includes(n)) return 1
  if (["2", "second", "secondcycle", "2ndcycle", "2nd", "2e", "2ecycle", "deuxieme", "deuxiemecycle"].includes(n)) return 2
  return null
}

const entier = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return undefined
  const n = Number(String(v).trim().replace(",", "."))
  return Number.isInteger(n) ? n : null
}
const nombre = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return undefined
  const n = Number(String(v).trim().replace(",", "."))
  return Number.isFinite(n) ? n : null
}

// --- Lecture d'une liste ----------------------------------------------------------------------------------------------
/** En-têtes acceptés pour une liste : ceux du modèle, plus leur traduction (un fichier exporté en anglais se réimporte). */
function colonnesDe(cle) {
  return Object.fromEntries(Object.entries(FEUILLES[cle].colonnes).map(([k, noms]) => [k, [...new Set([...noms, ...noms.map((n) => t(n))])]]))
}
const TYPES = ["eleves", "classes", "matieres", "personnels", "programme", "notes"]

/** Ligne d'en-têtes parmi les 6 premières (une ligne de titre peut la précéder) : celle qui contient le plus d'en-têtes connus. */
function ligneEntetes(data) {
  const connus = new Set(TYPES.flatMap((k) => Object.values(colonnesDe(k)).flat()).map(normaliser))
  let meilleure = -1, score = 0
  for (let h = 0; h < Math.min(6, data.length); h++) {
    const n = new Set((data[h] || []).map(normaliser).filter((x) => connus.has(x))).size
    if (n > score) { score = n; meilleure = h }
  }
  return meilleure
}

/**
 * Reconnaît la liste contenue dans une feuille (tableau de lignes) et vérifie qu'elle correspond à la liste choisie.
 * Renvoie { h, positions } ou { refus: message }.
 */
export function reconnaitreListe(data, cle) {
  const h = ligneEntetes(data)
  if (h < 0) return { refus: t("Aucune colonne reconnue dans ce fichier : exportez la liste « {v0} » pour obtenir le modèle.", { v0: t(LISTES[cle].titre) }) }
  const entetes = new Set((data[h] || []).map(normaliser))
  const score = Object.fromEntries(TYPES.map((k) => [k, new Set([...SIGNATURES[k], ...SIGNATURES[k].map((n) => t(n))].map(normaliser).filter((x) => entetes.has(x))).size]))
  const meilleur = Math.max(...Object.values(score))
  const autre = TYPES.filter((k) => k !== cle && score[k] === meilleur && meilleur > score[cle]).sort((a, b) => score[b] - score[a])[0]
  if (autre) {
    return { refus: t("Ce fichier ressemble à la liste « {v0} », pas à la liste « {v1} » : vérifiez que vous avez choisi le bon fichier, ou importez-le dans la carte « {v0} ».",
      { v0: t(LISTES[autre].titre), v1: t(LISTES[cle].titre) }) }
  }
  const colonnes = colonnesDe(cle), positions = {}
  const index = new Map((data[h] || []).map((e, k) => [normaliser(e), k]))
  for (const [k, noms] of Object.entries(colonnes)) {
    const trouve = noms.map(normaliser).find((n) => index.has(n))
    if (trouve !== undefined) positions[k] = index.get(trouve)
  }
  // « Nom » sert aussi d'« Élève » dans les notes : pas de double emploi avec une vraie colonne Élève
  if (!MINIMUM[cle].every((groupe) => groupe.some((k) => k in positions))) {
    return { refus: t("Ce fichier ne correspond pas à la liste « {v0} » : colonnes attendues {v1}. Exportez la liste pour obtenir le modèle.",
      { v0: t(LISTES[cle].titre), v1: MINIMUM[cle].map((g) => g.map((k) => `« ${colonnes[k][0]} »`).join(` ${t("ou")} `)).join(", ") }) }
  }
  return { h, positions }
}

/**
 * Lit la liste « cle » dans un classeur : la feuille qui porte son nom, sinon la première qui correspond.
 * Seul cas bloquant : un fichier qui ne correspond pas à la liste choisie.
 */
export async function lireListe(fichier, cle) {
  const feuilles = await lireFeuilles(fichier, TAILLE_MAX_LISTE)
  const noms = new Set([...FEUILLES[cle].noms, ...FEUILLES[cle].noms.map((n) => t(n))].map(normaliser))
  const parNom = feuilles.find((f) => noms.has(normaliser(f.nom)))
  let refus = null
  for (const f of parNom ? [parNom] : feuilles) {
    const r = reconnaitreListe(f.data, cle)
    if (r.refus) { refus = refus || r.refus; continue }
    const lignes = []
    f.data.slice(r.h + 1).forEach((ligne, k) => {
      if (!ligne || ligne.every((v) => v === null || String(v).trim() === "")) return
      lignes.push({ numero: r.h + k + 2, valeurs: Object.fromEntries(Object.entries(r.positions).map(([c, i]) => [c, ligne[i] ?? null])) })
    })
    return { lu: { [cle]: { nom: f.nom, lignes } }, ignorees: [] }
  }
  throw new Error(refus)
}

// --- Contrôle tolérant ------------------------------------------------------------------------------------------------
// Ce qui manque ou est mal renseigné est complété au mieux ; chaque correction est signalée, avec l'endroit où la reprendre.
const LIEUX = {
  eleves: ["/eleves?filtre=a-completer", "Élèves → À compléter"], classes: ["/parametres/classes", "Paramètres → Classes"],
  matieres: ["/parametres/matieres", "Paramètres → Matières"], personnel: ["/personnel", "Personnel"],
  coefficients: ["/parametres/coefficients", "Paramètres → Matières par classe"],
}
export const REMARQUES = {
  ligne_vide: ["ligne(s) sans information utilisable, ignorée(s)", null],
  doublon: ["ligne(s) en double : la dernière est retenue", null],
  eleve_nom: ["élève(s) sans nom : « À COMPLÉTER » en attendant", "eleves"],
  eleve_matricule: ["élève(s) sans matricule ou avec un matricule déjà pris : matricule provisoire PROV-… attribué", "eleves"],
  eleve_sexe: ["élève(s) sans sexe lisible (M ou F) : à préciser", "eleves"],
  eleve_date: ["date(s) de naissance illisible(s) : laissée(s) vide(s)", "eleves"],
  eleve_oui_non: ["valeur(s) Redoublant / Nouvel élève illisible(s) : valeur par défaut", "eleves"],
  classe_creee: ["classe(s) introuvable(s), créée(s) par l'import : vérifiez le nom, le niveau, la section et le cycle", "classes"],
  classe_cycle: ["cycle(s) illisible(s) (1 ou 2 attendu) : laissé(s) vide(s)", "classes"],
  classe_tronquee: ["nom(s) trop long(s), raccourci(s)", "classes"],
  matiere_code: ["matière(s) sans code : code créé automatiquement", "matieres"],
  matiere_nom: ["matière(s) sans nom : le code sert de nom", "matieres"],
  matiere_creee: ["matière(s) introuvable(s), créée(s) par l'import : vérifiez le code et le nom", "matieres"],
  personnel_fonction: ["fonction(s) absente(s) ou inconnue(s) : « Enseignant » par défaut, à vérifier", "personnel"],
  personnel_matricule: ["matricule(s) du personnel en double : laissé(s) vide(s)", "personnel"],
  programme_coefficient: ["coefficient(s) absent(s) ou invalide(s) : ramené(s) entre 1 et 20 (1 par défaut)", "coefficients"],
  programme_groupe: ["groupe(s) invalide(s) : groupe 1", "coefficients"],
  programme_enseignant: ["enseignant(s) introuvable(s) : matière laissée sans enseignant", "coefficients"],
  programme_incomplet: ["ligne(s) sans classe ou sans matière, ignorée(s)", null],
  notes_matricule: ["matricule(s) corrigé(s) d'après le nom de l'élève", "eleves"],
  notes_eleve: ["note(s) non importée(s) : élève introuvable ou sans classe", "eleves"],
  notes_matiere: ["note(s) non importée(s) : matière introuvable ou non enseignée dans la classe de l'élève", "coefficients"],
  notes_pas_confiee: ["note(s) non importée(s) : matière qui ne vous est pas confiée", null],
  notes_sequence: ["note(s) non importée(s) : séquence absente, invalide (1 à 6) ou verrouillée", null],
  notes_valeur: ["note(s) non importée(s) : valeur illisible ou hors de 0 à 20", null],
  notes_classe: ["classe(s) indiquée(s) différente(s) de celle de l'élève : la classe de l'élève est retenue", null],
}
export const lieuRemarque = (code) => (REMARQUES[code]?.[1] ? LIEUX[REMARQUES[code][1]] : null)

/** Code de matière à partir de son nom : « Sciences de la vie » -> « SCIEN », sans collision. */
function codeDepuisNom(nom, pris) {
  const base = normaliser(nom).toUpperCase().slice(0, 6) || "MAT"
  let code = base, k = 2
  while (pris.has(code)) code = `${base.slice(0, 12)}${k++}`
  return code
}

/**
 * Contrôle tolérant du contenu lu. Rien n'est bloquant (sauf un fichier vide) : les valeurs manquantes ou illisibles sont
 * complétées, les lignes inutilisables mises de côté, et tout est signalé dans « remarques ».
 * existant : { exercice, sections, classes, matieres, personnels, eleves (matricules), elevesNoms, classesEleves,
 *              sequencesVerrouillees, attributions, seulement }
 */
export function analyserEcole({ lu }, existant, annee) {
  const erreurs = [], remarques = new Map()
  const noter = (code, numero, exemple) => {
    if (!remarques.has(code)) remarques.set(code, { code, n: 0, lignes: [], exemples: [] })
    const r = remarques.get(code); r.n++
    if (numero && r.lignes.length < 8) r.lignes.push(numero)
    if (exemple && r.exemples.length < 5 && !r.exemples.includes(exemple)) r.exemples.push(exemple)
  }
  const lignes = (cle) => lu[cle]?.lignes || []
  const anneeDefaut = (() => { const d = new Date(), a = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1; return `${a}-${a + 1}` })()
  const anneeValide = /^\d{4}-\d{4}$/.test(annee || "") && Number(annee.slice(5)) === Number(annee.slice(0, 4)) + 1 ? annee : anneeDefaut

  // Sections (créées aussi automatiquement avec les classes)
  const sections = [], nomsSections = new Map(existant.sections.map((s) => [normaliser(s.libelle), s.libelle]))
  for (const { valeurs: v } of lignes("sections")) {
    const libelle = texte(v.libelle, 60)
    if (!libelle || nomsSections.has(normaliser(libelle))) continue
    nomsSections.set(normaliser(libelle), libelle); sections.push({ libelle, ordre: entier(v.ordre) ?? undefined })
  }
  const section = (nom) => {
    const libelle = texte(nom, 60)
    if (!libelle) return ""
    if (!nomsSections.has(normaliser(libelle))) {
      nomsSections.set(normaliser(libelle), libelle); sections.push({ libelle, ordre: existant.sections.length + sections.length + 1 })
    }
    return nomsSections.get(normaliser(libelle))
  }

  // Classes (et classes créées quand une autre liste en cite une inconnue)
  const classes = [], indexClasses = new Map(), classesConnues = new Map(existant.classes.map((c) => [normaliser(c.libelle), c.libelle]))
  const ajouterClasse = (c) => {
    const k = normaliser(c.libelle)
    if (indexClasses.has(k)) classes[indexClasses.get(k)] = { ...classes[indexClasses.get(k)], ...c }
    else { indexClasses.set(k, classes.length); classes.push(c) }
    classesConnues.set(k, c.libelle)
  }
  const classeOuCreee = (nom, numero) => {
    const libelle = texte(nom, 50)
    if (!libelle) return ""
    if (!classesConnues.has(normaliser(libelle))) { ajouterClasse({ libelle }); noter("classe_creee", numero, libelle) }
    return classesConnues.get(normaliser(libelle))
  }
  for (const { numero, valeurs: v } of lignes("classes")) {
    const brut = texte(v.libelle)
    if (!brut) { noter("ligne_vide", numero); continue }
    if (brut.length > 50) noter("classe_tronquee", numero, brut)
    if (indexClasses.has(normaliser(brut.slice(0, 50)))) noter("doublon", numero, brut.slice(0, 50))
    let cycle = enCycle(v.cycle)
    if (cycle === null) { noter("classe_cycle", numero, brut.slice(0, 50)); cycle = undefined }
    ajouterClasse({ libelle: brut.slice(0, 50), niveau: texte(v.niveau, 50), section: section(v.section), cycle, ordre: entier(v.ordre) ?? undefined })
  }

  // Matières (et matières créées quand une autre liste en cite une inconnue)
  const matieres = [], indexMatieres = new Map(), codes = new Map(existant.matieres.map((m) => [m.code.toUpperCase(), m.libelle]))
  const parNomMatiere = new Map(existant.matieres.map((m) => [normaliser(m.libelle), m.code.toUpperCase()]))
  const ajouterMatiere = (m) => {
    if (indexMatieres.has(m.code)) matieres[indexMatieres.get(m.code)] = m
    else { indexMatieres.set(m.code, matieres.length); matieres.push(m) }
    codes.set(m.code, m.libelle); parNomMatiere.set(normaliser(m.libelle), m.code)
  }
  /** Code d'une matière à partir d'un code et / ou d'un nom ; inconnue : créée si « creer », sinon null. */
  const matiereDe = (codeBrut, nomBrut, numero, creer) => {
    const c = texte(codeBrut, 15).toUpperCase(), n = texte(nomBrut, 100)
    if (c && codes.has(c)) return c
    if (c && parNomMatiere.has(normaliser(c))) return parNomMatiere.get(normaliser(c))     // nom écrit dans la colonne du code
    if (n && parNomMatiere.has(normaliser(n))) return parNomMatiere.get(normaliser(n))
    if (n && codes.has(n.toUpperCase().slice(0, 15))) return n.toUpperCase().slice(0, 15)
    if (!creer || (!c && !n)) return null
    const code = c || codeDepuisNom(n, codes)
    ajouterMatiere({ code, libelle: n || c }); noter("matiere_creee", numero, n || c)
    return code
  }
  for (const { numero, valeurs: v } of lignes("matieres")) {
    let code = texte(v.code).toUpperCase(), libelle = texte(v.libelle, 100)
    if (!code && !libelle) { noter("ligne_vide", numero); continue }
    if (!code) {
      code = parNomMatiere.get(normaliser(libelle))       // matière déjà connue sous ce nom : son code est repris
      if (!code) { code = codeDepuisNom(libelle, codes); noter("matiere_code", numero, libelle) }
    }
    if (code.length > 15) code = code.slice(0, 15)
    if (!libelle) { libelle = code; noter("matiere_nom", numero, code) }
    if (indexMatieres.has(code)) noter("doublon", numero, code)
    ajouterMatiere({ code, libelle })
  }

  // Personnel
  const personnels = [], designations = new Map(), indexPersonnes = new Map(), matriculesPersonnel = new Set()
  const designer = (p, role) => {
    if (p.matricule) designations.set(normaliser(p.matricule), role)
    designations.set(normaliser(`${p.nom} ${p.prenom || ""}`), role); designations.set(normaliser(`${p.prenom || ""} ${p.nom}`), role)
  }
  for (const p of existant.personnels.filter((x) => x.actif)) designer(p, p.role)
  const dejaLa = (p) => existant.personnels.some((x) => (p.matricule && x.matricule && normaliser(x.matricule) === normaliser(p.matricule))
    || normaliser(`${x.nom} ${x.prenom}`) === normaliser(`${p.nom} ${p.prenom}`))
  for (const { numero, valeurs: v } of lignes("personnels")) {
    let nom = texte(v.nom, 150), prenom = texte(v.prenom, 150)
    if (!nom && !prenom) { noter("ligne_vide", numero); continue }
    if (!nom) { nom = prenom; prenom = "" }
    let role = enRole(v.role)
    if (!role) { role = "enseignant"; noter("personnel_fonction", numero, `${nom} ${prenom}`.trim()) }
    let matricule = texte(v.matricule, 30)
    const cle = normaliser(`${nom} ${prenom}`)
    if (indexPersonnes.has(cle)) noter("doublon", numero, `${nom} ${prenom}`.trim())
    else if (matricule && matriculesPersonnel.has(normaliser(matricule))) { noter("personnel_matricule", numero, matricule); matricule = "" }
    if (matricule) matriculesPersonnel.add(normaliser(matricule))
    const p = { nom, prenom, role, matricule, telephone: texte(v.telephone, 30), poste: texte(v.poste, 100) }
    p.existe = dejaLa(p)
    if (!p.existe) designer(p, p.role)
    if (indexPersonnes.has(cle)) personnels[indexPersonnes.get(cle)] = p
    else { indexPersonnes.set(cle, personnels.length); personnels.push(p) }
  }

  // Matières par classe
  const programme = [], indexProgramme = new Map()
  const anneesProgramme = [...new Set(lignes("programme").map((l) => texte(l.valeurs.annee)).filter(Boolean))].sort()
  const anneeRetenue = anneesProgramme.at(-1)
  for (const { numero, valeurs: v } of lignes("programme").filter((l) => !anneeRetenue || !texte(l.valeurs.annee) || texte(l.valeurs.annee) === anneeRetenue)) {
    if (!texte(v.classe) || (!texte(v.code) && !texte(v.matiere))) { noter("programme_incomplet", numero); continue }
    const classe = classeOuCreee(v.classe, numero)
    const code = matiereDe(v.code, v.matiere, numero, true)
    let coefficient = nombre(v.coefficient)
    if (coefficient === undefined || coefficient === null || coefficient < 1 || coefficient > 20 || !Number.isInteger(coefficient)) {
      noter("programme_coefficient", numero, `${classe} ${code}`)
      coefficient = coefficient === undefined || coefficient === null || coefficient < 1 ? 1 : Math.min(20, Math.round(coefficient))
    }
    let groupe = entier(v.groupe)
    if (groupe === null || (groupe !== undefined && (groupe < 1 || groupe > 3))) { noter("programme_groupe", numero, `${classe} ${code}`); groupe = 1 }
    let enseignant = texte(v.enseignant)
    if (enseignant && !designations.has(normaliser(enseignant))) { noter("programme_enseignant", numero, enseignant); enseignant = "" }
    const k = `${normaliser(classe)}|${code}`
    const ligne = { classe, matiere: code, libelle_matiere: codes.get(code), coefficient, groupe: groupe ?? 1, enseignant }
    if (indexProgramme.has(k)) { noter("doublon", numero, `${classe} ${code}`); programme[indexProgramme.get(k)] = ligne }
    else { indexProgramme.set(k, programme.length); programme.push(ligne) }
  }

  // Élèves
  const eleves = [], indexEleves = new Map(), pris = new Set([...existant.eleves])
  let provisoire = 0
  const matriculeProvisoire = () => { let m; do { m = `PROV-${String(++provisoire).padStart(4, "0")}` } while (pris.has(m)); pris.add(m); return m }
  for (const { numero, valeurs: v } of lignes("eleves")) {
    let nom = texte(v.nom, 100), prenom = texte(v.prenom, 100), matricule = texte(v.matricule, 30)
    if (!nom && !prenom && !matricule) { noter("ligne_vide", numero); continue }
    if (!nom && prenom) { nom = prenom; prenom = "" }
    if (!nom) { nom = "À COMPLÉTER"; noter("eleve_nom", numero, matricule) }
    const identite = normaliser(`${nom} ${prenom}`)
    let signale = false
    if (matricule && indexEleves.has(matricule)) {
      const precedent = eleves[indexEleves.get(matricule)]
      if (normaliser(`${precedent.nom} ${precedent.prenom}`) === identite) noter("doublon", numero, matricule)
      else { noter("eleve_matricule", numero, `${matricule} (${nom} ${prenom})`.trim()); matricule = ""; signale = true }
    }
    if (!matricule) { matricule = matriculeProvisoire(); if (!signale) noter("eleve_matricule", numero, `${nom} ${prenom}`.trim()) }
    const e = { matricule, nom, prenom, lieu_naissance: texte(v.lieu_naissance, 100), telephone_parent: texte(v.telephone_parent, 30) }
    e.sexe = enSexe(v.sexe)
    if (!e.sexe) { e.sexe = null; noter("eleve_sexe", numero, `${nom} ${prenom}`.trim()) }
    try { e.date_naissance = enDate(v.date_naissance) } catch { e.date_naissance = null; noter("eleve_date", numero, texte(v.date_naissance)) }
    e.classe = classeOuCreee(v.classe, numero)
    const red = enOuiNon(v.redoublant), nouv = enOuiNon(v.nouveau)
    if (red === null || nouv === null) noter("eleve_oui_non", numero)
    if (red !== undefined && red !== null) e.redoublant = red
    if (nouv !== undefined && nouv !== null) e.nouveau = nouv
    e.existe = existant.eleves.includes(matricule)
    pris.add(matricule)
    if (indexEleves.has(matricule)) eleves[indexEleves.get(matricule)] = e
    else { indexEleves.set(matricule, eleves.length); eleves.push(e) }
  }

  // Notes (sur 20) de l'année active, ou de celle que l'import va créer
  const anneeCible = existant.exercice?.libelle || anneeValide
  const classeDe = new Map(Object.entries(existant.classesEleves || {}))
  for (const e of eleves) if (e.classe) classeDe.set(e.matricule, e.classe)
  const matriculesConnus = new Set([...existant.eleves, ...eleves.map((e) => e.matricule)])
  const parNomEleve = existant.elevesNoms || new Map()
  const offertes = new Set([...existant.attributions.map((a) => `${normaliser(a.classe)}|${a.code}`), ...programme.map((x) => `${normaliser(x.classe)}|${x.matiere}`)])
  const toutesOffertes = new Set([...(existant.attributionsTout || existant.attributions).map((a) => `${normaliser(a.classe)}|${a.code}`)])
  const verrouillees = new Set(existant.sequencesVerrouillees || [])
  const notes = [], indexNotes = new Map()
  let autresAnnees = 0, vides = 0
  for (const { numero, valeurs: v } of lignes("notes")) {
    const an = texte(v.annee)
    if (an && anneeCible && normaliser(an) !== normaliser(anneeCible)) { autresAnnees++; continue }
    let valeur
    try { valeur = enNote(v.note) } catch { noter("notes_valeur", numero, texte(v.note)); continue }
    if (valeur === null) { vides++; continue }
    let matricule = texte(v.matricule, 31)
    if (!matriculesConnus.has(matricule)) {
      const candidats = parNomEleve.get(normaliser(texte(v.eleve))) || []
      if (candidats.length === 1) { noter("notes_matricule", numero, `${texte(v.eleve)} → ${candidats[0]}`); matricule = candidats[0] }
      else { noter("notes_eleve", numero, matricule || texte(v.eleve)); continue }
    }
    const classe = classeDe.get(matricule)
    if (!classe) { noter("notes_eleve", numero, matricule); continue }
    const indiquee = texte(v.classe)
    if (indiquee && normaliser(indiquee) !== normaliser(classe)) noter("notes_classe", numero, `${matricule} : ${indiquee} → ${classe}`)
    const code = matiereDe(v.code, v.matiere, numero, false)
    if (!code || !offertes.has(`${normaliser(classe)}|${code}`)) {
      noter(code && existant.seulement && toutesOffertes.has(`${normaliser(classe)}|${code}`) ? "notes_pas_confiee" : "notes_matiere", numero,
            `${texte(v.code) || texte(v.matiere)} (${classe})`)
      continue
    }
    const sequence = entier(v.sequence)
    if (!sequence || sequence < 1 || sequence > 6 || verrouillees.has(sequence)) { noter("notes_sequence", numero, texte(v.sequence)); continue }
    const k = `${matricule}|${code}|${sequence}`
    if (indexNotes.has(k)) { noter("doublon", numero, k.replaceAll("|", " · ")); notes[indexNotes.get(k)] = [matricule, code, sequence, valeur] }
    else { indexNotes.set(k, notes.length); notes.push([matricule, code, sequence, valeur]) }
  }

  const besoinAnnee = !existant.exercice && (eleves.some((e) => e.classe) || programme.length > 0 || notes.length > 0)
  const vide = !sections.length && !classes.length && !matieres.length && !personnels.length && !programme.length && !eleves.length && !notes.length
  if (vide) erreurs.push({ feuille: "", ligne: null, message: autresAnnees || vides
    ? t("Aucune note à importer : les cases Note sont vides ou concernent une autre année scolaire.")
    : t("Le fichier ne contient aucune ligne à importer.") })

  // Résumé par classe : élèves du fichier, matières et coefficients (fichier + déjà enregistrés), notes
  const parClasse = new Map()
  const ligneClasse = (lib) => {
    const k = normaliser(lib)
    if (!parClasse.has(k)) parClasse.set(k, { classe: lib, eleves: 0, garcons: 0, filles: 0, matieres: new Map() })
    return parClasse.get(k)
  }
  for (const c of [...existant.classes.map((x) => x.libelle), ...classes.map((x) => x.libelle)]) ligneClasse(c)
  for (const a of existant.attributions) ligneClasse(a.classe).matieres.set(a.code, a.coefficient)
  for (const p of programme) ligneClasse(p.classe).matieres.set(p.matiere, p.coefficient || 0)
  for (const e of eleves) if (e.classe) { const l = ligneClasse(e.classe); l.eleves++; if (e.sexe === "M") l.garcons++; if (e.sexe === "F") l.filles++ }
  const ordre = new Map([...existant.classes, ...classes].map((c, k) => [normaliser(c.libelle), c.ordre ?? k]))
  const notesParClasse = new Map()
  for (const [matricule] of notes) { const c = normaliser(classeDe.get(matricule) || ""); if (c) notesParClasse.set(c, (notesParClasse.get(c) || 0) + 1) }
  const resume = {
    annee: existant.exercice?.libelle || (besoinAnnee ? anneeValide : ""), anneeACreer: besoinAnnee,
    sections: { total: sections.length, nouvelles: sections.filter((s) => !existant.sections.some((x) => normaliser(x.libelle) === normaliser(s.libelle))).length },
    classes: { total: classes.length, nouvelles: classes.filter((c) => !existant.classes.some((x) => normaliser(x.libelle) === normaliser(c.libelle))).length },
    matieres: { total: matieres.length, nouvelles: matieres.filter((m) => !existant.matieres.some((x) => x.code.toUpperCase() === m.code)).length },
    personnels: { total: personnels.length, nouveaux: personnels.filter((p) => !p.existe).length, existants: personnels.filter((p) => p.existe).length,
                  parRole: Object.keys(ROLES_IMPORT).map((r) => [r, personnels.filter((p) => !p.existe && p.role === r).length]).filter(([, n]) => n) },
    programme: programme.length,
    eleves: { total: eleves.length, nouveaux: eleves.filter((e) => !e.existe).length, misAJour: eleves.filter((e) => e.existe).length,
              garcons: eleves.filter((e) => e.sexe === "M").length, filles: eleves.filter((e) => e.sexe === "F").length,
              sansClasse: eleves.filter((e) => !e.classe).length },
    parClasse: [...parClasse.values()].filter((l) => l.eleves || l.matieres.size)
      .sort((a, b) => (ordre.get(normaliser(a.classe)) ?? 0) - (ordre.get(normaliser(b.classe)) ?? 0) || comparerNoms(a.classe, b.classe))
      .map((l) => ({ classe: l.classe, eleves: l.eleves, garcons: l.garcons, filles: l.filles, matieres: l.matieres.size,
                     coefficients: [...l.matieres.values()].reduce((s, c) => s + c, 0), notes: notesParClasse.get(normaliser(l.classe)) || 0 })),
    notes: { total: notes.length, eleves: new Set(notes.map((n) => n[0])).size, sequences: [...new Set(notes.map((n) => n[2]))].sort((a, b) => a - b),
             autresAnnees, vides },
    ignorees: [],
  }
  const sansMarque = ({ existe, ...x }) => x
  return {
    erreurs, remarques: [...remarques.values()], resume,
    donnees: { annee: besoinAnnee ? anneeValide : undefined, sections, classes, matieres, personnels: personnels.map(sansMarque), programme,
               eleves: eleves.map(sansMarque), notes },
  }
}

// --- Enregistrement par étapes ----------------------------------------------------------------------------------------
// Chaque appel reste court (limite de durée des requêtes du serveur) : structure, puis personnel, programme, élèves et notes par lots.
// Le fichier a déjà été contrôlé et complété ; chaque lot est lui-même tout ou rien, et un réimport ne crée aucun doublon.
export const LOTS = { personnels: 25, programme: 250, eleves: 500, notes: 10000 }

/** Découpe les données contrôlées en appels successifs à importer_ecole, dans l'ordre des dépendances. */
export function decouperImport(d) {
  const annee = d.annee ? { annee: d.annee } : {}
  const etapes = [{ ...annee, sections: d.sections || [], classes: d.classes || [], matieres: d.matieres || [] }]
  for (const cle of ["personnels", "programme", "eleves", "notes"]) {
    const liste = d[cle] || []
    for (let i = 0; i < liste.length; i += LOTS[cle]) etapes.push({ ...annee, [cle]: liste.slice(i, i + LOTS[cle]) })
  }
  return etapes
}

/** Additionne les bilans renvoyés par chaque étape. */
export function cumulerBilan(total, r) {
  const b = total || { annee: null, annee_creee: false, codes: [] }
  for (const [cle, v] of Object.entries(r || {})) {
    if (cle === "codes") b.codes = [...b.codes, ...(v || [])]
    else if (cle === "annee_creee") b.annee_creee = b.annee_creee || !!v
    else if (cle === "annee") b.annee = v || b.annee
    else if (v && typeof v === "object") { b[cle] = b[cle] || {}; for (const [k, n] of Object.entries(v)) b[cle][k] = (b[cle][k] || 0) + (Number(n) || 0) }
  }
  return b
}

/** Données déjà enregistrées, utiles au contrôle du fichier. seulement : id de la personne qui n'importe que ses matières. */
export async function chargerExistant(exercice, { seulement } = {}) {
  const [sections, classes, matieres, personnels, eleves, attributions, inscrits, sequences] = await Promise.all([
    supabase.from("sections").select("libelle, ordre").then(verifier),
    supabase.from("classes").select("libelle, ordre").then(verifier),
    supabase.from("matieres").select("code, libelle").then(verifier),
    supabase.from("personnels").select("nom, prenom, role, matricule, actif").then(verifier),
    toutCharger(() => supabase.from("eleves").select("matricule, nom, prenom")),
    exercice ? toutCharger(() => supabase.from("attributions").select("coefficient, enseignant_id, classes(libelle), matieres(code)").eq("exercice_id", exercice.id)) : [],
    exercice ? toutCharger(() => supabase.from("inscriptions").select("eleves(matricule), classes(libelle)").eq("exercice_id", exercice.id)) : [],
    exercice ? supabase.from("sequences").select("numero, verrouillee").eq("exercice_id", exercice.id).then(verifier) : [],
  ])
  const elevesNoms = new Map()
  for (const e of eleves) for (const n of new Set([normaliser(`${e.nom} ${e.prenom}`), normaliser(`${e.prenom} ${e.nom}`), normaliser(e.nom)])) {
    if (n) elevesNoms.set(n, [...(elevesNoms.get(n) || []), e.matricule])
  }
  const lien = (a) => ({ classe: a.classes.libelle, code: a.matieres.code, coefficient: a.coefficient })
  return { exercice, sections, classes, matieres, personnels, eleves: eleves.map((e) => e.matricule), elevesNoms,
           classesEleves: Object.fromEntries(inscrits.filter((i) => i.eleves && i.classes).map((i) => [i.eleves.matricule, i.classes.libelle])),
           sequencesVerrouillees: sequences.filter((x) => x.verrouillee).map((x) => x.numero),
           seulement: seulement || null,
           attributions: attributions.filter((a) => !seulement || a.enseignant_id === seulement).map(lien), attributionsTout: attributions.map(lien) }
}

// --- Export d'une liste (même présentation que l'import : le fichier exporté sert de modèle) ---------------------------
const jourExcel = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z") : null)
const ouiNon = (b) => (b ? t("Oui") : t("Non"))

export const ENTETES = {
  eleves: ["Matricule", "Nom", "Prénom", "Sexe", "Date de naissance", "Lieu de naissance", "Contact du parent", "Classe", "Redoublant", "Nouvel élève"],
  classes: ["Classe", "Niveau", "Section", "Cycle", "Ordre"],
  matieres: ["Code", "Matière"],
  personnels: ["Matricule du personnel", "Nom", "Prénom", "Fonction", "Téléphone", "Poste / spécialité"],
  programme: ["Classe", "Code matière", "Matière", "Coefficient", "Groupe", "Enseignant"],
  notes: ["Classe", "Séquence", "Matricule", "Élève", "Code matière", "Note"],
}
export const LISTES = {
  eleves: { titre: "Élèves", intitule: "Liste des élèves", fichier: "eleves" },
  classes: { titre: "Classes", intitule: "Liste des classes", fichier: "classes" },
  matieres: { titre: "Matières", intitule: "Liste des matières", fichier: "matieres" },
  personnels: { titre: "Personnel", intitule: "Liste du personnel", fichier: "personnel" },
  programme: { titre: "Matières par classe", intitule: "Matières, coefficients et enseignants par classe", fichier: "matieres-par-classe" },
  notes: { titre: "Notes", intitule: "Notes des élèves (sur 20)", fichier: "notes" },
}

const tout = (table, colonnes, filtre = (q) => q) => toutCharger(() => filtre(supabase.from(table).select(colonnes)).order("id"))
const ordreClasses = (classes) => { const o = new Map(classes.map((c) => [c.id, c])); return (a, b) => ((o.get(a)?.ordre ?? 0) - (o.get(b)?.ordre ?? 0)) || comparerNoms(o.get(a)?.libelle || "", o.get(b)?.libelle || "") }

/** Lignes de la liste « cle » (en-têtes ENTETES[cle]). options : { exercice, classeId, code, sequence, seulement }. */
export async function lignesListe(cle, { exercice, classeId, code, sequence, seulement } = {}) {
  const classes = cle === "matieres" || cle === "personnels" ? [] : await tout("classes", "id, libelle, niveau, ordre, cycle, section_id")
  const cla = new Map(classes.map((c) => [c.id, c])), triClasse = ordreClasses(classes)
  if (cle === "classes") {
    const sec = new Map((await tout("sections", "id, libelle")).map((x) => [x.id, x.libelle]))
    return [...classes].sort((a, b) => triClasse(a.id, b.id)).map((c) => [c.libelle, c.niveau, sec.get(c.section_id) || "", c.cycle, c.ordre])
  }
  if (cle === "matieres") return (await tout("matieres", "code, libelle")).sort((a, b) => comparerNoms(a.code, b.code)).map((m) => [m.code, m.libelle])
  if (cle === "personnels") {
    return (await tout("personnels", "nom, prenom, role, matricule, telephone, poste, actif")).filter((p) => p.actif)
      .sort((a, b) => comparerNoms(a.matricule || "~", b.matricule || "~") || comparerNoms(nomComplet(a), nomComplet(b)))
      .map((p) => [p.matricule, p.nom, p.prenom, t(ROLES_IMPORT[p.role] || p.role), p.telephone, p.poste])
  }
  if (cle === "eleves") {
    const eleves = await tout("eleves", "id, matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent")
    const ins = new Map((exercice ? await tout("inscriptions", "eleve_id, classe_id, redoublant, nouveau", (q) => q.eq("exercice_id", exercice.id)) : [])
      .map((i) => [i.eleve_id, i]))
    return eleves.map((e) => ({ e, i: ins.get(e.id) })).filter(({ i }) => !classeId || i?.classe_id === classeId)
      .sort((a, b) => (a.i && b.i ? triClasse(a.i.classe_id, b.i.classe_id) : a.i ? -1 : b.i ? 1 : 0) || comparerNoms(nomComplet(a.e), nomComplet(b.e)))
      .map(({ e, i }) => [e.matricule, e.nom, e.prenom, e.sexe, jourExcel(e.date_naissance), e.lieu_naissance, e.telephone_parent,
                          cla.get(i?.classe_id)?.libelle || "", i ? ouiNon(i.redoublant) : "", i ? ouiNon(i.nouveau) : ""])
  }
  if (!exercice) return []
  const [matieres, attributionsTout] = await Promise.all([tout("matieres", "id, code, libelle"),
    tout("attributions", "id, classe_id, matiere_id, enseignant_id, coefficient, groupe", (q) => q.eq("exercice_id", exercice.id))])
  const mat = new Map(matieres.map((m) => [m.id, m]))
  const triAttr = (a, b) => triClasse(a.classe_id, b.classe_id) || a.groupe - b.groupe || comparerNoms(mat.get(a.matiere_id)?.code || "", mat.get(b.matiere_id)?.code || "")
  if (cle === "programme") {
    const per = new Map((await tout("personnels", "id, nom, prenom, matricule")).map((p) => [p.id, p]))
    return [...attributionsTout].filter((a) => !classeId || a.classe_id === classeId).sort(triAttr).map((a) => {
      const p = per.get(a.enseignant_id)
      return [cla.get(a.classe_id)?.libelle, mat.get(a.matiere_id)?.code, mat.get(a.matiere_id)?.libelle, a.coefficient, a.groupe, p ? p.matricule || nomComplet(p) : ""]
    })
  }
  // notes : une ligne par élève, matière et séquence (note vide si elle n'est pas encore saisie), pour remplir et réimporter
  const attributions = attributionsTout.filter((a) => (!classeId || a.classe_id === classeId) && (!code || mat.get(a.matiere_id)?.code === code)
    && (!seulement || a.enseignant_id === seulement)).sort(triAttr)
  const sequences = (await tout("sequences", "id, numero", (q) => q.eq("exercice_id", exercice.id))).filter((x) => !sequence || x.numero === Number(sequence))
    .sort((a, b) => a.numero - b.numero)
  if (!attributions.length || !sequences.length) return []
  const classesVoulues = new Set(attributions.map((a) => a.classe_id))
  const inscrits = (await tout("inscriptions", "id, classe_id, eleves(matricule, nom, prenom)", (q) => q.eq("exercice_id", exercice.id)))
    .filter((i) => classesVoulues.has(i.classe_id) && i.eleves).sort((a, b) => comparerNoms(nomComplet(a.eleves), nomComplet(b.eleves)))
  const ids = attributions.map((a) => a.id)
  const notes = await tout("notes", "inscription_id, attribution_id, sequence_id, valeur",
    (q) => (ids.length <= 60 ? q.in("attribution_id", ids) : q).in("sequence_id", sequences.map((x) => x.id)))
  const valeur = new Map(notes.map((n) => [`${n.inscription_id}|${n.attribution_id}|${n.sequence_id}`, Number(n.valeur)]))
  const lignes = []
  for (const s of sequences) for (const a of attributions) for (const i of inscrits) {
    if (i.classe_id !== a.classe_id) continue
    lignes.push([cla.get(a.classe_id)?.libelle, s.numero, i.eleves.matricule, nomComplet(i.eleves), mat.get(a.matiere_id)?.code,
                 valeur.get(`${i.id}|${a.id}|${s.id}`) ?? null])
  }
  return lignes
}

/** Télécharge la liste « cle » au format de l'import. */
export async function exporterListe(cle, options = {}, suffixe = "") {
  const lignes = await lignesListe(cle, options)
  await telechargerClasseur([{ titre: t(LISTES[cle].titre), intitule: t(LISTES[cle].intitule), entetes: ENTETES[cle].map((e) => t(e)), lignes }],
    `${LISTES[cle].fichier}${suffixe ? "-" + normaliser(suffixe) : ""}`)
  return lignes.length
}
