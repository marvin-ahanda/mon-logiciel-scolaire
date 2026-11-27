// Pages pré-rendues pour le référencement : si l'adresse affichée n'est pas celle de la page pré-rendue (cas d'une adresse
// servie par la page générique), le contenu texte est retiré avant l'affichage pour ne pas montrer un texte étranger.
(function () {
  var s = document.querySelector(".seo-statique")
  if (!s) return
  var chemin = (location.pathname.replace(/\/+$/, "") || "/")
  if (s.getAttribute("data-chemin") !== chemin) {
    s.parentNode.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px system-ui,sans-serif;color:#6c757d">Chargement de NexIA School…</div>'
  }
})()
