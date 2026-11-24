// Relevés CSV : formats de dates et de montants, débit / crédit, lignes identiques, lignes illisibles.
import { describe, expect, it } from "vitest"
import { lireDate, lireMontant, lireReleve } from "./releve.js"

describe("relevé CSV", () => {
  it("lit les montants usuels", () => {
    expect(lireMontant("1 250")).toBe(1250)
    expect(lireMontant("-30 000,00")).toBe(-30000)
    expect(lireMontant("1.250.000,50")).toBe(1250001)
    expect(lireMontant("15000 FCFA")).toBe(15000)
    expect(lireMontant("abc")).toBeNull()
  })
  it("lit les dates usuelles", () => {
    expect(lireDate("24/11/2026")).toBe("2026-11-24")
    expect(lireDate("2026-11-24")).toBe("2026-11-24")
    expect(lireDate("5-1-26")).toBe("2026-01-05")
    expect(lireDate("hier")).toBeNull()
  })
  it("colonne Montant signée, séparateur point-virgule", () => {
    const r = lireReleve("Date;Libellé;Montant;Référence\n24/11/2026;VERSEMENT ESPECES;30 000;V1\n24/11/2026;FRAIS;-500;\n")
    expect(r.lignes).toEqual([
      { date: "2026-11-24", libelle: "VERSEMENT ESPECES", reference: "V1", montant: 30000, occurrence: 1 },
      { date: "2026-11-24", libelle: "FRAIS", reference: "", montant: -500, occurrence: 1 }])
    expect(r.erreurs).toEqual([])
  })
  it("colonnes Débit / Crédit, virgule, guillemets ; lignes identiques numérotées ; ligne illisible signalée", () => {
    const r = lireReleve('date,description,debit,credit\n2026-11-02,"Frais, tenue",500,\n2026-11-02,"Frais, tenue",500,\n2026-11-03,Versement,,"10000"\nxx,rien,,\n')
    expect(r.lignes.map((l) => [l.montant, l.occurrence])).toEqual([[-500, 1], [-500, 2], [10000, 1]])
    expect(r.erreurs).toEqual([5])
  })
  it("refuse un fichier sans colonne date ou montant", () => {
    expect(() => lireReleve("a;b\n1;2")).toThrow(/Colonnes introuvables/)
  })
})
