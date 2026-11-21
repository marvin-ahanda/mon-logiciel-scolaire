import { describe, expect, it, vi } from "vitest"
vi.mock("../supabase.js", () => ({ supabase: {}, toutCharger: vi.fn(), verifier: (x) => x }))
const { limiterInscriptions } = await import("./ecoleExcel.js")
import { estErreurCapacite, montantEtablissement } from "./offres.js"

const donnees = { eleves: [
  { matricule: "A1", classe: "6e" }, { matricule: "A2", classe: "6e" }, { matricule: "A3", classe: "5e" },
  { matricule: "A4", classe: null }, { matricule: "A5", classe: "5e" }], notes: [["A3", "MATH", 1, 12], ["A5", "MATH", 1, 14]] }

describe("capacité d'élèves", () => {
  it("compte les nouvelles inscriptions (élèves déjà inscrits et sans classe exclus)", () => {
    const r = limiterInscriptions(donnees, { A1: "6e" }, null)
    expect(r.nouvelles).toBe(3)
    expect(r.retirees).toBe(0)
    expect(r.donnees).toBe(donnees)
  })
  it("import partiel : garde les premières lignes dans la limite des places restantes", () => {
    const r = limiterInscriptions(donnees, { A1: "6e" }, 1)
    expect(r.retirees).toBe(2)
    expect(r.donnees.eleves.map((e) => e.matricule)).toEqual(["A1", "A2", "A4"])
    expect(r.donnees.notes).toEqual([])
  })
  it("aucune place : aucune nouvelle inscription, mises à jour conservées", () => {
    const r = limiterInscriptions(donnees, { A1: "6e" }, 0)
    expect(r.donnees.eleves.map((e) => e.matricule)).toEqual(["A1", "A4"])
  })
  it("reconnaît le message du serveur", () => {
    expect(estErreurCapacite("Vous avez atteint la limite d'élèves autorisée par votre abonnement actuel (50 élèves).")).toBe(true)
    expect(estErreurCapacite("Ce matricule est déjà attribué")).toBe(false)
  })
  it("tarif : minimum annuel, puis prix par élève", () => {
    const tarifs = { etablissement: { prix_eleve: 500, minimum_annuel: 50000 } }
    expect(montantEtablissement(40, tarifs)).toBe(50000)
    expect(montantEtablissement(100, tarifs)).toBe(50000)
    expect(montantEtablissement(250, tarifs)).toBe(125000)
    expect(montantEtablissement(0, tarifs)).toBe(0)
  })
})
