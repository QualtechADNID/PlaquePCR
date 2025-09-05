from flask import Flask, jsonify, render_template, request, flash, redirect, url_for, send_file
from werkzeug.utils import secure_filename
from pathlib import Path
from generate_plaque.function_pcr import read_excel_file, generate_plaque_in_template
import os, re, json, unicodedata
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
REG_PATH = TEMPLATE_DIR / "templates.json"

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
    return n <= 16384 and int(row) <= 1048576  # A..XFD, 1..1048576

# --- Routes ---
@app.get("/healthz")
def healthz():
    return jsonify(status="ok"), 200

@app.get("/")
def index():
    # Passe la liste des templates au template Jinja (si vous l’utilisez)
    return render_template("index.html", templates=load_registry())

@app.post("/upload_template")
def upload_template():
    file = request.files.get("template_file")        # <input name="template_file">
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

    ext = Path(file.filename).suffix.lower()
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
    # Fichier de données à traiter
    f = request.files.get("excel_file")              # <input name="excel_file">
    if f is None or f.filename == "":
        flash("Aucun fichier fourni.")
        return redirect(url_for("index"))

    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        flash("Le fichier doit être un Excel (.xls ou .xlsx).")
        return redirect(url_for("index"))

    # Template choisi + position (optionnelle)
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

    # Lecture en mémoire et génération en mémoire
    try:
        df = read_excel_file(f)  # FileStorage → file-like
    except Exception as e:
        flash(f"Erreur de lecture de l'Excel : {e}")
        return redirect(url_for("index"))

    try:
        xlsx_buf = generate_plaque_in_template(df, str(template_path), position=position)
    except Exception as e:
        flash(f"Erreur de génération du template : {e}")
        return redirect(url_for("index"))

    # Met à jour la position mémorisée pour ce template
    info["position"] = position
    reg[template_key] = info
    save_registry(reg)

    # Téléchargement direct
    base = Path(secure_filename(f.filename)).stem
    download_name = f"{base}_plaque_PCR.xlsx"
    return send_file(
        xlsx_buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name,
        max_age=0
    )