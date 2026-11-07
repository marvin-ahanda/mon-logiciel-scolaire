import { describe, expect, it, vi } from "vitest"
vi.stubGlobal("navigator", { languages: ["fr-FR"] })        // messages vérifiés en français
vi.mock("../supabase.js", () => ({ supabase: {}, toutCharger: vi.fn(), verifier: (x) => x }))
const { analyserEcole, cumulerBilan, decouperImport, enCycle, enRole, LOTS, reconnaitreListe } = await import("./ecoleExcel.js")

const L = (lignes) => ({ lignes: lignes.map((valeurs, k) => ({ numero: k + 2, valeurs })) })
const vide = { exercice: null, sections: [], classes: [], matieres: [], personnels: [{ nom: "AHANDA", prenom: "Marvin", role: "admin", matricule: "", actif: true }],
               eleves: [], attributions: [] }

describe("import du fichier complet", () => {
  it("reconnaît les rôles et les cycles en français et en anglais", () => {
    expect(enRole("Surveillant général")).toBe("surveillant")
    expect(enRole("Bursar / cashier")).toBe("comptable")
    expect(enRole("Teacher")).toBe("enseignant")
    expect(enRole("Directeur")).toBe("admin")
    expect(enRole("Cuisinier")).toBe(null)
    expect(enCycle("Premier cycle")).toBe(1)
    expect(enCycle("2")).toBe(2)
    expect(enCycle("")).toBe(undefined)
  })

  it("prépare les données et résume le fichier", () => {
    const lu = {
      sections: L([{ libelle: "Francophone", ordre: 1 }]),
      classes: L([{ libelle: "6e A", section: "francophone", cycle: "1", ordre: 1 }, { libelle: "5e A", section: "Francophone", cycle: 1, ordre: 2 }]),
      matieres: L([{ code: "math", libelle: "Mathématiques" }, { code: "FR", libelle: "Français" }]),
      personnels: L([{ nom: "Mballa", prenom: "Jean", role: "Enseignant", matricule: "P1" }, { nom: "Ahanda", prenom: "Marvin", role: "Administration" }]),
      programme: L([{ classe: "6e a", matiere: "Mathématiques", coefficient: 4, enseignant: "P1" }, { classe: "6e A", matiere: "FR", coefficient: "3", groupe: 2 }]),
      eleves: L([{ matricule: "E1", nom: "Ngono", sexe: "F", classe: "6E A", date_naissance: "14/02/2014", redoublant: "Oui" },
                 { matricule: 2, nom: "Bella", sexe: "garçon", classe: "5e A", nouveau: "non" }]),
    }
    const { erreurs, donnees, resume } = analyserEcole({ lu, ignorees: [] }, vide, "2026-2027")
    expect(erreurs).toEqual([])
    expect(donnees.annee).toBe("2026-2027")
    expect(donnees.programme[0]).toMatchObject({ classe: "6e A", matiere: "MATH", coefficient: 4, groupe: 1 })
    expect(donnees.eleves[0]).toMatchObject({ classe: "6e A", date_naissance: "2014-02-14", redoublant: true })
    expect(donnees.eleves[1]).toMatchObject({ matricule: "2", sexe: "M", nouveau: false })
    expect(donnees.eleves[1]).not.toHaveProperty("redoublant")
    expect(resume.personnels).toMatchObject({ total: 2, nouveaux: 1, existants: 1 })
    expect(resume.parClasse.find((c) => c.classe === "6e A")).toMatchObject({ eleves: 1, filles: 1, matieres: 2, coefficients: 7 })
  })

  it("accepte un fichier mal renseigné : complète, met de côté et signale ce qui est à compléter", () => {
    const lu = {
      classes: L([{ libelle: "6e A", section: "Technique", cycle: "trois" }, { libelle: "" }]),
      personnels: L([{ nom: "Ngo", role: "Cuisinier" }, { nom: "Ngo", role: "Surveillant" }, { prenom: "Paul", role: "Enseignant" }]),
      programme: L([{ classe: "6e B", code: "XYZ", matiere: "Dessin", coefficient: 30 }, { classe: "6e A", code: "XYZ", coefficient: "abc", enseignant: "Inconnu" },
                    { classe: "", code: "MATH" }]),
      eleves: L([{ matricule: "E1", nom: "A", sexe: "X", date_naissance: "31/02/2014" }, { matricule: "E1", nom: "B", sexe: "F", classe: "3e" },
                 { nom: "C", sexe: "M", redoublant: "peut-être" }, { prenom: "Inès", sexe: "f" }, { matricule: "E5" }, {}]),
    }
    const { erreurs, remarques, donnees, resume } = analyserEcole({ lu, ignorees: [] }, vide, "")
    expect(erreurs).toEqual([])
    const r = Object.fromEntries(remarques.map((x) => [x.code, x]))
    // classes : section créée, cycle illisible laissé vide, ligne sans nom ignorée
    expect(donnees.sections).toEqual([{ libelle: "Technique", ordre: 1 }])
    expect(donnees.classes.find((c) => c.libelle === "6e A")).toMatchObject({ section: "Technique", cycle: undefined })
    expect(r.classe_cycle.n).toBe(1)
    // personnel : fonction inconnue -> enseignant ; même personne deux fois -> la dernière ; prénom seul -> nom
    expect(donnees.personnels).toEqual([expect.objectContaining({ nom: "Ngo", role: "surveillant" }), expect.objectContaining({ nom: "Paul", role: "enseignant" })])
    expect(r.personnel_fonction.n).toBe(1)
    // matières par classe : classe et matière créées, coefficient ramené, enseignant introuvable laissé vide, ligne incomplète ignorée
    expect(donnees.classes.map((c) => c.libelle)).toEqual(expect.arrayContaining(["6e B", "3e"]))
    expect(donnees.matieres).toEqual([{ code: "XYZ", libelle: "Dessin" }])
    expect(donnees.programme).toEqual([expect.objectContaining({ classe: "6e B", matiere: "XYZ", coefficient: 20, enseignant: "" }),
                                       expect.objectContaining({ classe: "6e A", matiere: "XYZ", coefficient: 1, enseignant: "" })])
    expect(r.programme_coefficient.n).toBe(2); expect(r.programme_enseignant.n).toBe(1); expect(r.programme_incomplet.n).toBe(1)
    expect(r.classe_creee.exemples).toEqual(expect.arrayContaining(["6e B", "3e"]))
    // élèves : tout est importé ; sexe et date à préciser, matricules provisoires, nom à compléter
    expect(donnees.eleves).toHaveLength(5)
    expect(donnees.eleves[0]).toMatchObject({ matricule: "E1", nom: "A", sexe: null, date_naissance: null })
    expect(donnees.eleves[1]).toMatchObject({ matricule: "PROV-0001", nom: "B", sexe: "F", classe: "3e" })
    expect(donnees.eleves[2]).toMatchObject({ matricule: "PROV-0002", nom: "C", sexe: "M" })
    expect(donnees.eleves[2]).not.toHaveProperty("redoublant")
    expect(donnees.eleves[3]).toMatchObject({ nom: "Inès", sexe: "F" })
    expect(donnees.eleves[4]).toMatchObject({ matricule: "E5", nom: "À COMPLÉTER", sexe: null })
    expect(r.eleve_matricule.n).toBe(3); expect(r.eleve_sexe.n).toBe(2); expect(r.eleve_date.n).toBe(1); expect(r.eleve_nom.n).toBe(1)
    expect(r.ligne_vide.n).toBe(2)
    // aucune année active : l'année par défaut est créée plutôt que de bloquer
    expect(donnees.annee).toMatch(/^\d{4}-\d{4}$/); expect(resume.anneeACreer).toBe(true)
    // seul un fichier sans aucune ligne utilisable est refusé
    expect(analyserEcole({ lu: { eleves: L([{}]) }, ignorees: [] }, vide, "").erreurs).toHaveLength(1)
  })

  it("ne refuse un fichier que s'il ne correspond pas à la liste choisie", () => {
    const personnel = [["Liste du personnel"], [], ["Matricule du personnel", "Nom", "Prénom", "Fonction", "Téléphone", "Poste / spécialité"], ["P1", "NGO", "Marie", "Enseignant", "", ""]]
    const eleves = [["Nom", "Prénom", "Sexe", "Classe", "Date de naissance"], ["ABENA", "Lucie", "F", "6e A", "01/02/2014"]]
    const notes = [["Classe", "Séquence", "Matricule", "Élève", "Code matière", "Note"], ["6e A", 1, "E1", "ABENA Lucie", "MATH", 12]]
    expect(reconnaitreListe(personnel, "eleves").refus).toMatch(/ressemble à la liste « Personnel »/)
    expect(reconnaitreListe(personnel, "personnels")).toMatchObject({ h: 2 })
    expect(reconnaitreListe(eleves, "eleves").positions).toMatchObject({ nom: 0, prenom: 1, sexe: 2, classe: 3 })
    expect(reconnaitreListe(eleves, "classes").refus).toMatch(/ressemble à la liste « Élèves »/)
    expect(reconnaitreListe(notes, "eleves").refus).toMatch(/ressemble à la liste « Notes »/)
    expect(reconnaitreListe(notes, "notes").positions).toMatchObject({ matricule: 2, eleve: 3, code: 4, note: 5 })
    expect(reconnaitreListe([["Code", "Matière"], ["MATH", "Maths"]], "programme").refus).toMatch(/ne correspond pas à la liste « Matières par classe »/)
    expect(reconnaitreListe([["Code", "Matière"], ["MATH", "Maths"]], "matieres").positions).toMatchObject({ code: 0, libelle: 1 })
    expect(reconnaitreListe([["Bonjour"], ["rien"]], "eleves").refus).toMatch(/Aucune colonne reconnue/)
    // colonnes dans le désordre, en-têtes en anglais
    expect(reconnaitreListe([["Class", "Sex", "Last name", "Student ID"], ["6e A", "M", "BELLA", "E2"]], "eleves").positions)
      .toMatchObject({ classe: 0, sexe: 1, nom: 2, matricule: 3 })
  })

  it("ne reprend que l'année la plus récente d'un fichier exporté", () => {
    const lu = { classes: L([{ libelle: "6e A" }]), matieres: L([{ code: "MATH", libelle: "Maths" }]),
                 programme: L([{ annee: "2025-2026", classe: "6e A", matiere: "MATH", coefficient: 2 }, { annee: "2026-2027", classe: "6e A", matiere: "MATH", coefficient: 5 }]) }
    const { erreurs, donnees } = analyserEcole({ lu, ignorees: [] }, { ...vide, exercice: { id: "x", libelle: "2026-2027" } }, "")
    expect(erreurs).toEqual([])
    expect(donnees.programme).toEqual([expect.objectContaining({ coefficient: 5 })])
  })
  it("importe les notes de l'année et contrôle élève, matière de la classe, séquence et note", () => {
    const base = {
      classes: L([{ libelle: "6e A" }, { libelle: "Form 1" }]),
      matieres: L([{ code: "MATH", libelle: "Mathématiques" }, { code: "ENG", libelle: "English" }]),
      programme: L([{ classe: "6e A", matiere: "MATH", coefficient: 4 }, { classe: "Form 1", matiere: "ENG", coefficient: 5 }]),
      eleves: L([{ matricule: "E1", nom: "Ngono", sexe: "F", classe: "6e A" }, { matricule: "E2", nom: "Smith", sexe: "M", classe: "Form 1" }]),
    }
    const bon = analyserEcole({ lu: { ...base, notes: L([
      { matricule: "E1", matiere: "Mathématiques", sequence: 1, note: "12,5" }, { matricule: "E2", matiere: "eng", sequence: "2", note: 16 },
      { matricule: "E1", matiere: "MATH", sequence: 2, note: "" }, { annee: "2025-2026", matricule: "E1", matiere: "MATH", sequence: 1, note: 8 },
      { annee: "2026-2027", matricule: "E1", matiere: "MATH", sequence: 3, note: 0 }]) }, ignorees: [] }, vide, "2026-2027")
    expect(bon.erreurs).toEqual([])
    expect(bon.donnees.notes).toEqual([["E1", "MATH", 1, 12.5], ["E2", "ENG", 2, 16], ["E1", "MATH", 3, 0]])
    expect(bon.resume.notes).toMatchObject({ total: 3, eleves: 2, sequences: [1, 2, 3], autresAnnees: 1, vides: 1 })
    expect(bon.resume.parClasse.find((c) => c.classe === "6e A")).toMatchObject({ notes: 2 })

    const mauvais = analyserEcole({ lu: { ...base, notes: L([
      { matricule: "E9", matiere: "MATH", sequence: 1, note: 10 }, { matricule: "E1", matiere: "ENG", sequence: 1, note: 10 },
      { matricule: "E1", matiere: "MATH", sequence: 7, note: 10 }, { matricule: "E1", matiere: "MATH", sequence: 1, note: 25 },
      { matricule: "E2", matiere: "ENG", sequence: 4, note: 10 }, { matricule: "E2", matiere: "ENG", sequence: 4, note: 11 },
      { matricule: "E2", matiere: "ENG", sequence: 5, note: 9 }, { matricule: "X?", eleve: "Smith", matiere: "ENG", sequence: 1, note: 14, classe: "6e A" }]) }, ignorees: [] },
      { ...vide, exercice: { libelle: "2026-2027" }, sequencesVerrouillees: [5], elevesNoms: new Map([["smith", ["E2"]]]) }, "")
    // les notes utilisables passent ; les autres sont mises de côté et signalées
    expect(mauvais.erreurs).toEqual([])
    expect(mauvais.donnees.notes).toEqual([["E2", "ENG", 4, 11], ["E2", "ENG", 1, 14]])
    const r = Object.fromEntries(mauvais.remarques.map((x) => [x.code, x.n]))
    expect(r).toMatchObject({ notes_eleve: 1, notes_matiere: 1, notes_sequence: 2, notes_valeur: 1, doublon: 1, notes_matricule: 1, notes_classe: 1 })
  })
  it("découpe l'enregistrement en appels courts, dans l'ordre, et additionne les bilans", () => {
    const n = (k) => Array.from({ length: k }, (_, i) => i)
    const etapes = decouperImport({ annee: "2026-2027", sections: [1], classes: [2], matieres: [3], personnels: n(60), programme: n(260), eleves: n(1001), notes: n(25000) })
    expect(etapes.map((e) => Object.keys(e).filter((k) => k !== "annee").join("+"))).toEqual(
      ["sections+classes+matieres", "personnels", "personnels", "personnels", "programme", "programme", "eleves", "eleves", "eleves", "notes", "notes", "notes"])
    expect(etapes.every((e) => e.annee === "2026-2027")).toBe(true)
    expect(etapes[3].personnels).toHaveLength(60 - 2 * LOTS.personnels)
    expect(etapes.filter((e) => e.notes).flatMap((e) => e.notes)).toEqual(n(25000))
    const b = cumulerBilan(cumulerBilan(null, { annee: "2026-2027", annee_creee: true, eleves: { crees: 2, modifies: 1 }, codes: [{ nom: "A" }] }),
                           { annee: "2026-2027", annee_creee: false, eleves: { crees: 3, modifies: 0 }, notes: { crees: 7, modifies: 1 }, codes: [{ nom: "B" }] })
    expect(b).toMatchObject({ annee: "2026-2027", annee_creee: true, eleves: { crees: 5, modifies: 1 }, notes: { crees: 7, modifies: 1 } })
    expect(b.codes.map((c) => c.nom)).toEqual(["A", "B"])
  })
})
