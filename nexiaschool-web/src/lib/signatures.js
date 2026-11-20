// Cachet et signature en service, lus par adresses temporaires (5 min) dans le compartiment privé « signatures »
// (réservé à l'administration). Utilisés pour les cartes scolaires et les certificats de distinction.
import { image } from "./bulletinPdf.js"
import { supabase, verifier } from "../supabase.js"

export async function signaturesEnService(liste = null) {
  const signatures = liste || await supabase.from("signatures_etablissement").select("type, chemin, statut").eq("statut", "active").then(verifier).catch(() => [])
  const r = {}
  for (const s of signatures.filter((x) => x.statut === "active")) {
    const { data } = await supabase.storage.from("signatures").createSignedUrl(s.chemin, 300)
    if (data?.signedUrl) r[s.type] = await image(data.signedUrl)
  }
  return r
}
