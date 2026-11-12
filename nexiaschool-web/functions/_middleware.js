// Cloudflare Pages Function : relais du serveur MCP et de l'OAuth de NexIA School (Supabase Edge Function « mcp »),
// servis depuis le domaine du site (équivalent des redirections 200 de netlify.toml).
// Invoquée seulement pour les adresses listées dans cloudflare/_routes.json : les fichiers du site restent servis
// directement par le CDN, sans consommer le quota de requêtes des Functions (100 000 par jour sur le plan Free).

const CIBLES = [
  [/^\/mcp\/?$/, ""],
  [/^\/\.well-known\/oauth-protected-resource(\/.*)?$/, "/.well-known/oauth-protected-resource"],
  [/^\/\.well-known\/oauth-authorization-server(\/.*)?$/, "/.well-known/oauth-authorization-server"],
  [/^\/\.well-known\/openid-configuration$/, "/.well-known/oauth-authorization-server"],
  [/^\/oauth\/register$/, "/oauth/register"],
  [/^\/oauth\/token$/, "/oauth/token"],
]
// en-têtes propres au saut réseau : jamais transmis
const SAUT = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-forwarded-proto", "x-real-ip"])

export async function onRequest(contexte) {
  const { request, env, next } = contexte
  const url = new URL(request.url)
  const cible = CIBLES.find(([motif]) => motif.test(url.pathname))
  if (!cible) return next()
  const origine = (env.MCP_ORIGINE || "").replace(/\/$/, "")
  if (!origine) return new Response("Relais MCP non configuré (MCP_ORIGINE).", { status: 500 })
  const entetes = new Headers()
  for (const [k, v] of request.headers) if (!SAUT.has(k.toLowerCase())) entetes.set(k, v)
  entetes.set("x-forwarded-host", url.host)
  const avecCorps = !["GET", "HEAD"].includes(request.method)
  const reponse = await fetch(origine + cible[1] + url.search, {
    method: request.method, headers: entetes, body: avecCorps ? request.body : undefined, redirect: "manual",
  })
  const sortie = new Headers(reponse.headers)
  sortie.set("Cache-Control", "no-store")
  return new Response(reponse.body, { status: reponse.status, statusText: reponse.statusText, headers: sortie })
}
