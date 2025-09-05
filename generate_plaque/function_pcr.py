# generate_plaque/function_pcr.py
import pandas as pd
from itertools import zip_longest
import numpy as np
from openpyxl import load_workbook
from openpyxl.styles import Alignment, Font, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import coordinate_from_string, column_index_from_string
from io import BytesIO

def excel_coord_to_index(cell_ref: str) -> tuple[int, int]:
    col_letter, row = coordinate_from_string(cell_ref)
    col = column_index_from_string(col_letter)
    return row, col

def split_clean(s):
    return [t.strip() for t in str(s).split(";") if t.strip() != ""]

def sort_within_program(group: pd.DataFrame) -> pd.DataFrame:
    counts = group["Amorces"].value_counts()
    group = group.copy()
    group["Amorce_count"] = group["Amorces"].map(counts)
    return (group.sort_values(
        ["Amorce_count", "Amorces", "Code labo", "Instance_num"],
        ascending=[False, True, True, True]
    ).drop(columns="Amorce_count"))

def assign_plates_columns(group: pd.DataFrame, plate_size: int = 96) -> pd.DataFrame:
    n = len(group)
    idx = np.arange(n)
    plate = idx // plate_size + 1
    pos = idx % plate_size
    col_num = pos // 8 + 1
    row_num = pos % 8
    rows = np.array(list("ABCDEFGH"))
    row_lbl = rows[row_num]
    well = [r + str(c).zfill(2) for r, c in zip(row_lbl, col_num)]
    out = group.copy()
    out["PlateNbr"] = plate
    out["Row"] = row_lbl
    out["Col"] = col_num
    out["Well"] = well
    return out

def read_excel_file(file_like) -> pd.DataFrame:
    """Lit l’Excel uploadé (objets FileStorage / file-like). Aucune écriture disque."""
    df = pd.read_excel(file_like, header=[0, 1, 2])
    df.columns = [
        "_".join([str(x).strip()
                  for x in tup
                  if not str(x).startswith("Unnamed") and str(x).strip() not in ("nan", "None", "")])
        for tup in df.columns.to_flat_index()
    ]
    df2 = df[[
        "Code labo",
        "Instance #",
        "PRE-PCR-MON (0,1)_Amorces (Standard, Rep [replicateid])",
        "PRE-PCR-MON (0,1)_Programme PCR (Standard, Rep [replicateid])"
    ]].rename(columns={
        "PRE-PCR-MON (0,1)_Amorces (Standard, Rep [replicateid])": "Amorces",
        "PRE-PCR-MON (0,1)_Programme PCR (Standard, Rep [replicateid])": "ProgrammePCR",
        "Instance #": "Instance"
    })
    df2["Amorces_liste"] = df2["Amorces"].apply(split_clean)
    df2["Programme_liste"] = df2["ProgrammePCR"].apply(split_clean)
    df2["pairs"] = df2.apply(
        lambda r: list(zip_longest(r["Amorces_liste"], r["Programme_liste"], fillvalue=pd.NA)),
        axis=1
    )
    macron = df2.explode("pairs", ignore_index=True)
    macron[["Amorces", "ProgrammePCR"]] = macron["pairs"].apply(pd.Series)
    result = macron[["Code labo", "Instance", "Amorces", "ProgrammePCR"]].copy()
    return result

def generate_plaque_in_template(dataframe: pd.DataFrame, template_file: str, position: str) -> BytesIO:
    """
    Remplit le template Excel et retourne un buffer BytesIO prêt à être envoyé,
    sans sauvegarde sur disque.
    """
    row, col = excel_coord_to_index(position)
    df = dataframe.copy()
    df["Instance_num"] = pd.to_numeric(df["Instance"], errors="coerce")

    df_sorted = (df.groupby("ProgrammePCR", group_keys=False)
                   .apply(sort_within_program)
                   .reset_index(drop=True))

    plates = (df_sorted.groupby("ProgrammePCR", group_keys=False)
              .apply(assign_plates_columns, plate_size=96)
              .reset_index(drop=True))

    plates["Content"] = (
        plates["Code labo"].astype(str) + "_" +
        plates["Instance"].astype(str)  + "_" +
        plates["Amorces"].astype(str)
    )

    wb = load_workbook(template_file)
    ws = wb["Feuil1"]

    thin = Side(border_style="thin", color="000000")
    border = Border(top=thin, bottom=thin, left=thin, right=thin)
    current_row = row
    row_order = {ch: i for i, ch in enumerate("ABCDEFGH")}

    for (prog, plate_nbr), sub_plate in plates.groupby(["ProgrammePCR", "PlateNbr"], sort=True):
        rows_used = sorted(sub_plate["Row"].unique(), key=row_order.get)
        cols_used = sorted(map(int, sub_plate["Col"].unique()))
        nb_cols = len(cols_used) + 1

        # Titre
        title = f"{prog} — Plaque {plate_nbr}"
        ws.merge_cells(start_row=current_row, start_column=col,
                       end_row=current_row, end_column=col + nb_cols - 1)
        ctitle = ws.cell(row=current_row, column=col, value=title)
        ctitle.font = Font(bold=True)
        ctitle.alignment = Alignment(horizontal="center")
        current_row += 1

        # En-têtes
        headers = ["", *cols_used]
        for j, val in enumerate(headers):
            cell = ws.cell(row=current_row, column=col + j, value=val)
            cell.border = border
            cell.font = Font(bold=True)
            cell.alignment = Alignment(horizontal="center")
        current_row += 1

        # Bloc plaque
        mat = (sub_plate.pivot(index="Row", columns="Col", values="Content")
               .reindex(index=rows_used, columns=cols_used))
        block = mat.copy()
        block.insert(0, "Row", block.index)
        block = block.reset_index(drop=True)

        start_r = current_row
        nrows, ncols = block.shape
        for i in range(nrows):
            for j in range(ncols):
                val = block.iat[i, j]
                ws.cell(row=start_r + i, column=col + j, value=None if pd.isna(val) else val)

        end_r = start_r + nrows - 1
        end_c = col + ncols - 1

        # Style cellules
        for r in ws.iter_rows(min_row=start_r, max_row=end_r, min_col=col, max_col=end_c):
            for cell in r:
                cell.border = border
                cell.alignment = Alignment(horizontal="center")

        # Largeurs colonnes
        for c in range(col, end_c + 1):
            max_len = 0
            for row_cells in ws.iter_rows(min_row=start_r, max_row=end_r, min_col=c, max_col=c):
                for cell in row_cells:
                    if cell.value is not None:
                        max_len = max(max_len, len(str(cell.value)))
            col_letter = get_column_letter(c)
            target = 6 if c == col else max(max_len + 2, 12)
            current_w = ws.column_dimensions[col_letter].width or 0
            ws.column_dimensions[col_letter].width = max(current_w, target)

        current_row = end_r + 1 + 2

    # Sauvegarde en mémoire
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf
