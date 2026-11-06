import { describe, expect, it, vi } from "vitest"
vi.stubGlobal("navigator", { languages: ["fr-FR"] })        // messages vérifiés en français
vi.mock("../supabase.js", () => ({ supabase: {}, toutCharger: vi.fn(), verifier: (x) => x }))
const { analyserEcole, cumulerBilan, decouperImport, enCycle, enRole, LOTS } = await import("./ecoleExcel.js")

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

  it("signale chaque erreur avec sa feuille et sa ligne", () => {
    const lu = {
      classes: L([{ libelle: "6e A", section: "Technique" }]),
      personnels: L([{ nom: "Ngo", role: "Cuisinier" }, { nom: "Ngo", role: "Surveillant" }]),
      programme: L([{ classe: "6e B", matiere: "XYZ", coefficient: 30 }, { classe: "6e A", matiere: "XYZ", coefficient: 2, enseignant: "Ngo" }]),
      eleves: L([{ matricule: "E1", nom: "A", sexe: "X", date_naissance: "31/02/2014" }, { matricule: "E1", nom: "B", sexe: "F", classe: "3e" }]),
    }
    const { erreurs } = analyserEcole({ lu, ignorees: [] }, vide, "")
    const textes = erreurs.map((e) => `${e.feuille}:${e.ligne}:${e.message}`)
    expect(textes).toEqual(expect.arrayContaining([
      expect.stringMatching(/^classes:2:section « Technique » inconnue/),
      expect.stringMatching(/^personnels:2:fonction « Cuisinier » inconnue/),
      expect.stringMatching(/^programme:2:classe « 6e B » inconnue/),
      expect.stringMatching(/^programme:2:coefficient de 1 à 20/),
      expect.stringMatching(/^programme:3:« Ngo » n'est ni enseignant ni administration/),
      expect.stringMatching(/^eleves:2:sexe « X »/),
      expect.stringMatching(/^eleves:2:date « 31\/02\/2014 » invalide/),
      expect.stringMatching(/^eleves:3:matricule « E1 » en double/),
      expect.stringMatching(/^eleves:3:classe « 3e » inconnue/),
      expect.stringMatching(/^:null:Indiquez l'année scolaire/),
    ]))
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
      { matricule: "E2", matiere: "ENG", sequence: 5, note: 9 }]) }, ignorees: [] },
      { ...vide, exercice: { libelle: "2026-2027" }, sequencesVerrouillees: [5] }, "")
    expect(mauvais.erreurs.map((e) => `${e.feuille}:${e.ligne}:${e.message}`)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^notes:2:élève « E9 » inconnu/),
      expect.stringMatching(/^notes:3:la matière ENG n'est pas enseignée en 6e A/),
      expect.stringMatching(/^notes:4:séquence de 1 à 6 attendue/),
      expect.stringMatching(/^notes:5:25 n'est pas compris entre 0 et 20/),
      expect.stringMatching(/^notes:7:note en double/),
      expect.stringMatching(/^notes:8:la séquence 5 est verrouillée/),
    ]))
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
