// Fichier Excel complet de l'établissement : modèle à remplir, lecture et contrôle avant import, export de toutes les données.
import { locale, t } from "../i18n.jsx"
import { COLONNES_PERSONNEL } from "./colonnes.js"
import { enDate, enOuiNon, enSexe, extraireLignes, lireFeuilles, normaliser, telechargerClasseur, texte } from "./excel.js"
import { comparerNoms, nomComplet } from "./format.js"
import { supabase, toutCharger, verifier } from "../supabase.js"

export const TAILLE_MAX_ECOLE = 5 * 1024 * 1024

// --- Feuilles reconnues à l'import (noms et en-têtes en français ou en anglais) ------------------------------------
const FEUILLES = {
  sections: { noms: ["Sections", "Liste des sections"], obligatoires: ["libelle"],
    colonnes: { libelle: ["Section", "Nom de la section", "Libellé"], ordre: ["Ordre", "Ordre d'affichage", "Order"] } },
  classes: { noms: ["Classes", "Liste des classes"], obligatoires: ["libelle"],
    colonnes: { libelle: ["Classe", "Class", "Libellé"], niveau: ["Niveau", "Level"], section: ["Section"], cycle: ["Cycle"],
                ordre: ["Ordre", "Ordre d'affichage", "Order"] } },
  matieres: { noms: ["Matières", "Matieres", "Subjects", "Liste des matières"], obligatoires: ["code", "libelle"],
    colonnes: { code: ["Code", "Code matière", "Subject code"], libelle: ["Matière", "Subject", "Libellé", "Nom de la matière"] } },
  personnels: { noms: ["Personnel", "Staff", "Liste du personnel"], obligatoires: ["nom", "role"],
    colonnes: { nom: ["Nom", "Last name", "Surname"], prenom: ["Prénom", "Prenom", "First name"], role: ["Fonction", "Rôle", "Role", "Function"],
                matricule: ["Matricule du personnel", "Matricule", "Staff ID"], telephone: ["Téléphone", "Telephone", "Phone"] } },
  programme: { noms: ["Matières par classe", "Matieres par classe", "Subjects per class", "Programme", "Coefficients"],
    obligatoires: ["classe", "matiere", "coefficient"],
    colonnes: { classe: ["Classe", "Class"], matiere: ["Code matière", "Matière", "Subject code", "Subject", "Code"],
                coefficient: ["Coefficient", "Coef", "Coef."], groupe: ["Groupe", "Group"], enseignant: ["Enseignant", "Teacher", "Professeur"],
                annee: ["Année scolaire", "School year"] } },
  eleves: { noms: ["Élèves", "Eleves", "Students", "Liste des élèves"], obligatoires: ["matricule", "nom", "sexe"],
    colonnes: { matricule: ["Matricule", "Student ID"], nom: ["Nom", "Last name", "Surname"], prenom: ["Prénom", "Prenom", "First name"],
                sexe: ["Sexe", "Sex", "Gender"], date_naissance: ["Date de naissance", "Né le", "Ne le", "Date of birth"],
                lieu_naissance: ["Lieu de naissance", "Place of birth"],
                telephone_parent: ["Contact du parent", "Parent's contact", "Parent contact", "Téléphone du parent", "Téléphone", "Telephone", "Parent's phone", "Phone"],
                classe: ["Classe", "Class"], redoublant: ["Redoublant", "Repeater", "Repeating"], nouveau: ["Nouvel élève", "Nouveau", "New student", "New"] } },
}

export const ROLES_IMPORT = { admin: "Administration", enseignant: "Enseignant", surveillant: "Surveillant général", comptable: "Comptable / caissier" }

export function enRole(v) {
  const n = normaliser(v)
  if (!n) return null
  if (["administration", "admin", "administrateur", "administrator", "directeur", "directrice", "principal", "proviseur", "chefdetablissement"].includes(n)) return "admin"
  if (["enseignant", "enseignante", "professeur", "prof", "teacher"].includes(n)) return "enseignant"
  if (["surveillant", "surveillantgeneral", "surveillante", "surveillantegenerale", "disciplinemaster", "surveillance"].includes(n)) return "surveillant"
  if (["comptable", "caissier", "caissiere", "comptablecaissier", "econome", "intendant", "bursar", "accountant", "cashier", "bursarcashier", "accountantcashier"].includes(n)) return "comptable"
  return null
}

export function enCycle(v) {
  const n = normaliser(v)
  if (!n) return undefined
  if (["1", "premier", "premiercycle", "1ercycle", "1er", "first", "firstcycle"].includes(n)) return 1
  if (["2", "second", "secondcycle", "2ndcycle", "2nd", "2e", "2ecycle", "deuxieme", "deuxiemecycle", "secondcycle"].includes(n)) return 2
  return null
}

const entier = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return undefined
  const n = Number(String(v).trim().replace(",", "."))
  return Number.isInteger(n) ? n : null
}

// --- Modèle à télécharger -------------------------------------------------------------------------------------------
export function modeleEcole() {
  return telechargerClasseur([
    { titre: t("Sections"), entetes: [t("Section"), t("Ordre")], lignes: [[t("Francophone"), 1], [t("Anglophone"), 2]] },
    { titre: t("Classes"), entetes: [t("Classe"), t("Niveau"), t("Section"), t("Cycle"), t("Ordre")],
      lignes: [["6e A", "6e", t("Francophone"), 1, 1], ["2nde C", "2nde", t("Francophone"), 2, 2], ["Form 1", "Form 1", t("Anglophone"), 1, 3]] },
    { titre: t("Matières"), entetes: [t("Code"), t("Matière")], lignes: [["MATH", t("Mathématiques")], ["FR", t("Français")], ["ANG", t("Anglais")]] },
    { titre: t("Personnel"), entetes: [t("Nom"), t("Prénom"), t("Fonction"), t("Matricule du personnel"), t("Téléphone")],
      lignes: [["MBALLA", "Jean", t("Enseignant"), "P001", "+237 690 000 000"], ["NGO", "Marie", t("Surveillant général"), "P002", ""],
               ["ESSOMBA", "Claire", t("Comptable / caissier"), "P003", ""]] },
    { titre: t("Matières par classe"), entetes: [t("Classe"), t("Code matière"), t("Coefficient"), t("Groupe"), t("Enseignant")],
      lignes: [["6e A", "MATH", 4, 1, "P001"], ["6e A", "FR", 4, 1, ""], ["6e A", "ANG", 2, 1, ""], ["Form 1", "MATH", 4, 1, "MBALLA Jean"]] },
    { titre: t("Élèves"), entetes: [t("Matricule"), t("Nom"), t("Prénom"), t("Sexe"), t("Date de naissance"), t("Lieu de naissance"),
                                     t("Contact du parent"), t("Classe"), t("Redoublant"), t("Nouvel élève")],
      lignes: [["2026-0001", "NGONO", "Marie", "F", new Date(Date.UTC(2014, 1, 14)), t("Yaoundé"), "+237 677 000 000", "6e A", t("Non"), t("Oui")],
               ["2026-0002", "SMITH", "John", "M", new Date(Date.UTC(2014, 5, 3)), "Bamenda", "+237 655 000 000", "Form 1", t("Non"), t("Non")]] },
    { titre: t("Mode d'emploi"), entetes: [t("Consignes")], largeurs: [120], lignes: [
      [t("Remplissez les feuilles utiles (vous pouvez en laisser vides) sans changer les titres des colonnes, puis importez le fichier.")],
      [t("Sections et Classes : le nom de la section d'une classe doit figurer dans la feuille Sections (ou exister déjà). Cycle : 1 (premier) ou 2 (second).")],
      [t("Personnel : Fonction = Administration, Enseignant, Surveillant général ou Comptable / caissier. Chaque nouveau membre reçoit un code personnel affiché à la fin de l'import.")],
      [t("Matières par classe : une ligne par matière enseignée dans une classe, avec son coefficient (1 à 20), son groupe (1 à 3) et, si vous le souhaitez, l'enseignant (matricule ou NOM Prénom).")],
      [t("Élèves : Matricule, Nom et Sexe (M ou F) obligatoires ; date de naissance au format jj/mm/aaaa ; Redoublant et Nouvel élève : Oui ou Non.")],
      [t("Ce qui existe déjà est reconnu et mis à jour (même classe, même code de matière, même matricule) ; le personnel déjà présent n'est jamais modifié.")],
      [t("L'import est tout ou rien : s'il reste une erreur, rien n'est enregistré et les lignes à corriger sont indiquées.")],
    ] }], "modele-ecole-complete")
}

// --- Lecture et contrôle ----------------------------------------------------------------------------------------------
/** Lit le classeur et range chaque feuille reconnue. */
export async function lireEcole(fichier) {
  const feuilles = await lireFeuilles(fichier, TAILLE_MAX_ECOLE)
  const lu = {}, ignorees = []
  for (const f of feuilles) {
    const n = normaliser(f.nom)
    const cle = Object.keys(FEUILLES).find((k) => FEUILLES[k].noms.some((x) => normaliser(x) === n))
    if (!cle) { if (!["modedemploi", "consignes", "instructions", "sommaire", "summary"].includes(n)) ignorees.push(f.nom); continue }
    const def = FEUILLES[cle]
    const r = extraireLignes(f.data, def.colonnes, def.obligatoires)
    lu[cle] = r ? { nom: f.nom, ...r } : { nom: f.nom, lignes: [], introuvable: true }
  }
  return { lu, ignorees }
}

/**
 * Contrôle le contenu lu par rapport aux données déjà enregistrées et prépare l'envoi.
 * existant : { exercice, sections, classes, matieres, personnels, eleves (matricules), attributions }
 */
export function analyserEcole({ lu, ignorees }, existant, annee) {
  const erreurs = []
  const err = (cle, numero, message) => erreurs.push({ feuille: lu[cle]?.nom || cle, ligne: numero, message })
  for (const [cle, f] of Object.entries(lu)) {
    if (f.introuvable) err(cle, null, t("en-têtes non reconnus : utilisez le modèle ({v0})", { v0: FEUILLES[cle].obligatoires.join(", ") }))
  }
  if (!Object.values(lu).some((f) => f.lignes.length)) {
    erreurs.push({ feuille: "", ligne: null, message: t("Aucune feuille reconnue (Sections, Classes, Matières, Personnel, Matières par classe, Élèves) : utilisez le modèle.") })
  }
  const lignes = (cle) => lu[cle]?.lignes || []

  // Sections
  const sections = [], nomsSections = new Map(existant.sections.map((s) => [normaliser(s.libelle), s.libelle]))
  const sectionsFichier = new Set()
  for (const { numero, valeurs: v } of lignes("sections")) {
    const libelle = texte(v.libelle, 61), ordre = entier(v.ordre)
    if (!libelle) { err("sections", numero, t("nom de section manquant")); continue }
    if (libelle.length > 60) err("sections", numero, t("nom de section trop long (60 caractères au plus)"))
    if (sectionsFichier.has(normaliser(libelle))) err("sections", numero, t("section « {v0} » en double", { v0: libelle }))
    if (ordre === null) err("sections", numero, t("ordre : nombre entier attendu"))
    sectionsFichier.add(normaliser(libelle)); nomsSections.set(normaliser(libelle), libelle)
    sections.push({ libelle, ordre })
  }

  // Classes
  const classes = [], classesConnues = new Map(existant.classes.map((c) => [normaliser(c.libelle), c.libelle])), classesFichier = new Set()
  for (const { numero, valeurs: v } of lignes("classes")) {
    const libelle = texte(v.libelle, 51), section = texte(v.section), cycle = enCycle(v.cycle), ordre = entier(v.ordre)
    if (!libelle) { err("classes", numero, t("nom de classe manquant")); continue }
    if (libelle.length > 50) err("classes", numero, t("nom de classe trop long (50 caractères au plus)"))
    if (classesFichier.has(normaliser(libelle))) err("classes", numero, t("classe « {v0} » en double", { v0: libelle }))
    if (section && !nomsSections.has(normaliser(section))) err("classes", numero, t("section « {v0} » inconnue", { v0: section }))
    if (cycle === null) err("classes", numero, t("cycle « {v0} » : 1 ou 2 attendu", { v0: texte(v.cycle) }))
    if (ordre === null) err("classes", numero, t("ordre : nombre entier attendu"))
    classesFichier.add(normaliser(libelle)); classesConnues.set(normaliser(libelle), libelle)
    classes.push({ libelle, niveau: texte(v.niveau, 50), section: section ? nomsSections.get(normaliser(section)) : "", cycle, ordre })
  }

  // Matières
  const matieres = [], codes = new Map(existant.matieres.map((m) => [m.code.toUpperCase(), m.libelle])), codesFichier = new Set()
  for (const { numero, valeurs: v } of lignes("matieres")) {
    const code = texte(v.code).toUpperCase(), libelle = texte(v.libelle, 101)
    if (!code || code.length > 15) err("matieres", numero, t("code de matière manquant ou trop long (15 caractères au plus)"))
    if (!libelle || libelle.length > 100) err("matieres", numero, t("nom de matière manquant ou trop long"))
    if (code && codesFichier.has(code)) err("matieres", numero, t("code « {v0} » en double", { v0: code }))
    codesFichier.add(code); codes.set(code, libelle)
    matieres.push({ code, libelle })
  }
  const codeDeMatiere = (x) => {
    const brut = texte(x)
    if (codes.has(brut.toUpperCase())) return brut.toUpperCase()
    for (const [c, l] of codes) if (normaliser(l) === normaliser(brut)) return c
    return null
  }

  // Personnel
  const personnels = [], designations = new Map()   // « matricule » ou « NOM Prénom » normalisés -> rôle
  const designer = (p, role) => {
    if (p.matricule) designations.set(normaliser(p.matricule), role)
    designations.set(normaliser(`${p.nom} ${p.prenom || ""}`), role); designations.set(normaliser(`${p.prenom || ""} ${p.nom}`), role)
  }
  for (const p of existant.personnels.filter((x) => x.actif)) designer(p, p.role)
  const dejaLa = (p) => existant.personnels.some((x) => (p.matricule && x.matricule && normaliser(x.matricule) === normaliser(p.matricule))
    || normaliser(`${x.nom} ${x.prenom}`) === normaliser(`${p.nom} ${p.prenom}`))
  const personnesFichier = new Set()
  for (const { numero, valeurs: v } of lignes("personnels")) {
    const p = { nom: texte(v.nom, 150), prenom: texte(v.prenom, 150), role: enRole(v.role), matricule: texte(v.matricule, 30), telephone: texte(v.telephone, 30) }
    if (!p.nom) { err("personnels", numero, t("nom manquant")); continue }
    if (!p.role) err("personnels", numero, t("fonction « {v0} » inconnue (Administration, Enseignant, Surveillant général ou Comptable / caissier)", { v0: texte(v.role) }))
    const cle = normaliser(`${p.nom} ${p.prenom}`)
    if (personnesFichier.has(cle)) err("personnels", numero, t("« {v0} » en double", { v0: `${p.nom} ${p.prenom}`.trim() }))
    personnesFichier.add(cle)
    p.existe = dejaLa(p)
    if (!p.existe) designer(p, p.role)
    personnels.push(p)
  }

  // Matières par classe
  const programme = [], couples = new Set()
  // rôles qui peuvent recevoir une matière (paramètre de l'établissement)
  const rolesNotes = ["enseignant", "admin", ...(existant.notesSurveillants ? ["surveillant"] : []), ...(existant.notesComptables ? ["comptable"] : [])]
  // fichier exporté : plusieurs années possibles, seule la plus récente est reprise
  const anneesProgramme = [...new Set(lignes("programme").map((l) => texte(l.valeurs.annee)).filter(Boolean))].sort()
  const anneeRetenue = anneesProgramme.at(-1)
  for (const { numero, valeurs: v } of lignes("programme").filter((l) => !anneeRetenue || !texte(l.valeurs.annee) || texte(l.valeurs.annee) === anneeRetenue)) {
    const classe = texte(v.classe), code = codeDeMatiere(v.matiere), coefficient = entier(v.coefficient), groupe = entier(v.groupe) ?? 1
    const enseignant = texte(v.enseignant)
    if (!classe || !classesConnues.has(normaliser(classe))) err("programme", numero, t("classe « {v0} » inconnue", { v0: classe }))
    if (!code) err("programme", numero, t("matière « {v0} » inconnue (indiquez son code)", { v0: texte(v.matiere) }))
    if (!coefficient || coefficient < 1 || coefficient > 20) err("programme", numero, t("coefficient de 1 à 20 attendu"))
    if (!groupe || groupe < 1 || groupe > 3) err("programme", numero, t("groupe de 1 à 3 attendu"))
    if (enseignant) {
      const role = designations.get(normaliser(enseignant))
      if (!role) err("programme", numero, t("enseignant « {v0} » absent du personnel", { v0: enseignant }))
      else if (!rolesNotes.includes(role)) err("programme", numero, t("« {v0} » n'est ni enseignant ni administration", { v0: enseignant }))
    }
    const couple = `${normaliser(classe)}|${code}`
    if (code && couples.has(couple)) err("programme", numero, t("matière « {v0} » en double pour la classe {v1}", { v0: code, v1: classe }))
    couples.add(couple)
    programme.push({ classe: classesConnues.get(normaliser(classe)) || classe, matiere: code, coefficient, groupe, enseignant })
  }

  // Élèves
  const eleves = [], matricules = new Set(), connus = new Set(existant.eleves)
  for (const { numero, valeurs: v } of lignes("eleves")) {
    const e = { matricule: texte(v.matricule, 31), nom: texte(v.nom, 101), prenom: texte(v.prenom, 100), lieu_naissance: texte(v.lieu_naissance, 100),
                telephone_parent: texte(v.telephone_parent, 30) }
    if (!e.matricule) err("eleves", numero, t("matricule manquant"))
    else if (e.matricule.length > 30) err("eleves", numero, t("matricule trop long (30 caractères au plus)"))
    else if (matricules.has(e.matricule)) err("eleves", numero, t("matricule « {v0} » en double", { v0: e.matricule }))
    matricules.add(e.matricule)
    if (!e.nom) err("eleves", numero, t("nom manquant"))
    e.sexe = enSexe(v.sexe); if (!e.sexe) err("eleves", numero, t("sexe « {v0} » : M ou F attendu", { v0: texte(v.sexe) }))
    try { e.date_naissance = enDate(v.date_naissance) } catch (x) { err("eleves", numero, x.message) }
    const classe = texte(v.classe)
    if (classe && !classesConnues.has(normaliser(classe))) err("eleves", numero, t("classe « {v0} » inconnue", { v0: classe }))
    e.classe = classe ? classesConnues.get(normaliser(classe)) || classe : ""
    const red = enOuiNon(v.redoublant), nouv = enOuiNon(v.nouveau)
    if (red === null) err("eleves", numero, t("Redoublant : Oui ou Non attendu"))
    if (nouv === null) err("eleves", numero, t("Nouvel élève : Oui ou Non attendu"))
    if (red !== undefined && red !== null) e.redoublant = red
    if (nouv !== undefined && nouv !== null) e.nouveau = nouv
    e.existe = connus.has(e.matricule)
    eleves.push(e)
  }

  const besoinAnnee = !existant.exercice && (eleves.some((e) => e.classe) || programme.length > 0)
  if (besoinAnnee && !/^\d{4}-\d{4}$/.test(annee || "")) {
    erreurs.push({ feuille: "", ligne: null, message: t("Indiquez l'année scolaire à créer (par exemple 2026-2027) : aucune année n'est encore active.") })
  }

  // Résumé par classe : élèves du fichier, matières et coefficients (fichier + déjà enregistrés)
  const parClasse = new Map()
  const ligneClasse = (lib) => {
    const k = normaliser(lib)
    if (!parClasse.has(k)) parClasse.set(k, { classe: lib, eleves: 0, garcons: 0, filles: 0, matieres: new Map() })
    return parClasse.get(k)
  }
  for (const c of [...existant.classes.map((x) => x.libelle), ...classes.map((x) => x.libelle)]) ligneClasse(c)
  for (const a of existant.attributions) ligneClasse(a.classe).matieres.set(a.code, a.coefficient)
  for (const p of programme) if (p.matiere && classesConnues.has(normaliser(p.classe))) ligneClasse(p.classe).matieres.set(p.matiere, p.coefficient || 0)
  for (const e of eleves) if (e.classe) { const l = ligneClasse(e.classe); l.eleves++; if (e.sexe === "M") l.garcons++; if (e.sexe === "F") l.filles++ }
  const ordre = new Map([...existant.classes, ...classes].map((c, k) => [normaliser(c.libelle), c.ordre ?? k]))
  const resume = {
    annee: existant.exercice?.libelle || (besoinAnnee ? annee : ""), anneeACreer: besoinAnnee,
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
                     coefficients: [...l.matieres.values()].reduce((s, c) => s + c, 0) })),
    ignorees,
  }
  const sansMarque = ({ existe, ...x }) => x
  return {
    erreurs, resume,
    donnees: { annee: besoinAnnee ? annee : undefined, sections, classes, matieres, personnels: personnels.map(sansMarque), programme, eleves: eleves.map(sansMarque) },
  }
}

/** Données déjà enregistrées, utiles au contrôle du fichier. */
export async function chargerExistant(exercice, etablissement = {}) {
  const [sections, classes, matieres, personnels, eleves, attributions] = await Promise.all([
    supabase.from("sections").select("libelle, ordre").then(verifier),
    supabase.from("classes").select("libelle, ordre").then(verifier),
    supabase.from("matieres").select("code, libelle").then(verifier),
    supabase.from("personnels").select("nom, prenom, role, matricule, actif").then(verifier),
    toutCharger(() => supabase.from("eleves").select("matricule")),
    exercice ? toutCharger(() => supabase.from("attributions").select("coefficient, classes(libelle), matieres(code)").eq("exercice_id", exercice.id)) : [],
  ])
  return { exercice, sections, classes, matieres, personnels, eleves: eleves.map((e) => e.matricule),
           notesSurveillants: !!etablissement.notes_surveillants, notesComptables: !!etablissement.notes_comptables,
           attributions: attributions.map((a) => ({ classe: a.classes.libelle, code: a.matieres.code, coefficient: a.coefficient })) }
}

// --- Export de toutes les données ------------------------------------------------------------------------------------
const jourExcel = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00Z") : null)
const ouiNon = (b) => (b ? t("Oui") : t("Non"))
const dateHeureTexte = (d) => (d ? new Date(d).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "")

/** Exporte toutes les données de l'établissement dans un classeur, une feuille par catégorie. */
export async function exporterEcole(etablissement) {
  const tout = (table, colonnes, ordre = "id") => toutCharger(() => supabase.from(table).select(colonnes).order(ordre))
  const [exercices, sequences, sections, classes, matieres, attributions, personnels, eleves, inscriptions, notes, baremes, sanctions, infractions,
         absences, retards, incidents, frais, echeances, paiements, seuilsDiscipline, seuilsSanctions] = await Promise.all([
    tout("exercices", "id, libelle, actif, cree_le"), tout("sequences", "id, exercice_id, numero, trimestre, verrouillee, date_limite_notes"),
    tout("sections", "id, libelle, ordre"), tout("classes", "id, libelle, niveau, ordre, coef_min, section_id, cycle"), tout("matieres", "id, code, libelle"),
    tout("attributions", "id, exercice_id, classe_id, matiere_id, enseignant_id, coefficient, groupe"), tout("personnels", COLONNES_PERSONNEL),
    tout("eleves", "id, matricule, nom, prenom, sexe, date_naissance, lieu_naissance, telephone_parent, photo, cree_le"),
    tout("inscriptions", "id, exercice_id, classe_id, eleve_id, redoublant, nouveau"),
    tout("notes", "id, inscription_id, attribution_id, sequence_id, valeur, maj"),
    tout("parametres_discipline", "exercice_id, note_max, points_par_retard, points_par_heure", "exercice_id"), tout("sanctions", "id, libelle, points_perdus"),
    tout("infractions", "id, libelle, sanction_id"),
    tout("absences", "id, inscription_id, sequence_id, date, heures_non_justifiees, heures_justifiees, motif"),
    tout("retards", "id, inscription_id, sequence_id, date"), tout("incidents", "id, inscription_id, sequence_id, date, infraction_id, observation"),
    tout("frais_scolarite", "exercice_id, pension_nouveaux, pension_anciens", "exercice_id"), tout("echeances", "id, exercice_id, rang, libelle, montant, date_limite"),
    tout("paiements", "id, inscription_id, numero, montant, date_paiement, mode, reference, observation, saisi_par, cree_le"),
    tout("seuils_discipline", "etablissement_id, heures_non_justifiees", "etablissement_id"), tout("seuils_sanctions", "sanction_id, seuil", "sanction_id"),
  ])
  const par = (liste, cle = "id") => new Map(liste.map((x) => [x[cle], x]))
  const ex = par(exercices), seq = par(sequences), sec = par(sections), cla = par(classes), mat = par(matieres), att = par(attributions)
  const per = par(personnels), elv = par(eleves), ins = par(inscriptions), sanc = par(sanctions), infr = par(infractions)
  const actif = exercices.find((e) => e.actif)
  const annee = (id) => ex.get(id)?.libelle || ""
  const nomPersonnel = (id) => (per.get(id) ? nomComplet(per.get(id)) : "")
  const ordreClasse = (id) => cla.get(id)?.ordre ?? 0
  const triClasse = (a, b) => ordreClasse(a) - ordreClasse(b) || comparerNoms(cla.get(a)?.libelle || "", cla.get(b)?.libelle || "")
  const eleveDe = (insId) => elv.get(ins.get(insId)?.eleve_id)
  const classeDe = (insId) => cla.get(ins.get(insId)?.classe_id)?.libelle || ""
  const classeActuelle = new Map(inscriptions.filter((i) => i.exercice_id === actif?.id).map((i) => [i.eleve_id, i]))
  const parAnnee = (a, b) => comparerNoms(annee(b.exercice_id), annee(a.exercice_id))

  const classesTenues = new Map()
  for (const a of attributions.filter((x) => x.enseignant_id && x.exercice_id === actif?.id)
    .sort((x, y) => triClasse(x.classe_id, y.classe_id) || comparerNoms(mat.get(x.matiere_id)?.code || "", mat.get(y.matiere_id)?.code || ""))) {
    const l = classesTenues.get(a.enseignant_id) || []
    l.push(`${cla.get(a.classe_id)?.libelle} (${mat.get(a.matiere_id)?.code})`); classesTenues.set(a.enseignant_id, l)
  }
  const evenementsEleve = (liste) => liste.map((x) => ({ x, e: eleveDe(x.inscription_id) }))
    .sort((a, b) => String(b.x.date).localeCompare(String(a.x.date)) || comparerNoms(nomComplet(a.e || {}), nomComplet(b.e || {})))

  const feuilles = [
    { titre: t("Sommaire"), intitule: t("Données de l'établissement — {v0}", { v0: etablissement.nom }), entetes: [t("Rubrique"), t("Valeur")], largeurs: [34, 80],
      lignes: [[t("Établissement"), etablissement.nom], [t("Ville"), etablissement.ville], [t("Adresse"), etablissement.adresse], [t("Téléphone"), etablissement.telephone],
               [t("Devise"), etablissement.devise], [t("Chef d'établissement"), etablissement.nom_chef], [t("Site web"), etablissement.site_web || ""],
               [t("Année scolaire active"), actif?.libelle || ""], [t("Exporté le"), dateHeureTexte(new Date())], [],
               [t("Élèves"), eleves.length], [t("Personnel"), personnels.length], [t("Classes"), classes.length], [t("Matières"), matieres.length],
               [t("Notes"), notes.length], [t("Paiements"), paiements.length], [],
               [t("Remarque"), t("Les photos des élèves et le logo sont des fichiers : ils ne figurent pas dans ce classeur. Les codes d'accès ne sont jamais exportés.")]] },
    { titre: t("Années scolaires"), intitule: t("Liste des années scolaires"), entetes: [t("Année scolaire"), t("Active"), t("Séquences verrouillées"), t("Délais de saisie des notes")],
      lignes: [...exercices].sort((a, b) => comparerNoms(b.libelle, a.libelle)).map((e) => [e.libelle, ouiNon(e.actif),
        sequences.filter((s) => s.exercice_id === e.id && s.verrouillee).map((s) => s.numero).sort().join(", "),
        sequences.filter((s) => s.exercice_id === e.id && s.date_limite_notes).sort((a, b) => a.numero - b.numero)
          .map((s) => `S${s.numero} : ${new Date(s.date_limite_notes + "T00:00:00").toLocaleDateString(locale())}`).join(" ; ")]) },
    { titre: t("Sections"), intitule: t("Liste des sections"), entetes: [t("Section"), t("Ordre")],
      lignes: [...sections].sort((a, b) => a.ordre - b.ordre || comparerNoms(a.libelle, b.libelle)).map((s) => [s.libelle, s.ordre]) },
    { titre: t("Classes"), intitule: t("Liste des classes"), entetes: [t("Classe"), t("Niveau"), t("Section"), t("Cycle"), t("Ordre"), t("Coefficient minimum"), t("Élèves inscrits")],
      lignes: [...classes].sort((a, b) => triClasse(a.id, b.id)).map((c) => [c.libelle, c.niveau, sec.get(c.section_id)?.libelle || "", c.cycle, c.ordre, c.coef_min,
        inscriptions.filter((i) => i.exercice_id === actif?.id && i.classe_id === c.id).length]) },
    { titre: t("Matières"), intitule: t("Liste des matières"), entetes: [t("Code"), t("Matière")],
      lignes: [...matieres].sort((a, b) => comparerNoms(a.code, b.code)).map((m) => [m.code, m.libelle]) },
    { titre: t("Matières par classe"), intitule: t("Matières, coefficients et enseignants par classe"),
      entetes: [t("Année scolaire"), t("Classe"), t("Code matière"), t("Matière"), t("Coefficient"), t("Groupe"), t("Enseignant")],
      lignes: [...attributions].sort((a, b) => parAnnee(a, b) || triClasse(a.classe_id, b.classe_id) || a.groupe - b.groupe
          || comparerNoms(mat.get(a.matiere_id)?.code || "", mat.get(b.matiere_id)?.code || ""))
        .map((a) => [annee(a.exercice_id), cla.get(a.classe_id)?.libelle, mat.get(a.matiere_id)?.code, mat.get(a.matiere_id)?.libelle, a.coefficient, a.groupe,
                     nomPersonnel(a.enseignant_id)]) },
    { titre: t("Personnel"), intitule: t("Liste du personnel"),
      entetes: [t("Nom"), t("Prénom"), t("Fonction"), t("Matricule du personnel"), t("Téléphone"), t("Actif"), t("Connexion Google"), t("Classes tenues"), t("Dernière connexion"), t("Créé le")],
      lignes: [...personnels].sort((a, b) => comparerNoms(nomComplet(a), nomComplet(b))).map((p) => [p.nom, p.prenom, t(ROLES_IMPORT[p.role] || p.role), p.matricule,
        p.telephone, ouiNon(p.actif), ouiNon(p.compte_google), (classesTenues.get(p.id) || []).join(", "), dateHeureTexte(p.derniere_connexion), jourExcel(p.cree_le)]) },
    { titre: t("Élèves"), intitule: t("Liste des élèves"),
      entetes: [t("Matricule"), t("Nom"), t("Prénom"), t("Sexe"), t("Date de naissance"), t("Lieu de naissance"), t("Contact du parent"), t("Classe"),
                t("Redoublant"), t("Nouvel élève"), t("Photo")],
      lignes: eleves.map((e) => ({ e, i: classeActuelle.get(e.id) }))
        .sort((a, b) => (a.i && b.i ? triClasse(a.i.classe_id, b.i.classe_id) : a.i ? -1 : b.i ? 1 : 0) || comparerNoms(nomComplet(a.e), nomComplet(b.e)))
        .map(({ e, i }) => [e.matricule, e.nom, e.prenom, e.sexe, jourExcel(e.date_naissance), e.lieu_naissance, e.telephone_parent,
                            cla.get(i?.classe_id)?.libelle || "", i ? ouiNon(i.redoublant) : "", i ? ouiNon(i.nouveau) : "", ouiNon(e.photo)]) },
    { titre: t("Inscriptions"), intitule: t("Inscriptions de toutes les années scolaires"),
      entetes: [t("Année scolaire"), t("Classe"), t("Matricule"), t("Élève"), t("Redoublant"), t("Nouvel élève")],
      lignes: [...inscriptions].sort((a, b) => parAnnee(a, b) || triClasse(a.classe_id, b.classe_id) || comparerNoms(nomComplet(elv.get(a.eleve_id)), nomComplet(elv.get(b.eleve_id))))
        .map((i) => [annee(i.exercice_id), cla.get(i.classe_id)?.libelle, elv.get(i.eleve_id)?.matricule, nomComplet(elv.get(i.eleve_id)), ouiNon(i.redoublant), ouiNon(i.nouveau)]) },
    { titre: t("Notes"), intitule: t("Toutes les notes (sur 20)"),
      entetes: [t("Année scolaire"), t("Séquence"), t("Classe"), t("Matricule"), t("Élève"), t("Code matière"), t("Matière"), t("Coefficient"), t("Note"), t("Saisie le")],
      lignes: notes.map((n) => ({ n, a: att.get(n.attribution_id), s: seq.get(n.sequence_id), e: eleveDe(n.inscription_id) }))
        .sort((x, y) => parAnnee(x.a, y.a) || (x.s?.numero ?? 0) - (y.s?.numero ?? 0) || triClasse(x.a?.classe_id, y.a?.classe_id)
          || comparerNoms(mat.get(x.a?.matiere_id)?.code || "", mat.get(y.a?.matiere_id)?.code || "") || comparerNoms(nomComplet(x.e || {}), nomComplet(y.e || {})))
        .map(({ n, a, s, e }) => [annee(a?.exercice_id), s?.numero, cla.get(a?.classe_id)?.libelle, e?.matricule, nomComplet(e || {}), mat.get(a?.matiere_id)?.code,
                                  mat.get(a?.matiere_id)?.libelle, a?.coefficient, Number(n.valeur), jourExcel(n.maj)]) },
    { titre: t("Barème de discipline"), intitule: t("Barème de la note de discipline par année"),
      entetes: [t("Année scolaire"), t("Note maximale"), t("Points par retard"), t("Points par heure d'absence non justifiée")],
      lignes: [...baremes].sort(parAnnee).map((b) => [annee(b.exercice_id), Number(b.note_max), Number(b.points_par_retard), Number(b.points_par_heure)]) },
    { titre: t("Sanctions et infractions"), intitule: t("Infractions et sanctions associées"),
      entetes: [t("Infraction"), t("Sanction"), t("Points perdus")],
      lignes: [...infractions.map((i) => [i.libelle, sanc.get(i.sanction_id)?.libelle, Number(sanc.get(i.sanction_id)?.points_perdus ?? 0)]),
               ...sanctions.filter((s) => !infractions.some((i) => i.sanction_id === s.id)).map((s) => ["", s.libelle, Number(s.points_perdus)])]
        .sort((a, b) => comparerNoms(a[0], b[0]) || comparerNoms(a[1], b[1])) },
    { titre: t("Seuils d'alerte"), intitule: t("Seuils d'alerte de discipline (année en cours)"), entetes: [t("Critère"), t("Seuil")],
      lignes: [...(seuilsDiscipline[0]?.heures_non_justifiees ? [[t("Heures d'absence non justifiées (cumul)"), seuilsDiscipline[0].heures_non_justifiees]] : []),
               ...seuilsSanctions.map((x) => [t("Nombre de sanctions : {v0}", { v0: sanc.get(x.sanction_id)?.libelle || "" }), x.seuil])] },
    { titre: t("Absences"), intitule: t("Absences des élèves"),
      entetes: [t("Année scolaire"), t("Séquence"), t("Date"), t("Classe"), t("Matricule"), t("Élève"), t("Heures non justifiées"), t("Heures justifiées"), t("Motif")],
      lignes: evenementsEleve(absences).map(({ x, e }) => [annee(seq.get(x.sequence_id)?.exercice_id), seq.get(x.sequence_id)?.numero, jourExcel(x.date),
        classeDe(x.inscription_id), e?.matricule, nomComplet(e || {}), x.heures_non_justifiees, x.heures_justifiees, x.motif]) },
    { titre: t("Retards"), intitule: t("Retards des élèves"),
      entetes: [t("Année scolaire"), t("Séquence"), t("Date"), t("Classe"), t("Matricule"), t("Élève")],
      lignes: evenementsEleve(retards).map(({ x, e }) => [annee(seq.get(x.sequence_id)?.exercice_id), seq.get(x.sequence_id)?.numero, jourExcel(x.date),
        classeDe(x.inscription_id), e?.matricule, nomComplet(e || {})]) },
    { titre: t("Incidents"), intitule: t("Incidents disciplinaires (infractions et sanctions)"),
      entetes: [t("Année scolaire"), t("Séquence"), t("Date"), t("Classe"), t("Matricule"), t("Élève"), t("Infraction"), t("Sanction"), t("Observation")],
      lignes: evenementsEleve(incidents).map(({ x, e }) => [annee(seq.get(x.sequence_id)?.exercice_id), seq.get(x.sequence_id)?.numero, jourExcel(x.date),
        classeDe(x.inscription_id), e?.matricule, nomComplet(e || {}), infr.get(x.infraction_id)?.libelle, sanc.get(infr.get(x.infraction_id)?.sanction_id)?.libelle,
        x.observation]) },
    { titre: t("Frais de scolarité"), intitule: t("Frais de scolarité et échéancier"),
      entetes: [t("Année scolaire"), t("Rubrique"), t("Montant (FCFA)"), t("Date limite")],
      lignes: [...frais].sort(parAnnee).flatMap((f) => [
        [annee(f.exercice_id), t("Pension des nouveaux élèves"), f.pension_nouveaux, null], [annee(f.exercice_id), t("Pension des anciens élèves"), f.pension_anciens, null],
        ...echeances.filter((e) => e.exercice_id === f.exercice_id).sort((a, b) => a.rang - b.rang).map((e) => [annee(e.exercice_id), t(e.libelle), e.montant, jourExcel(e.date_limite)])]) },
    { titre: t("Paiements"), intitule: t("Paiements encaissés (reçus)"),
      entetes: [t("N° de reçu"), t("Date"), t("Année scolaire"), t("Classe"), t("Matricule"), t("Élève"), t("Montant (FCFA)"), t("Mode"), t("Référence"), t("Observation"), t("Encaissé par")],
      lignes: [...paiements].sort((a, b) => a.numero - b.numero).map((p) => {
        const i = ins.get(p.inscription_id), e = elv.get(i?.eleve_id)
        return [p.numero, jourExcel(p.date_paiement), annee(i?.exercice_id), cla.get(i?.classe_id)?.libelle, e?.matricule, nomComplet(e || {}), p.montant,
                t(MODES_EXPORT[p.mode] || p.mode), p.reference, p.observation, nomPersonnel(p.saisi_par)]
      }) },
  ]
  await telechargerClasseur(feuilles, `donnees-${normaliser(etablissement.nom).slice(0, 40) || "etablissement"}`)
  return { feuilles: feuilles.length, eleves: eleves.length, notes: notes.length }
}

const MODES_EXPORT = { especes: "Espèces", mobile_money: "Mobile money", virement: "Virement", cheque: "Chèque", autre: "Autre" }
