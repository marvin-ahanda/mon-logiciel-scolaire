import { describe, expect, it, vi } from "vitest"
vi.stubGlobal("navigator", { languages: ["fr-FR"] })        // messages vérifiés en français
vi.mock("../supabase.js", () => ({ supabase: {}, toutCharger: vi.fn(), verifier: (x) => x }))
const { analyserEcole, enCycle, enRole } = await import("./ecoleExcel.js")

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
})
