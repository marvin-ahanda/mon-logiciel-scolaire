// Plan Free de Supabase : un projet sans aucune requête pendant 7 jours est mis en pause.
// Cette fonction planifiée appelle une fois par jour la fonction publique « ping » (aucune donnée lue).
// Variables utilisées (publiques) : VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.

export default async () => {
  const url = Netlify.env.get("VITE_SUPABASE_URL")
  const cle = Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
  if (!url || !cle) {
    console.error("maintien : variables Supabase absentes")
    return
  }
  const r = await fetch(`${url}/rest/v1/rpc/ping`, {
    method: "POST",
    headers: { apikey: cle, "Content-Type": "application/json" },
    body: "{}",
  })
  console.log("maintien Supabase :", r.status)
}

// Tous les jours à 05:17 UTC (06:17 à Douala, UTC+1)
export const config = { schedule: "17 5 * * *" }
