// Listes Excel de l'établissement, importées et exportées séparément (élèves, classes, matières, personnel, matières par classe, notes) :
// lecture, contrôle complet avant tout enregistrement, envoi par lots courts, et export au même format (l'export sert de modèle).
import { t } from "../i18n.jsx"
import { enDate, enNote, enOuiNon, enSexe, extraireLignes, lireFeuilles, normaliser, telechargerClasseur, texte } from "./excel.js"
import { comparerNoms, nomComplet } from "./format.js"
import { supabase, toutCharger, verifier } from "../supabase.js"

export const TAILLE_MAX_LISTE = 5 * 1024 * 1024

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
                matricule: ["Matricule du personnel", "Matricule", "Staff ID"], telephone: ["Téléphone", "Telephone", "Phone"],
                poste: ["Poste / spécialité", "Poste / spécialité (information)", "Poste ou spécialité", "Poste", "Spécialité", "Position", "Speciality"] } },
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
  // même présentation que la feuille « Notes » de l'export : un fichier exporté se réimporte tel quel
  notes: { noms: ["Notes", "Grades", "Marks", "Notes des élèves", "Liste des notes"], obligatoires: ["matricule", "matiere", "sequence", "note"],
    colonnes: { matricule: ["Matricule", "Student ID"], matiere: ["Code matière", "Matière", "Subject code", "Subject"],
                sequence: ["Séquence", "Sequence", "Séq.", "Seq"], note: ["Note", "Note /20", "Note sur 20", "Grade", "Grade /20", "Mark"],
                annee: ["Année scolaire", "School year"], classe: ["Classe", "Class"] } },
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

// --- Lecture d'une liste ----------------------------------------------------------------------------------------------
/** En-têtes acceptés pour une liste : ceux du modèle, plus leur traduction (un fichier exporté en anglais se réimporte). */
function colonnesDe(cle) {
  return Object.fromEntries(Object.entries(FEUILLES[cle].colonnes).map(([k, noms]) => [k, [...new Set([...noms, ...noms.map((n) => t(n))])]]))
}

/**
 * Lit la liste « cle » dans un classeur : la feuille qui porte son nom, sinon la première dont les en-têtes correspondent.
 * Renvoie { lu: { [cle]: { nom, lignes } }, ignorees: [] }, prêt pour analyserEcole.
 */
export async function lireListe(fichier, cle) {
  const feuilles = await lireFeuilles(fichier, TAILLE_MAX_LISTE)
  const def = FEUILLES[cle], colonnes = colonnesDe(cle), noms = new Set([...def.noms, ...def.noms.map((n) => t(n))].map(normaliser))
  const parNom = feuilles.find((f) => noms.has(normaliser(f.nom)))
  for (const f of parNom ? [parNom, ...feuilles.filter((x) => x !== parNom)] : feuilles) {
    const r = extraireLignes(f.data, colonnes, def.obligatoires)
    if (r) return { lu: { [cle]: { nom: f.nom, ...r } }, ignorees: [] }
  }
  throw new Error(t("Colonnes attendues introuvables ({v0}) : exportez la liste pour obtenir le modèle, puis complétez-le.",
    { v0: def.obligatoires.map((k) => colonnes[k][0]).join(", ") }))
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
    erreurs.push({ feuille: "", ligne: null, message: t("Le fichier ne contient aucune ligne à importer.") })
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
    if (section && !nomsSections.has(normaliser(section))) {
      if (lu.sections) err("classes", numero, t("section « {v0} » inconnue", { v0: section }))
      else if (section.length > 60) err("classes", numero, t("nom de section trop long (60 caractères au plus)"))
      else {      // liste des classes seule : la section est créée avec la classe
        sections.push({ libelle: section, ordre: existant.sections.length + sections.length + 1 }); nomsSections.set(normaliser(section), section)
      }
    }
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
    const p = { nom: texte(v.nom, 150), prenom: texte(v.prenom, 150), role: enRole(v.role), matricule: texte(v.matricule, 30), telephone: texte(v.telephone, 30),
                poste: texte(v.poste, 100) }
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

  // Notes (sur 20) de l'année active, ou de celle que l'import va créer
  const anneeCible = existant.exercice?.libelle || annee || ""
  const classeDe = new Map(Object.entries(existant.classesEleves || {}))
  for (const e of eleves) if (e.classe) classeDe.set(e.matricule, e.classe)
  const matriculesConnus = new Set([...existant.eleves, ...eleves.map((e) => e.matricule)])
  const offertes = new Set([...existant.attributions.map((a) => `${normaliser(a.classe)}|${a.code}`), ...programme.map((x) => `${normaliser(x.classe)}|${x.matiere}`)])
  const verrouillees = new Set(existant.sequencesVerrouillees || [])
  const notes = [], triplets = new Set()
  let autresAnnees = 0, vides = 0
  for (const { numero, valeurs: v } of lignes("notes")) {
    const an = texte(v.annee)
    if (an && anneeCible && normaliser(an) !== normaliser(anneeCible)) { autresAnnees++; continue }
    let valeur
    try { valeur = enNote(v.note) } catch (x) { err("notes", numero, x.message); continue }
    if (valeur === null) { vides++; continue }
    const matricule = texte(v.matricule, 31), code = codeDeMatiere(v.matiere), sequence = entier(v.sequence)
    if (!matricule) err("notes", numero, t("matricule manquant"))
    else if (!matriculesConnus.has(matricule)) err("notes", numero, t("élève « {v0} » inconnu : absent de la feuille Élèves et de l'établissement", { v0: matricule }))
    else if (!classeDe.get(matricule)) err("notes", numero, t("élève « {v0} » sans classe pour l'année {v1}", { v0: matricule, v1: anneeCible }))
    const classeIndiquee = texte(v.classe)
    if (classeIndiquee && classeDe.get(matricule) && normaliser(classeIndiquee) !== normaliser(classeDe.get(matricule))) {
      err("notes", numero, t("l'élève « {v0} » est inscrit en {v1}, pas en {v2}", { v0: matricule, v1: classeDe.get(matricule), v2: classeIndiquee }))
    }
    if (!code) err("notes", numero, t("matière « {v0} » inconnue (indiquez son code)", { v0: texte(v.matiere) }))
    else if (classeDe.get(matricule) && !offertes.has(`${normaliser(classeDe.get(matricule))}|${code}`)) {
      err("notes", numero, existant.seulement
        ? t("la matière {v0} ne vous est pas confiée en {v1}", { v0: code, v1: classeDe.get(matricule) })
        : t("la matière {v0} n'est pas enseignée en {v1} (feuille Matières par classe)", { v0: code, v1: classeDe.get(matricule) }))
    }
    if (!sequence || sequence < 1 || sequence > 6) err("notes", numero, t("séquence de 1 à 6 attendue"))
    else if (verrouillees.has(sequence)) err("notes", numero, t("la séquence {v0} est verrouillée : ses notes ne peuvent plus être modifiées", { v0: sequence }))
    const triplet = `${matricule}|${code}|${sequence}`
    if (triplets.has(triplet)) err("notes", numero, t("note en double (même élève, même matière, même séquence)"))
    triplets.add(triplet)
    notes.push([matricule, code, sequence, valeur])
  }

  const besoinAnnee = !existant.exercice && (eleves.some((e) => e.classe) || programme.length > 0 || notes.length > 0)
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
  const notesParClasse = new Map()
  for (const [matricule] of notes) { const c = normaliser(classeDe.get(matricule) || ""); if (c) notesParClasse.set(c, (notesParClasse.get(c) || 0) + 1) }
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
                     coefficients: [...l.matieres.values()].reduce((s, c) => s + c, 0), notes: notesParClasse.get(normaliser(l.classe)) || 0 })),
    notes: { total: notes.length, eleves: new Set(notes.map((n) => n[0])).size, sequences: [...new Set(notes.map((n) => n[2]))].sort((a, b) => a - b),
             autresAnnees, vides },
    ignorees,
  }
  const sansMarque = ({ existe, ...x }) => x
  return {
    erreurs, resume,
    donnees: { annee: besoinAnnee ? annee : undefined, sections, classes, matieres, personnels: personnels.map(sansMarque), programme, eleves: eleves.map(sansMarque), notes },
  }
}

// --- Enregistrement par étapes ----------------------------------------------------------------------------------------
// Chaque appel reste court (limite de durée des requêtes du serveur) : structure, puis personnel, programme, élèves et notes par lots.
// Le fichier a déjà été entièrement contrôlé ; chaque lot est lui-même tout ou rien, et un réimport ne crée aucun doublon.
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
    toutCharger(() => supabase.from("eleves").select("matricule")),
    exercice ? toutCharger(() => supabase.from("attributions").select("coefficient, enseignant_id, classes(libelle), matieres(code)").eq("exercice_id", exercice.id)) : [],
    exercice ? toutCharger(() => supabase.from("inscriptions").select("eleves(matricule), classes(libelle)").eq("exercice_id", exercice.id)) : [],
    exercice ? supabase.from("sequences").select("numero, verrouillee").eq("exercice_id", exercice.id).then(verifier) : [],
  ])
  return { exercice, sections, classes, matieres, personnels, eleves: eleves.map((e) => e.matricule),
           classesEleves: Object.fromEntries(inscrits.filter((i) => i.eleves && i.classes).map((i) => [i.eleves.matricule, i.classes.libelle])),
           sequencesVerrouillees: sequences.filter((x) => x.verrouillee).map((x) => x.numero),
           seulement: seulement || null,
           attributions: attributions.filter((a) => !seulement || a.enseignant_id === seulement)
             .map((a) => ({ classe: a.classes.libelle, code: a.matieres.code, coefficient: a.coefficient })) }
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
