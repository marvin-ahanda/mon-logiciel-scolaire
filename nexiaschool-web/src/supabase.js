import { createClient } from "@supabase/supabase-js"
import { t, traduireErreur } from "./i18n.jsx"

const url = import.meta.env.VITE_SUPABASE_URL
const cle = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !cle) {
  throw new Error("Configuration manquante : VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY (voir .env.example).")
}

export const supabase = createClient(url, cle, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "nexiaschool.session" },
})

/**
 * Session gardée sur l'appareil, utilisée seulement hors ligne : sans réseau, une session expirée ne peut pas être
 * renouvelée ; l'application reste utilisable (dernières données, saisies mises en attente) et la renouvelle au retour du réseau.
 */
export function sessionLocale() {
  try { const s = JSON.parse(localStorage.getItem("nexiaschool.session") || "null"); return s?.user?.id ? s : null } catch { return null }
}

/** Message d'erreur lisible à partir d'une erreur Supabase. */
export function messageErreur(e) {
  if (!e) return ""
  const m = e.message || String(e)
  if (/row-level security|permission denied|42501/i.test(m + (e.code || ""))) return t("Action non autorisée pour votre rôle.");
  if (/duplicate key|23505/.test(m + (e.code || ""))) return t("Cette valeur existe déjà.");
  if (/foreign key|23503/.test(m + (e.code || ""))) return t("Élément encore utilisé ailleurs : suppression ou liaison impossible.");
  if (/Failed to fetch|NetworkError/i.test(m)) return t("Connexion au serveur impossible. Vérifiez votre accès à Internet.");
  return traduireErreur(m)
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
    options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${chemin}`, queryParams: { prompt: "select_account" } },
  })
  if (error) throw new Error(messageErreur(error))
}
