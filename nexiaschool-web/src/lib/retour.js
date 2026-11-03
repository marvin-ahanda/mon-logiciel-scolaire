// Page à rouvrir après la connexion (par exemple la page d'autorisation d'un agent IA).
const CLE = "nexiaschool.retour"
export function memoriserRetour(chemin) { try { sessionStorage.setItem(CLE, chemin) } catch { /* indisponible */ } }
export function consommerRetour() {
  try {
    const c = sessionStorage.getItem(CLE); sessionStorage.removeItem(CLE)
    return c && c.startsWith("/") && !c.startsWith("//") ? c : null
  } catch { return null }
}
export const URL_MCP = "https://nexiaschool.netlify.app/mcp"
