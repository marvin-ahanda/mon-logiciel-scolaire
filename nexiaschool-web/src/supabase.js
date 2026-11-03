import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const cle = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !cle) {
  throw new Error("Configuration manquante : VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY (voir .env.example).")
}

export const supabase = createClient(url, cle, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "nexiaschool.session" },
})

/** Message d'erreur lisible à partir d'une erreur Supabase. */
export function messageErreur(e) {
  if (!e) return ""
  const m = e.message || String(e)
  if (/row-level security|permission denied|42501/i.test(m + (e.code || ""))) return "Action non autorisée pour votre rôle."
  if (/duplicate key|23505/.test(m + (e.code || ""))) return "Cette valeur existe déjà."
  if (/foreign key|23503/.test(m + (e.code || ""))) return "Élément encore utilisé ailleurs : suppression ou liaison impossible."
  if (/Failed to fetch|NetworkError/i.test(m)) return "Connexion au serveur impossible. Vérifiez votre accès à Internet."
  return m
}

/** Lève une erreur lisible si la réponse Supabase en contient une, sinon renvoie les données. */
export function verifier({ data, error }) {
  if (error) throw new Error(messageErreur(error))
  return data
}

/** Charge toutes les lignes d'une requête, par pages de 1000 (limite de l'API). */
export async function toutCharger(construire) {
  const lignes = []
  for (let debut = 0; ; debut += 1000) {
    const page = verifier(await construire().range(debut, debut + 999))
    lignes.push(...page)
    if (page.length < 1000) return lignes
  }
}

/** Appel d'une fonction sécurisée (RPC). */
export async function rpc(nom, params) {
  return verifier(await supabase.rpc(nom, params))
}

/** Connexion avec Google (le retour se fait sur `chemin` du même site). */
export async function connexionGoogle(chemin = "/") {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${chemin}`, queryParams: { prompt: "select_account" } },
  })
  if (error) throw new Error(messageErreur(error))
}
