// Ancienne adresse nexiaschool.pages.dev → adresse officielle nexiaschool.com (même page, mêmes paramètres).
// Le serveur MCP et l'OAuth (/mcp, /.well-known, /oauth/register, /oauth/token) ne passent pas par ici : ils restent
// servis sur l'ancienne adresse, pour ne pas couper les assistants IA déjà connectés.
if (location.hostname === "nexiaschool.pages.dev") {
  location.replace("https://nexiaschool.com" + location.pathname + location.search + location.hash)
}
