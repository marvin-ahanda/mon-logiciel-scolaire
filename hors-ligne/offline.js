// Nouvel essai automatique dès le retour de la connexion
  const etat = document.getElementById("etat")
  const recharger = () => { etat.textContent = "Connexion rétablie, chargement… / Back online, loading…"; location.reload() }
  document.getElementById("reessayer").addEventListener("click", () => location.reload())
  addEventListener("online", recharger)
  if (!navigator.onLine) etat.textContent = "Hors ligne / Offline"
