from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin, UserPassesTestMixin
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.html import format_html
from django.views.decorators.http import require_POST
from django.views.generic import CreateView, ListView, UpdateView

from comptes.roles import enseignant_de_l_eleve, est_administration, est_caissier, est_surveillant

from .forms import AttributionForm, ClasseForm, EleveForm, EnseignantForm, ExerciceForm, MatiereForm
from .models import Attribution, Classe, Eleve, Enseignant, Exercice, Inscription, Matiere, Sequence


class AdminRequisMixin(LoginRequiredMixin, UserPassesTestMixin):
    def test_func(self):
        return est_administration(self.request.user)

    def handle_no_permission(self):
        if self.request.user.is_authenticated:      # même comportement que les vues fonctions
            messages.error(self.request, "Accès réservé à l'administration.")
            return redirect("accueil")
        return super().handle_no_permission()


def admin_requis(vue):
    def wrapper(request, *args, **kwargs):
        if not est_administration(request.user):
            messages.error(request, "Accès réservé à l'administration.")
            return redirect("accueil")
        return vue(request, *args, **kwargs)
    return login_required(wrapper)


@login_required
def accueil(request):
    if not est_administration(request.user):
        if est_caissier(request.user):
            return redirect("caisse")
        if est_surveillant(request.user):
            return redirect("appel")
    exercice = Exercice.actif_courant()
    ctx = {"exercice": exercice}
    if exercice:
        ctx.update(
            nb_classes=Classe.objects.count(),
            nb_eleves=Inscription.objects.filter(exercice=exercice).count(),
            nb_enseignants=Enseignant.objects.count(),
            nb_matieres=Matiere.objects.count(),
            sequences=exercice.sequences.all(),
        )
    return render(request, "scolarite/accueil.html", ctx)


# --- Vues génériques (liste / création / modification) ------------------------------

class ListeGenerique(AdminRequisMixin, ListView):
    template_name = "scolarite/liste.html"
    titre = ""
    colonnes = []          # [(libellé, attribut ou fonction)]
    url_creation = None
    url_modification = None
    paginate_by = 50

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        lignes = []
        for obj in ctx["object_list"]:
            valeurs = [c(obj) if callable(c) else getattr(obj, c) for _, c in self.colonnes]
            lignes.append({"obj": obj, "valeurs": valeurs,
                           "url": reverse(self.url_modification, args=[obj.pk]) if self.url_modification else None})
        ctx.update(titre=self.titre, entetes=[e for e, _ in self.colonnes], lignes=lignes,
                   url_creation=reverse(self.url_creation) if self.url_creation else None,
                   q=self.request.GET.get("q", ""))
        return ctx


class FormulaireGenerique(AdminRequisMixin):
    template_name = "scolarite/formulaire.html"
    titre = ""
    url_retour = None

    def get_success_url(self):
        messages.success(self.request, "Enregistrement effectué.")
        return reverse(self.url_retour)

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx.update(titre=self.titre, url_retour=reverse(self.url_retour))
        return ctx


# --- Exercices et séquences -------------------------------------------------------------

class ExerciceListe(ListeGenerique):
    model = Exercice
    titre = "Exercices"
    colonnes = [("Désignation", "libelle"), ("Actif", lambda e: "✔ actif" if e.actif else "")]
    url_creation = "exercice_creer"
    url_modification = "exercice_modifier"
    template_name = "scolarite/exercices.html"


class ExerciceCreer(FormulaireGenerique, CreateView):
    model = Exercice
    form_class = ExerciceForm
    titre = "Nouvel exercice"
    url_retour = "exercices"


class ExerciceModifier(FormulaireGenerique, UpdateView):
    model = Exercice
    form_class = ExerciceForm
    titre = "Modifier l'exercice"
    url_retour = "exercices"


@require_POST
@admin_requis
def exercice_activer(request, pk):
    ex = get_object_or_404(Exercice, pk=pk)
    ex.activer()
    messages.success(request, f"L'exercice {ex} est maintenant actif.")
    return redirect("exercices")


@admin_requis
def sequences(request):
    exercice = Exercice.actif_courant()
    return render(request, "scolarite/sequences.html",
                  {"sequences": exercice.sequences.all() if exercice else [], "exercice": exercice})


@require_POST
@admin_requis
def sequence_verrou(request, pk):
    seq = get_object_or_404(Sequence, pk=pk)
    seq.verrouillee = not seq.verrouillee
    seq.save(update_fields=["verrouillee"])
    messages.success(request, f"{seq.libelle} {'verrouillée' if seq.verrouillee else 'déverrouillée'}.")
    return redirect("sequences")


# --- Classes, matières, enseignants ----------------------------------------------------

def _effectif(classe):
    ex = Exercice.actif_courant()
    return classe.inscriptions.filter(exercice=ex).count() if ex else 0


class ClasseListe(ListeGenerique):
    model = Classe
    titre = "Classes"
    colonnes = [("Classe", "libelle"), ("Niveau", "niveau"), ("Section", lambda c: "Anglophone" if c.section_anglophone else "Francophone"),
                ("Examen", lambda c: "Oui" if c.classe_examen else ""), ("Effectif", _effectif),
                ("Matières", lambda c: format_html('<a href="{}">Matières et coefficients</a>', reverse("attributions", args=[c.pk])))]
    url_creation = "classe_creer"
    url_modification = "classe_modifier"

    def get_queryset(self):
        return Classe.objects.select_related("niveau")


class ClasseCreer(FormulaireGenerique, CreateView):
    model = Classe
    form_class = ClasseForm
    titre = "Nouvelle classe"
    url_retour = "classes"


class ClasseModifier(FormulaireGenerique, UpdateView):
    model = Classe
    form_class = ClasseForm
    titre = "Modifier la classe"
    url_retour = "classes"


class MatiereListe(ListeGenerique):
    model = Matiere
    titre = "Matières"
    colonnes = [("Code", "code"), ("Désignation", "libelle")]
    url_creation = "matiere_creer"
    url_modification = "matiere_modifier"


class MatiereCreer(FormulaireGenerique, CreateView):
    model = Matiere
    form_class = MatiereForm
    titre = "Nouvelle matière"
    url_retour = "matieres"


class MatiereModifier(FormulaireGenerique, UpdateView):
    model = Matiere
    form_class = MatiereForm
    titre = "Modifier la matière"
    url_retour = "matieres"


class EnseignantListe(ListeGenerique):
    model = Enseignant
    titre = "Enseignants"
    colonnes = [("Matricule", "matricule"), ("Nom", "nom"), ("Prénom", "prenom"), ("Téléphone", "telephone"),
                ("Accès au logiciel", lambda e: "oui" if e.utilisateur_id else "—")]
    url_creation = "enseignant_creer"
    url_modification = "enseignant_modifier"

    def get_queryset(self):
        qs = Enseignant.objects.select_related("utilisateur")
        q = self.request.GET.get("q")
        return qs.filter(Q(nom__icontains=q) | Q(prenom__icontains=q) | Q(matricule__icontains=q)) if q else qs


class AccesEnseignantMixin:
    """Après l'enregistrement, affiche le code d'accès s'il vient d'être généré."""

    def form_valid(self, form):
        reponse = super().form_valid(form)
        if form.code:
            from comptes.views import montrer_code
            return montrer_code(self.request, self.object.utilisateur, form.code)
        return reponse


class EnseignantCreer(AccesEnseignantMixin, FormulaireGenerique, CreateView):
    model = Enseignant
    form_class = EnseignantForm
    titre = "Nouvel enseignant"
    url_retour = "enseignants"


class EnseignantModifier(AccesEnseignantMixin, FormulaireGenerique, UpdateView):
    model = Enseignant
    form_class = EnseignantForm
    titre = "Modifier l'enseignant"
    url_retour = "enseignants"


# --- Élèves --------------------------------------------------------------------------------

class EleveListe(ListeGenerique):
    model = Eleve
    titre = "Élèves"
    url_creation = "eleve_creer"
    url_modification = "eleve_modifier"
    template_name = "scolarite/eleves.html"

    def get_queryset(self):
        ex = Exercice.actif_courant()
        qs = Eleve.objects.all()
        q, classe = self.request.GET.get("q"), self.request.GET.get("classe")
        if q:
            qs = qs.filter(Q(nom__icontains=q) | Q(prenom__icontains=q) | Q(matricule__icontains=q))
        if classe and ex:
            qs = qs.filter(inscriptions__exercice=ex, inscriptions__classe_id=classe)
        return qs

    @property
    def colonnes(self):
        ex = Exercice.actif_courant()
        classes = dict(Inscription.objects.filter(exercice=ex).values_list("eleve_id", "classe__libelle")) if ex else {}
        return [("Matricule", "matricule"), ("Nom", "nom"), ("Prénom", "prenom"), ("Sexe", "sexe"),
                ("Classe", lambda e: classes.get(e.pk, "— non inscrit"))]

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx.update(classes=Classe.objects.all(), classe_choisie=self.request.GET.get("classe", ""))
        return ctx


class EleveFormMixin:
    def get_form_kwargs(self):
        kw = super().get_form_kwargs()
        kw["exercice"] = Exercice.actif_courant()
        return kw


class EleveCreer(EleveFormMixin, FormulaireGenerique, CreateView):
    model = Eleve
    form_class = EleveForm
    titre = "Nouvel élève"
    url_retour = "eleves"


class EleveModifier(EleveFormMixin, FormulaireGenerique, UpdateView):
    model = Eleve
    form_class = EleveForm
    titre = "Modifier l'élève"
    url_retour = "eleves"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        if self.object.photo:
            ctx["apercu_photo"] = reverse("photo_eleve", args=[self.object.pk])
        return ctx


# --- Attributions (matières d'une classe : enseignant, coefficient, groupe) --------------------

@admin_requis
def attributions(request, classe_id):
    classe = get_object_or_404(Classe, pk=classe_id)
    exercice = Exercice.actif_courant()
    if not exercice:
        messages.error(request, "Aucun exercice actif.")
        return redirect("exercices")
    form = AttributionForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        a = form.save(commit=False)
        a.classe, a.exercice = classe, exercice
        if Attribution.objects.filter(classe=classe, exercice=exercice, matiere=a.matiere).exists():
            form.add_error("matiere", "Cette matière est déjà attribuée à la classe.")
        else:
            a.save()
            messages.success(request, f"{a.matiere} ajoutée à {classe}.")
            return redirect("attributions", classe_id=classe.pk)
    liste = Attribution.objects.filter(classe=classe, exercice=exercice).select_related("matiere", "enseignant")
    return render(request, "scolarite/attributions.html", {
        "classe": classe, "exercice": exercice, "form": form, "attributions": liste,
        "total_coef": sum(a.coefficient for a in liste),
    })


@admin_requis
def attribution_modifier(request, pk):
    a = get_object_or_404(Attribution, pk=pk)
    form = AttributionForm(request.POST or None, instance=a)
    if request.method == "POST":
        if "supprimer" in request.POST:
            if a.notes.exists():
                messages.error(request, "Des notes existent pour cette matière : suppression impossible.")
            else:
                a.delete()
                messages.success(request, "Matière retirée de la classe.")
            return redirect("attributions", classe_id=a.classe_id)
        if form.is_valid():
            form.save()
            messages.success(request, "Attribution modifiée.")
            return redirect("attributions", classe_id=a.classe_id)
    return render(request, "scolarite/formulaire.html", {
        "form": form, "titre": f"{a.matiere} — {a.classe}", "url_retour": reverse("attributions", args=[a.classe_id]),
        "suppression": True,
    })


# --- Photos (accès protégé : données personnelles de mineurs) -------------------------------------

@login_required
def photo_eleve(request, pk):
    eleve = get_object_or_404(Eleve, pk=pk)
    u = request.user
    autorise = (est_administration(u) or est_caissier(u) or est_surveillant(u) or enseignant_de_l_eleve(u, eleve))
    if not autorise or not eleve.photo:
        raise Http404()        # 404 plutôt que 403 : ne révèle pas l'existence d'une photo
    reponse = FileResponse(eleve.photo.open("rb"), content_type="image/jpeg")
    reponse["Cache-Control"] = "private, max-age=600"
    reponse["X-Content-Type-Options"] = "nosniff"
    return reponse


# --- Cartes scolaires ----------------------------------------------------------------------------------

@admin_requis
def cartes_scolaires(request):
    """Cartes scolaires au format carte bancaire (85,6 x 54 mm), 10 par page A4, par classe ou pour un élève."""
    exercice = Exercice.actif_courant()
    if not exercice:
        messages.error(request, "Aucun exercice actif.")
        return redirect("accueil")
    c_id, e_id = request.GET.get("classe"), request.GET.get("eleve")
    ctx = {"classes": Classe.objects.all(), "c_id": c_id, "exercice": exercice}
    if c_id:
        classe = get_object_or_404(Classe, pk=c_id)
        inscriptions = (Inscription.objects.filter(exercice=exercice, classe=classe).select_related("eleve", "classe")
                        .order_by("eleve__nom", "eleve__prenom"))
        ctx.update(classe=classe, eleves_classe=inscriptions)
        if e_id:
            inscriptions = inscriptions.filter(eleve_id=e_id)
        cartes = list(inscriptions)
        ctx["cartes"] = cartes
        ctx["pages"] = [cartes[i:i + 10] for i in range(0, len(cartes), 10)]     # 10 cartes par page A4
        ctx["sans_photo"] = sum(1 for i in cartes if not i.eleve.photo)
    return render(request, "scolarite/cartes.html", ctx)
