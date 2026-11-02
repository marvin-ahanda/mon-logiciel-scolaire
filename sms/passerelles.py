"""Passerelles d'envoi des SMS.

OTOURIX_SMS_BACKEND :
- « journal » (par défaut) : n'envoie rien, enregistre le message comme simulé. Sans risque.
- « http » : POST JSON vers OTOURIX_SMS_URL avec le jeton OTOURIX_SMS_TOKEN (en-tête Authorization: Bearer)
  et le corps {"to": "+237…", "from": OTOURIX_SMS_EXPEDITEUR, "text": "…"}. À adapter à l'API du fournisseur choisi.
"""

import json
import os
import urllib.error
import urllib.request


class ErreurEnvoi(Exception):
    pass


class PasserelleJournal:
    nom = "journal"
    reel = False

    def envoyer(self, telephone, texte):
        return "simulé"


class PasserelleHTTP:
    nom = "http"
    reel = True

    def __init__(self):
        self.url = os.environ.get("OTOURIX_SMS_URL", "")
        self.jeton = os.environ.get("OTOURIX_SMS_TOKEN", "")
        self.expediteur = os.environ.get("OTOURIX_SMS_EXPEDITEUR", "ECOLE")[:11]
        if not self.url.startswith("https://"):
            raise ErreurEnvoi("OTOURIX_SMS_URL doit être une adresse https://")

    def envoyer(self, telephone, texte):
        corps = json.dumps({"to": telephone, "from": self.expediteur, "text": texte}).encode()
        requete = urllib.request.Request(self.url, data=corps, method="POST", headers={
            "Content-Type": "application/json", "Authorization": f"Bearer {self.jeton}"})
        try:
            with urllib.request.urlopen(requete, timeout=10) as r:
                if not 200 <= r.status < 300:
                    raise ErreurEnvoi(f"réponse {r.status} du fournisseur")
        except urllib.error.HTTPError as e:
            raise ErreurEnvoi(f"réponse {e.code} du fournisseur")
        except (urllib.error.URLError, TimeoutError) as e:
            raise ErreurEnvoi(f"fournisseur injoignable ({getattr(e, 'reason', e)})")
        return "envoyé"


_FORCEE = None


def passerelle():
    """Passerelle configurée (les tests peuvent en imposer une avec forcer_passerelle)."""
    if _FORCEE is not None:
        return _FORCEE
    return PasserelleHTTP() if os.environ.get("OTOURIX_SMS_BACKEND", "journal") == "http" else PasserelleJournal()


def forcer_passerelle(p):
    global _FORCEE
    _FORCEE = p
