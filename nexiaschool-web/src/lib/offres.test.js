import { describe, expect, it } from "vitest"
import { fonctionDuChemin, offreEffective, offreInclut, OFFRE_REQUISE, LIBELLES_FONCTIONS } from "./offres.js"

describe("offres", () => {
  it("chaque offre ouvre ses fonctions et celles des offres inférieures", () => {
    expect(offreInclut("decouverte", "finances")).toBe(false)
    expect(offreInclut("essentiel", "finances")).toBe(true)
    expect(offreInclut("essentiel", "smarteval")).toBe(false)
    expect(offreInclut("pro", "edt")).toBe(true)
    expect(offreInclut("pro", "ia")).toBe(false)
    expect(offreInclut("premium", "ia")).toBe(true)
    expect(offreInclut("decouverte", "appel")).toBe(true)          // fonction de base
  })
  it("une offre échue ou inconnue retombe sur Découverte", () => {
    expect(offreEffective({ offre: "pro", offre_expire_le: "2026-01-01T00:00:00Z" }, Date.parse("2026-02-01"))).toBe("decouverte")
    expect(offreEffective({ offre: "pro", offre_expire_le: "2026-03-01T00:00:00Z" }, Date.parse("2026-02-01"))).toBe("pro")
    expect(offreEffective({ offre: "premium", offre_expire_le: null })).toBe("premium")
    expect(offreEffective({})).toBe("decouverte")
    expect(offreEffective(null)).toBe("decouverte")
  })
  it("rubriques réservées d'après l'adresse", () => {
    expect(fonctionDuChemin("/finance/paiements")).toBe("finances")
    expect(fonctionDuChemin("/discipline/appel")).toBe(null)
    expect(fonctionDuChemin("/discipline/suivi")).toBe("discipline")
    expect(fonctionDuChemin("/smarteval/nouvelle")).toBe("smarteval")
    expect(fonctionDuChemin("/financement")).toBe(null)
    expect(fonctionDuChemin("/")).toBe(null)
  })
  it("chaque fonction a un libellé", () => {
    for (const f of Object.keys(OFFRE_REQUISE)) expect(LIBELLES_FONCTIONS[f]).toBeTruthy()
  })
})
