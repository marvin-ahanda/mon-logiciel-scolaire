// Documents financiers : montant en lettres et PDF (reçu, facture, bulletin de paie) réellement générés.
import { describe, expect, it, vi } from "vitest"
vi.stubGlobal("navigator", { languages: ["fr-FR"] })
vi.mock("../supabase.js", () => ({ supabase: {}, rpc: vi.fn(), toutCharger: vi.fn(), verifier: (x) => x }))
const { nombreEnLettres, montantEnLettres, recuFinancePdf, facturePdf, bulletinPaiePdf } = await import("./financeDocs.js")

const etablissement = { nom: "Collège Saint Michel", adresse: "BP 100", ville: "Yaoundé", telephone: "699 00 00 00" }
const eleve = { nom: "MBALLA", prenom: "Anne", matricule: "PF1", classe: "Tle A", annee: "2026-2027" }

describe("montant en lettres", () => {
  it.each([
    [0, "zéro"], [1, "un"], [16, "seize"], [21, "vingt et un"], [70, "soixante-dix"], [71, "soixante et onze"], [77, "soixante-dix-sept"],
    [80, "quatre-vingts"], [81, "quatre-vingt-un"], [91, "quatre-vingt-onze"], [100, "cent"], [200, "deux cents"], [201, "deux cent un"],
    [1000, "mille"], [1001, "mille un"], [2000, "deux mille"], [80000, "quatre-vingt mille"], [200000, "deux cent mille"],
    [205000, "deux cent cinq mille"], [1000000, "un million"], [2500000, "deux millions cinq cent mille"], [3000000000, "trois milliards"],
  ])("%i → %s", (n, attendu) => expect(nombreEnLettres(n)).toBe(attendu))
  it("libellé monétaire avec majuscule", () => expect(montantEnLettres(15000)).toBe("Quinze mille francs CFA"))
})

describe("PDF financiers", () => {
  it("reçu A5 d'une page avec QR code", async () => {
    const doc = await recuFinancePdf({ etablissement, eleve, reste: 70000, caissier: "OWONA Eric",
      paiement: { numero: 12, date: "2026-11-24", montant: 50000, mode: "mtn_momo", reference: "MP1", code_verif: "A".repeat(32), rubrique: "Pension / scolarité" } },
      { generer: true })
    expect(doc.getNumberOfPages()).toBe(1)
    expect(Math.round(doc.internal.pageSize.getWidth())).toBe(148)
  })
  it("facture A4 avec échéancier", async () => {
    const doc = await facturePdf({ etablissement, eleve, facture: { numero: 3, libelle: "Frais d'examen", montant_brut: 20000, emise_le: "2026-11-24", code_verif: "B".repeat(32) },
      situation: { remise: 0, du: 20000, paye: 0, reste: 20000, lignes: [{ libelle: "Tranche 1", date_limite: "2026-12-01", montant: 10000, paye: 0, reste: 10000 }] } }, { generer: true })
    expect(doc.getNumberOfPages()).toBe(1)
  })
  it("bulletin de paie : signale un paramètre non vérifié", async () => {
    const doc = await bulletinPaiePdf({ etablissement, employe: { nom: "NGONO Paule", matricule: "C1" },
      paie: { periode: "2026-11-01", numero: 1, brut: 215000, retenues: 13600, net: 201400, code_verif: "C".repeat(32), parametres_non_verifies: true,
        details: { lignes: [{ type: "base", libelle: "Salaire de base", montant: 200000 }, { type: "prime", libelle: "Responsabilité", montant: 15000 },
          { type: "retenue", libelle: "Avance", montant: 5000 }, { type: "cotisation_salariale", libelle: "Cotisation", montant: 8600, mode: "taux", valeur: 4, verifie: false }] } } },
      { generer: true })
    expect(doc.getNumberOfPages()).toBe(1)
  })
})
