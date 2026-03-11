from flask import Flask, jsonify, render_template, request, flash, redirect, url_for, send_file, session
from werkzeug.utils import secure_filename
from pathlib import Path
from generate_plaque.function_pcr import (
    read_excel_file,
    generate_plaque_in_template,
    prepare_plates_data,
    prepare_plates_data_grouped,
    generate_plaque_from_layout,
    df_from_layout,
)
import os, re, json, unicodedata, pickle, sqlite3, urllib.request

from datetime import datetime, timezone
import pandas as pd
from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024
ALLOWED_EXT = {".xls", ".xlsx"}

# Dossiers et registre de templates
APP_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = APP_DIR / "template_pcr"
TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR = APP_DIR / "tmp"
TMP_DIR.mkdir(parents=True, exist_ok=True)
REG_PATH = TEMPLATE_DIR / "templates.json"
DB_PATH = APP_DIR / "plans.db"

# --- Base de données SQLite ---
def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plan (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                name             TEXT NOT NULL,
                year             INTEGER NOT NULL,
                created_at       TEXT NOT NULL,
                updated_at       TEXT NOT NULL,
                template_key     TEXT NOT NULL,
                position         TEXT NOT NULL,
                original_filename TEXT,
                layout_json      TEXT NOT NULL
            )
        """)
        conn.commit()

init_db()

# --- Utilitaires ---
def load_registry() -> dict:
    if REG_PATH.exists():
        with REG_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    return {}

def save_registry(d: dict) -> None:
    tmp = REG_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=2)
    tmp.replace(REG_PATH)

def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_").lower()
    return value or "template"

def unique_path(dirpath: Path, base: str, ext: str) -> Path:
    p = dirpath / f"{base}{ext}"
    i = 1
    while p.exists():
        p = dirpath / f"{base}_{i}{ext}"
        i += 1
    return p

def valid_excel_cell(addr: str) -> bool:
    s = (addr or "").upper().strip()
    m = re.fullmatch(r"([A-Z]{1,3})([1-9]\d{0,6})", s)
    if not m:
        return False
    col, row = m.groups()
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n <= 16384 and int(row) <= 1048576

# --- Routes ---
@app.get("/healthz")
def healthz():
    return jsonify(status="ok"), 200

@app.get("/")
def index():
    return render_template("index.html", templates=load_registry())

@app.post("/upload_template")
def upload_template():
    file = request.files.get("template_file")
    name = (request.form.get("name") or "").strip()
    position = (request.form.get("position") or "").strip().upper()

    if not name:
        flash("Nom du template manquant.")
        return redirect(url_for("index"))
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))
    if file is None or file.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    key = slugify(name)
    out_path = unique_path(TEMPLATE_DIR, key, ext)
    try:
        file.save(out_path)
    except Exception as e:
        flash(f"Échec de l'enregistrement du template : {e}")
        return redirect(url_for("index"))

    reg = load_registry()
    reg[key] = {"filename": out_path.name, "position": position}
    save_registry(reg)

    flash(f"Template « {name} » enregistré (position {position}).")
    return redirect(url_for("index"))


@app.post("/upload")
def upload():
    """Ancienne route : génère directement sans passer par l'interface interactive."""
    f = request.files.get("excel_file")
    choice = request.form.get("group_primers") == "on"
    if f is None or f.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    template_key = (request.form.get("template_key") or "").strip()
    if not template_key:
        flash("Aucun template sélectionné.")
        return redirect(url_for("index"))

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        flash("Template inconnu.")
        return redirect(url_for("index"))

    template_path = TEMPLATE_DIR / info["filename"]
    position = (request.form.get("position") or info.get("position") or "H5").strip().upper()
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))

    try:
        df = read_excel_file(f)
    except Exception as e:
        flash(f"Erreur de lecture de l'Excel : {e}")
        return redirect(url_for("index"))

    try:
        xlsx_buf = generate_plaque_in_template(df, str(template_path), position=position, choice=choice)
    except Exception as e:
        flash(f"Erreur de génération du template : {e}")
        return redirect(url_for("index"))

    info["position"] = position
    reg[template_key] = info
    save_registry(reg)

    base = Path(secure_filename(f.filename or "plaque")).stem
    download_name = f"{base}_plaque_PCR.xlsx"
    return send_file(
        xlsx_buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# Nouvelle route : interface interactive d'arrangement des plaques
# ---------------------------------------------------------------------------

@app.post("/arrange")
def arrange():
    """
    Lit le fichier Excel, calcule le placement initial des échantillons,
    et affiche l'interface de visualisation / drag & drop.
    """
    f = request.files.get("excel_file")
    if f is None or f.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    template_key = (request.form.get("template_key") or "").strip()
    if not template_key:
        flash("Aucun template sélectionné.")
        return redirect(url_for("index"))

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        flash("Template inconnu.")
        return redirect(url_for("index"))

    position = (request.form.get("position") or info.get("position") or "H5").strip().upper()
    if not valid_excel_cell(position):
        flash("Position invalide (ex. A1, AA10).")
        return redirect(url_for("index"))

    sort_similarity = request.form.get("sort_similarity") == "on"
    group_dilutions = request.form.get("group_primers") == "on"

    try:
        df = read_excel_file(f)
    except Exception as e:
        flash(f"Erreur de lecture de l'Excel : {e}")
        return redirect(url_for("index"))

    try:
        layout = prepare_plates_data(
            df,
            sort_by_similarity=sort_similarity,
            group_dilutions=group_dilutions,
        )
    except Exception as e:
        flash(f"Erreur de préparation des plaques : {e}")
        return redirect(url_for("index"))

    # Mémoriser les métadonnées en session pour l'export
    session_id = session.get("_id") or os.urandom(16).hex()
    session["_id"] = session_id
    session["template_key"] = template_key
    session["position"] = position
    session["original_filename"] = secure_filename(f.filename or "plaque")
    session["sort_similarity"] = sort_similarity
    session["group_dilutions"] = group_dilutions

    # Sauvegarder le DataFrame pour /regroup
    pkl_path = TMP_DIR / f"{session_id}.pkl"
    with pkl_path.open("wb") as fh:
        pickle.dump(df, fh)

    # Liste des demandes uniques pour le panneau de groupement
    demandes = sorted(df["Demande"].dropna().unique().tolist()) if "Demande" in df.columns else []

    # Fichier LV optionnel : demande → nom client
    demande_clients: dict = {}
    lv_file = request.files.get("lv_file")
    if lv_file and lv_file.filename:
        try:
            df_lv = pd.read_excel(lv_file)
            if "Demande" in df_lv.columns and "Nom Demandeur" in df_lv.columns:
                demande_clients = {
                    str(row["Demande"]).strip(): str(row["Nom Demandeur"]).strip()
                    for _, row in df_lv.iterrows()
                    if pd.notna(row["Demande"]) and pd.notna(row["Nom Demandeur"])
                }
        except Exception:
            pass  # Fichier LV invalide : on ignore silencieusement

    return render_template(
        "arrange.html",
        layout=layout,
        layout_json=json.dumps(layout),
        template_key=template_key,
        position=position,
        templates=reg,
        demandes=demandes,
        demande_clients=demande_clients,
        plan_id=None,
        plan_name="",
    )


@app.post("/regroup")
def regroup():
    """
    Reçoit les groupes de demandes et recalcule le layout groupé.
    Body JSON: {
      "groups": {"Groupe A": ["260203-00052", ...], ...},
      "sort_by_similarity": bool,
      "group_dilutions": bool
    }
    Retourne: layout JSON (même structure que /arrange)
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Données manquantes."), 400

    groups = data.get("groups", {})
    if not groups:
        return jsonify(error="Aucun groupe fourni."), 400

    session_id = session.get("_id", "")
    pkl_path = TMP_DIR / f"{session_id}.pkl"
    if not pkl_path.exists():
        return jsonify(error="Session expirée, veuillez recharger le fichier."), 400

    with pkl_path.open("rb") as fh:
        df = pickle.load(fh)

    sort_similarity = data.get("sort_by_similarity", session.get("sort_similarity", True))
    group_dilutions = data.get("group_dilutions", session.get("group_dilutions", False))

    try:
        layout = prepare_plates_data_grouped(df, groups, sort_similarity, group_dilutions)
    except Exception as e:
        return jsonify(error=f"Erreur de génération des groupes : {e}"), 500

    return jsonify(layout)


@app.post("/export")
def export():
    """
    Reçoit le layout JSON (potentiellement modifié par l'utilisateur via drag & drop)
    et génère le fichier Excel final.
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Données manquantes."), 400

    layout = data.get("layout")
    template_key = data.get("template_key") or session.get("template_key", "")
    position = data.get("position") or session.get("position", "H5")
    original_filename = data.get("filename") or session.get("original_filename", "plaque")

    if not layout:
        return jsonify(error="Layout manquant."), 400

    reg = load_registry()
    info = reg.get(template_key)
    if not info:
        return jsonify(error="Template inconnu."), 400

    template_path = TEMPLATE_DIR / info["filename"]
    position = position.strip().upper()
    if not valid_excel_cell(position):
        return jsonify(error="Position invalide."), 400

    try:
        xlsx_buf = generate_plaque_from_layout(layout, str(template_path), position)
    except Exception as e:
        return jsonify(error=f"Erreur de génération : {e}"), 500

    # Nettoyer le fichier temporaire
    session_id = session.get("_id", "")
    if session_id:
        pkl_path = TMP_DIR / f"{session_id}.pkl"
        try:
            pkl_path.unlink(missing_ok=True)
        except Exception:
            pass

    # Mettre à jour la position mémorisée
    info["position"] = position
    reg[template_key] = info
    save_registry(reg)

    base = Path(secure_filename(original_filename)).stem
    download_name = f"{base}_plaque_PCR.xlsx"
    return send_file(
        xlsx_buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# Plans sauvegardés
# ---------------------------------------------------------------------------

def extract_demandes_from_layout(layout: dict) -> list[str]:
    """Extrait les demandes uniques présentes dans un layout JSON."""
    demandes = set()
    for prog in layout.get("programmes", []):
        for plate in prog.get("plates", []):
            for well in plate.get("wells", {}).values():
                d = (well or {}).get("demande", "")
                if d and d != "nan":
                    demandes.add(d)
    return sorted(demandes)


@app.get("/sessions")
def sessions_list():
    """Liste tous les plans sauvegardés, groupés par année."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, year, created_at, updated_at, template_key, original_filename "
            "FROM plan ORDER BY updated_at DESC"
        ).fetchall()

    # Grouper par année
    by_year: dict[int, list] = {}
    for row in rows:
        y = row["year"]
        by_year.setdefault(y, []).append(dict(row))

    years_sorted = sorted(by_year.keys(), reverse=True)
    return render_template("sessions.html", by_year=by_year, years=years_sorted)


@app.post("/save")
def save_plan():
    """
    Crée ou met à jour un plan sauvegardé.
    Body JSON: {
      "plan_id": null | int,
      "name": str,
      "layout": dict,
      "template_key": str,
      "position": str,
      "original_filename": str
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify(error="Données manquantes."), 400

    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="Nom manquant."), 400

    layout = data.get("layout")
    if not layout:
        return jsonify(error="Layout manquant."), 400

    template_key     = data.get("template_key") or session.get("template_key", "")
    position         = data.get("position") or session.get("position", "H5")
    original_filename = data.get("original_filename") or session.get("original_filename", "")
    plan_id          = data.get("plan_id")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    year = int(now[:4])
    layout_json = json.dumps(layout, ensure_ascii=False)

    with get_db() as conn:
        if plan_id:
            # Vérifier que le plan existe
            existing = conn.execute("SELECT id FROM plan WHERE id = ?", (plan_id,)).fetchone()
            if existing:
                conn.execute(
                    "UPDATE plan SET name=?, updated_at=?, template_key=?, position=?, "
                    "original_filename=?, layout_json=? WHERE id=?",
                    (name, now, template_key, position, original_filename, layout_json, plan_id)
                )
                conn.commit()
                return jsonify(plan_id=plan_id, name=name)

        # Nouveau plan
        cur = conn.execute(
            "INSERT INTO plan (name, year, created_at, updated_at, template_key, position, "
            "original_filename, layout_json) VALUES (?,?,?,?,?,?,?,?)",
            (name, year, now, now, template_key, position, original_filename, layout_json)
        )
        conn.commit()
        return jsonify(plan_id=cur.lastrowid, name=name)


@app.get("/sessions/<int:plan_id>")
def open_plan(plan_id: int):
    """Charge un plan sauvegardé dans l'interface arrange.html."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM plan WHERE id = ?", (plan_id,)).fetchone()
    if not row:
        flash("Plan introuvable.")
        return redirect(url_for("sessions_list"))

    layout = json.loads(row["layout_json"])
    demandes = extract_demandes_from_layout(layout)
    reg = load_registry()

    # Initialiser la session Flask et recréer le pickle pour /regroup
    session_id = session.get("_id") or os.urandom(16).hex()
    session["_id"] = session_id
    session["template_key"] = row["template_key"]
    session["position"] = row["position"]
    session["original_filename"] = row["original_filename"]

    pkl_path = TMP_DIR / f"{session_id}.pkl"
    try:
        df = df_from_layout(layout)
        with pkl_path.open("wb") as fh:
            pickle.dump(df, fh)
    except Exception:
        pass  # Non bloquant : /regroup retournera "Session expirée" si ça échoue

    return render_template(
        "arrange.html",
        layout=layout,
        layout_json=row["layout_json"],
        template_key=row["template_key"],
        position=row["position"],
        templates=reg,
        demandes=demandes,
        demande_clients={},
        plan_id=plan_id,
        plan_name=row["name"],
    )


@app.delete("/sessions/<int:plan_id>")
def delete_plan(plan_id: int):
    """Supprime un plan sauvegardé."""
    with get_db() as conn:
        conn.execute("DELETE FROM plan WHERE id = ?", (plan_id,))
        conn.commit()
    return jsonify(ok=True)


# ---------------------------------------------------------------------------
# Ajout tardif d'un fichier client (dans la page /arrange)
# ---------------------------------------------------------------------------

@app.post("/add-client-file")
def add_client_file():
    """
    Reçoit un fichier LV client (Excel) et retourne le mapping demande → client.
    Body : multipart/form-data avec champ "lv_file".
    Retourne : {"demande_clients": {"260203-00052": "Dupont", ...}}
    """
    lv_file = request.files.get("lv_file")
    if not lv_file or not lv_file.filename:
        return jsonify(error="Aucun fichier fourni."), 400

    ext = Path(lv_file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error="Le fichier doit être un Excel (.xls ou .xlsx)."), 400

    try:
        df_lv = pd.read_excel(lv_file)
    except Exception as e:
        return jsonify(error=f"Impossible de lire le fichier : {e}"), 400

    if "Demande" not in df_lv.columns or "Nom Demandeur" not in df_lv.columns:
        return jsonify(error="Le fichier doit contenir les colonnes 'Demande' et 'Nom Demandeur'."), 400

    demande_clients = {
        str(row["Demande"]).strip(): str(row["Nom Demandeur"]).strip()
        for _, row in df_lv.iterrows()
        if pd.notna(row["Demande"]) and pd.notna(row["Nom Demandeur"])
    }
    return jsonify(demande_clients=demande_clients)


# ---------------------------------------------------------------------------
# Ajout d'un nouveau fichier de données (merge ou reset)
# ---------------------------------------------------------------------------

@app.post("/add-data-file")
def add_data_file():
    """
    Reçoit un nouveau fichier LV de données et le layout actuel (JSON string).
    Compare les échantillons du nouveau fichier avec ceux déjà placés ou en attente.

    Logique :
    - Collecte tous les (code_labo, amorces, dilution, instance) déjà présents dans
      le layout (wells + unplaced).
    - Si AUCUN échantillon du nouveau fichier ne correspond à un existant → reset complet :
      retourne le nouveau layout calculé.
    - Sinon → merge : retourne uniquement les nouveaux échantillons (ceux absents du
      layout courant) sous forme de liste "new_samples" à ajouter aux puits non-assignés.

    Body : multipart/form-data
      - excel_file   : nouveau fichier LV (.xls/.xlsx)
      - layout_json  : layout actuel (JSON string)
      - unplaced_json: puits non-assignés actuels (JSON string, tableau)
      - sort_similarity : "true"/"false" (optionnel, défaut true)
      - group_dilutions : "true"/"false" (optionnel, défaut false)

    Retourne :
      {
        "mode":        "reset" | "merge",
        "new_samples": [...],    // mode=merge : nouveaux puits à ajouter aux non-assignés
        "layout":      {...},    // mode=reset  : nouveau layout complet
        "new_count":   int,
        "existing_count": int,
      }
    """
    excel_file = request.files.get("excel_file")
    if not excel_file or not excel_file.filename:
        return jsonify(error="Aucun fichier fourni."), 400

    ext = Path(excel_file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        return jsonify(error="Le fichier doit être un Excel (.xls ou .xlsx)."), 400

    layout_str   = request.form.get("layout_json", "{}")
    unplaced_str = request.form.get("unplaced_json", "[]")
    sort_similarity = request.form.get("sort_similarity", "true").lower() == "true"
    group_dilutions = request.form.get("group_dilutions", "false").lower() == "true"

    try:
        current_layout = json.loads(layout_str)
        current_unplaced = json.loads(unplaced_str)
    except Exception:
        return jsonify(error="Layout JSON invalide."), 400

    try:
        df_new = read_excel_file(excel_file)
    except Exception as e:
        return jsonify(error=f"Impossible de lire le fichier : {e}"), 400

    # ── Construire un set d'identifiants des échantillons existants ───────────
    # Clé : (code_labo, amorces, dilution, instance) — insensible aux duplicats
    def sample_key(w: dict) -> tuple:
        return (
            str(w.get("code_labo", "") or "").strip(),
            str(w.get("amorces", "") or "").strip(),
            str(w.get("dilution", "") or "").strip(),
            str(w.get("instance", "") or "").strip(),
        )

    existing_keys: set[tuple] = set()
    # Depuis le layout (wells dans les plaques)
    for prog in current_layout.get("programmes", []):
        for plate in prog.get("plates", []):
            for w in plate.get("wells", {}).values():
                if w and not w.get("is_blank"):
                    existing_keys.add(sample_key(w))
    # Depuis les puits non-assignés
    for w in current_unplaced:
        if w and not w.get("is_blank"):
            existing_keys.add(sample_key(w))

    # ── Construire les échantillons du nouveau fichier ────────────────────────
    df_new["Dilution"] = df_new["Dilution"].fillna("").astype(str).replace("nan", "")
    df_new["Instance"] = df_new["Instance"].fillna("").astype(str).replace("nan", "")

    def df_row_key(row) -> tuple:
        return (
            str(row["Code labo"]).strip(),
            str(row["Amorces"]).strip(),
            str(row["Dilution"]).strip(),
            str(row["Instance"]).strip(),
        )

    new_rows = []
    overlap_count = 0
    for _, row in df_new.iterrows():
        k = df_row_key(row)
        if k in existing_keys:
            overlap_count += 1
        else:
            new_rows.append(row)

    total_new_file = len(df_new)
    truly_new = len(new_rows)

    # ── Décision reset vs merge ───────────────────────────────────────────────
    if overlap_count == 0:
        # Aucun échantillon en commun → reset complet
        try:
            layout = prepare_plates_data(df_new, sort_by_similarity=sort_similarity, group_dilutions=group_dilutions)
        except Exception as e:
            return jsonify(error=f"Erreur de préparation des plaques : {e}"), 500

        # Mettre à jour le pickle de session pour /regroup
        session_id = session.get("_id", "")
        if session_id:
            pkl_path = TMP_DIR / f"{session_id}.pkl"
            try:
                with pkl_path.open("wb") as fh:
                    pickle.dump(df_new, fh)
            except Exception:
                pass

        return jsonify(
            mode="reset",
            layout=layout,
            new_count=total_new_file,
            existing_count=0,
        )

    # Mode merge : construire la liste des nouveaux puits (non-assignés à ajouter)
    # Reconstruire un mini-DataFrame avec seulement les nouvelles lignes
    if not new_rows:
        return jsonify(
            mode="merge",
            new_samples=[],
            new_count=0,
            existing_count=overlap_count,
        )

    from generate_plaque.function_pcr import make_content

    new_samples = []
    for row in new_rows:
        instance_val = str(row.get("Instance", "")).strip()
        new_samples.append({
            "content":   make_content(row),
            "code_labo": str(row["Code labo"]).strip(),
            "amorces":   str(row["Amorces"]).strip(),
            "programme": str(row.get("ProgrammePCR", "")).strip(),
            "dilution":  str(row.get("Dilution", "")).strip(),
            "instance":  instance_val,
            "demande":   str(row.get("Demande", "")).strip(),
        })

    # Mettre à jour le pickle en fusionnant les DataFrames
    session_id = session.get("_id", "")
    if session_id:
        pkl_path = TMP_DIR / f"{session_id}.pkl"
        try:
            if pkl_path.exists():
                with pkl_path.open("rb") as fh:
                    df_old = pickle.load(fh)
                df_merged = pd.concat([df_old, df_new], ignore_index=True).drop_duplicates()
            else:
                df_merged = df_new
            with pkl_path.open("wb") as fh:
                pickle.dump(df_merged, fh)
        except Exception:
            pass

    return jsonify(
        mode="merge",
        new_samples=new_samples,
        new_count=truly_new,
        existing_count=overlap_count,
    )


# ── Proxy : liste des programmes PCR ─────────────────────────────────────────

@app.route("/api/programmes_pcr")
def programmes_pcr():
    """Proxifie la requête vers le serveur interne pour éviter les erreurs CORS."""
    try:
        with urllib.request.urlopen(
            "http://adnid-bioinfo:3456/programme_pcr_list", timeout=5
        ) as r:
            data = json.loads(r.read().decode())
        return jsonify(data)
    except Exception as e:
        return jsonify({"programmes": [], "error": str(e)}), 502


@app.route("/api/couples")
def couples():
    """Proxifie la liste des couples d'amorces pour éviter les erreurs CORS."""
    try:
        with urllib.request.urlopen(
            "http://adnid-bioinfo:3456/couples_list", timeout=5
        ) as r:
            data = json.loads(r.read().decode())
        return jsonify(data)
    except Exception as e:
        return jsonify({"couples": [], "error": str(e)}), 502
