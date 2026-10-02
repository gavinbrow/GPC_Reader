"""Report generation engine — HTML, PDF, CSV, and Excel exports.

Produces professional reports from experiment results using Jinja2 for HTML
rendering and ReportLab for PDF generation (pure-Python, no system library
dependencies).  Excel export uses openpyxl.

The report payload is assembled from the experiment metadata, peak results
(Mn/Mw/Mz/Pd/Rg/area), per-slice molar-mass / radius / concentration data,
and optionally conformation / calibration summary data.

See ``architecture.md`` §2.4.3 (Report Designer) and §3.5 data flow #6.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from typing import Any

from jinja2 import Environment, select_autoescape

from app.models import ComputedData, Experiment, Peak

logger = logging.getLogger(__name__)


def _nan_to_none(v: Any) -> float | None:
    """Return None for NaN/inf/None, otherwise the float value."""
    if v is None:
        return None
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return None
    return None if not _is_finite(fv) else fv


def _is_finite(v: float) -> bool:
    import math
    return math.isfinite(v)


def _fmt(v: Any, digits: int = 2) -> str:
    """Format a value for display in a report."""
    fv = _nan_to_none(v)
    if fv is None:
        return "—"
    if abs(fv) >= 1e6 or (abs(fv) < 1e-3 and fv != 0):
        return f"{fv:.{digits}e}"
    return f"{fv:.{digits}f}"


def _parse_slice_payload(cd: ComputedData) -> dict | None:
    """Parse JSON from ComputedData.data_values, returning None on failure."""
    if not cd.data_values:
        return None
    try:
        return json.loads(cd.data_values)
    except (json.JSONDecodeError, TypeError):
        return None


def collect_report_data(experiment: Experiment, peaks: list[Peak], computed_data: list[ComputedData]) -> dict:
    """Collect all data needed for report rendering into a plain dict.

    Parameters
    ----------
    experiment : Experiment
        ORM model instance.
    peaks : list[Peak]
        ORM peak rows for this experiment, ordered by range_number.
    computed_data : list[ComputedData]
        ComputedData rows for this experiment (zimm_slice data_type).

    Returns
    -------
    dict
        Structured payload with keys: experiment, peaks, slice_data, has_slice_data.
    """
    peak_summaries: list[dict] = []
    for p in peaks:
        peak_summaries.append({
            "peak_id": p.id,
            "range_number": p.range_number,
            "range_name": p.range_name,
            "range_start": p.range_start,
            "range_end": p.range_end,
            "mn": _nan_to_none(p.mn),
            "mw": _nan_to_none(p.mw),
            "mz": _nan_to_none(p.mz),
            "polydispersity": _nan_to_none(p.polydispersity),
            "rms_radius": _nan_to_none(p.rms_radius),
            "peak_area": _nan_to_none(p.peak_area),
            "recovery": _nan_to_none(p.recovery),
        })

    slice_data: list[dict] = []
    for cd in computed_data:
        if cd.data_type != "zimm_slice":
            continue
        payload = _parse_slice_payload(cd)
        if payload is None:
            continue
        t = payload.get("time", [])
        m = payload.get("molar_mass", [])
        r = payload.get("radius", [])
        c = payload.get("concentration", [])
        n = min(len(t), len(m), len(r), len(c))
        for i in range(n):
            slice_data.append({
                "peak_id": cd.peak_id,
                "time": _nan_to_none(t[i]) if i < len(t) else None,
                "molar_mass": _nan_to_none(m[i]) if i < len(m) else None,
                "radius_nm": _nan_to_none(r[i]) if i < len(r) else None,
                "concentration": _nan_to_none(c[i]) if i < len(c) else None,
            })

    mals_config = None
    if experiment.mals_config:
        try:
            mals_config = json.loads(experiment.mals_config)
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "experiment": {
            "id": experiment.id,
            "file_name": experiment.file_name,
            "sample_name": experiment.sample_name,
            "solvent_name": experiment.solvent_name,
            "solvent_description": experiment.solvent_description,
            "operator_name": experiment.operator_name,
            "collection_time": experiment.collection_time,
            "processing_time": experiment.processing_time,
            "astra_version": experiment.astra_version,
        },
        "peaks": peak_summaries,
        "slice_data": slice_data,
        "has_slice_data": len(slice_data) > 0,
        "mals_wavelength_nm": mals_config.get("wavelength") if mals_config else None,
    }


_REPORT_HTML_TEMPLATE = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ title }}</title>
<style>
  body { font-family: 'Helvetica', 'Arial', sans-serif; margin: 40px; color: #1e293b; }
  h1 { font-size: 22px; color: #0f172a; border-bottom: 2px solid #3b82f6; padding-bottom: 6px; }
  h2 { font-size: 16px; color: #1e3a8a; margin-top: 28px; }
  .meta { font-size: 12px; color: #64748b; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 11px; }
  th { background: #f1f5f9; text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 600; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; }
  td.num { text-align: right; font-family: 'Courier New', monospace; }
  .footer { margin-top: 40px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  .notes { font-size: 11px; color: #475569; margin: 10px 0; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>{{ title }}</h1>
<div class="meta">
  Sample: <strong>{{ data.experiment.sample_name or "—" }}</strong> &middot;
  Solvent: {{ data.experiment.solvent_name or "—" }} &middot;
  Operator: {{ data.experiment.operator_name or "—" }} &middot;
  Collected: {{ data.experiment.collection_time or "—" }}
</div>
{% if notes %}
<div class="notes">{{ notes }}</div>
{% endif %}

<h2>Experiment Metadata</h2>
<table>
  <tr><th>Field</th><th>Value</th></tr>
  <tr><td>File</td><td>{{ data.experiment.file_name }}</td></tr>
  <tr><td>Sample</td><td>{{ data.experiment.sample_name or "—" }}</td></tr>
  <tr><td>Solvent</td><td>{{ data.experiment.solvent_name or "—" }}</td></tr>
  <tr><td>Solvent Description</td><td>{{ data.experiment.solvent_description or "—" }}</td></tr>
  <tr><td>Operator</td><td>{{ data.experiment.operator_name or "—" }}</td></tr>
  <tr><td>Collection Time</td><td>{{ data.experiment.collection_time or "—" }}</td></tr>
  <tr><td>Processing Time</td><td>{{ data.experiment.processing_time or "—" }}</td></tr>
  <tr><td>ASTRA Version</td><td>{{ data.experiment.astra_version or "—" }}</td></tr>
  {% if data.mals_wavelength_nm %}
  <tr><td>MALS Wavelength</td><td>{{ data.mals_wavelength_nm }} nm</td></tr>
  {% endif %}
</table>

<h2>Peak Results Summary</h2>
<table>
  <tr>
    <th>Peak</th>
    <th>Range (min)</th>
    <th class="num">Mn (g/mol)</th>
    <th class="num">Mw (g/mol)</th>
    <th class="num">Mz (g/mol)</th>
    <th class="num">Pd (Mw/Mn)</th>
    <th class="num">Rg (nm)</th>
    <th class="num">Area</th>
    <th class="num">Recovery</th>
  </tr>
  {% for p in data.peaks %}
  <tr>
    <td>{{ p.range_number if p.range_number is not none else p.peak_id }}</td>
    <td>{{ fmt_range(p.range_start, p.range_end) }}</td>
    <td class="num">{{ fmt(p.mn) }}</td>
    <td class="num">{{ fmt(p.mw) }}</td>
    <td class="num">{{ fmt(p.mz) }}</td>
    <td class="num">{{ fmt(p.polydispersity, 3) }}</td>
    <td class="num">{{ fmt(p.rms_radius, 1) }}</td>
    <td class="num">{{ fmt(p.peak_area, 4) }}</td>
    <td class="num">{{ fmt(p.recovery, 1) }}</td>
  </tr>
  {% endfor %}
</table>

{% if include_slice_data and data.has_slice_data %}
<h2>Per-Slice Data (first 100 rows)</h2>
<table>
  <tr>
    <th>Peak</th>
    <th class="num">Time (min)</th>
    <th class="num">M (g/mol)</th>
    <th class="num">Rg (nm)</th>
    <th class="num">c (g/mL)</th>
  </tr>
  {% for s in data.slice_data[:100] %}
  <tr>
    <td>{{ s.peak_id }}</td>
    <td class="num">{{ fmt(s.time, 3) }}</td>
    <td class="num">{{ fmt(s.molar_mass) }}</td>
    <td class="num">{{ fmt(s.radius_nm, 1) }}</td>
    <td class="num">{{ fmt(s.concentration, 6) }}</td>
  </tr>
  {% endfor %}
</table>
{% if data.slice_data | length > 100 %}
<p style="font-size:10px; color:#94a3b8;">({{ data.slice_data | length - 100 }} more rows omitted — see CSV export for full data)</p>
{% endif %}
{% endif %}

<div class="footer">
  Generated by Astra Reader &middot; {{ generated_at }}
</div>
</body>
</html>
"""


def render_html_report(
    data: dict,
    title: str | None = None,
    notes: str | None = None,
    include_slice_data: bool = True,
) -> str:
    """Render the report data as an HTML document string."""
    env = Environment(autoescape=select_autoescape(["html"]), enable_async=False)
    template = env.from_string(_REPORT_HTML_TEMPLATE)
    from datetime import datetime
    return template.render(
        data=data,
        title=title or f"Astra Reader Report — {data['experiment']['sample_name'] or data['experiment']['file_name']}",
        notes=notes,
        include_slice_data=include_slice_data,
        fmt=_fmt,
        fmt_range=_fmt_range,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )


def _fmt_range(start: Any, end: Any) -> str:
    """Format a peak range for display."""
    s = _nan_to_none(start)
    e = _nan_to_none(end)
    if s is None and e is None:
        return "—"
    return f"{_fmt(s, 2)} – {_fmt(e, 2)}"


def generate_pdf_report(
    data: dict,
    title: str | None = None,
    notes: str | None = None,
    include_slice_data: bool = True,
) -> bytes:
    """Generate a PDF report using ReportLab (pure-Python, no system deps).

    Returns the raw PDF bytes.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Heading1"],
        fontSize=18,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=6,
    )
    meta_style = ParagraphStyle(
        "ReportMeta",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=16,
    )
    section_style = ParagraphStyle(
        "ReportSection",
        parent=styles["Heading2"],
        fontSize=13,
        textColor=colors.HexColor("#1e3a8a"),
        spaceBefore=18,
        spaceAfter=8,
    )
    notes_style = ParagraphStyle(
        "ReportNotes",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#475569"),
        spaceAfter=12,
    )

    elements: list[Any] = []

    report_title = title or f"Astra Reader Report — {data['experiment']['sample_name'] or data['experiment']['file_name']}"
    elements.append(Paragraph(report_title, title_style))

    exp = data["experiment"]
    meta_parts = []
    if exp["sample_name"]:
        meta_parts.append(f"Sample: <b>{exp['sample_name']}</b>")
    if exp["solvent_name"]:
        meta_parts.append(f"Solvent: {exp['solvent_name']}")
    if exp["operator_name"]:
        meta_parts.append(f"Operator: {exp['operator_name']}")
    if exp["collection_time"]:
        meta_parts.append(f"Collected: {exp['collection_time']}")
    elements.append(Paragraph(" &middot; ".join(meta_parts), meta_style))

    if notes:
        elements.append(Paragraph(notes.replace("\n", "<br/>"), notes_style))

    elements.append(Paragraph("Experiment Metadata", section_style))
    meta_rows = [
        ["Field", "Value"],
        ["File", exp["file_name"] or "—"],
        ["Sample", exp["sample_name"] or "—"],
        ["Solvent", exp["solvent_name"] or "—"],
        ["Solvent Description", exp["solvent_description"] or "—"],
        ["Operator", exp["operator_name"] or "—"],
        ["Collection Time", exp["collection_time"] or "—"],
        ["Processing Time", exp["processing_time"] or "—"],
        ["ASTRA Version", exp["astra_version"] or "—"],
    ]
    if data.get("mals_wavelength_nm"):
        meta_rows.append(["MALS Wavelength", f"{data['mals_wavelength_nm']} nm"])
    meta_table = Table(meta_rows, colWidths=[2.2 * inch, 4.3 * inch])
    meta_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(meta_table)

    elements.append(Paragraph("Peak Results Summary", section_style))
    peak_header = ["Peak", "Range (min)", "Mn", "Mw", "Mz", "Pd", "Rg (nm)", "Area", "Recovery"]
    peak_rows = [peak_header]
    for p in data["peaks"]:
        peak_rows.append([
            str(p["range_number"] if p["range_number"] is not None else p["peak_id"]),
            _fmt_range(p["range_start"], p["range_end"]),
            _fmt(p["mn"]),
            _fmt(p["mw"]),
            _fmt(p["mz"]),
            _fmt(p["polydispersity"], 3),
            _fmt(p["rms_radius"], 1),
            _fmt(p["peak_area"], 4),
            _fmt(p["recovery"], 1),
        ])
    peak_table = Table(peak_rows, colWidths=[0.5 * inch, 1.0 * inch, 0.8 * inch, 0.8 * inch, 0.8 * inch, 0.5 * inch, 0.6 * inch, 0.7 * inch, 0.7 * inch])
    peak_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(peak_table)

    if include_slice_data and data["has_slice_data"]:
        elements.append(Paragraph("Per-Slice Data (first 50 rows)", section_style))
        slice_header = ["Peak", "Time (min)", "M (g/mol)", "Rg (nm)", "c (g/mL)"]
        slice_rows = [slice_header]
        for s in data["slice_data"][:50]:
            slice_rows.append([
                str(s["peak_id"]),
                _fmt(s["time"], 3),
                _fmt(s["molar_mass"]),
                _fmt(s["radius_nm"], 1),
                _fmt(s["concentration"], 6),
            ])
        slice_table = Table(slice_rows, colWidths=[0.5 * inch, 0.9 * inch, 1.2 * inch, 0.8 * inch, 1.0 * inch])
        slice_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(slice_table)
        if len(data["slice_data"]) > 50:
            elements.append(Spacer(1, 6))
            elements.append(Paragraph(
                f"({len(data['slice_data']) - 50} more rows omitted — see CSV export for full data)",
                ParagraphStyle("hint", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#94a3b8")),
            ))

    from datetime import datetime
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(
        f"Generated by Astra Reader &middot; {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        ParagraphStyle("footer", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#94a3b8")),
    ))

    doc.build(elements)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def generate_csv_report(data: dict, include_slice_data: bool = True) -> bytes:
    """Generate a CSV report of peak results and (optionally) per-slice data.

    Returns UTF-8 encoded bytes.
    """
    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow(["# Astra Reader Report"])
    writer.writerow(["# File", data["experiment"]["file_name"]])
    writer.writerow(["# Sample", data["experiment"]["sample_name"] or ""])
    writer.writerow(["# Solvent", data["experiment"]["solvent_name"] or ""])
    writer.writerow(["# Operator", data["experiment"]["operator_name"] or ""])
    writer.writerow(["# Collected", data["experiment"]["collection_time"] or ""])
    writer.writerow([])

    writer.writerow([
        "peak", "range_start", "range_end",
        "Mn_g_mol", "Mw_g_mol", "Mz_g_mol", "Pd", "Rg_nm", "peak_area", "recovery",
    ])
    for p in data["peaks"]:
        writer.writerow([
            p["range_number"] if p["range_number"] is not None else p["peak_id"],
            _csv_val(p["range_start"]),
            _csv_val(p["range_end"]),
            _csv_val(p["mn"]),
            _csv_val(p["mw"]),
            _csv_val(p["mz"]),
            _csv_val(p["polydispersity"]),
            _csv_val(p["rms_radius"]),
            _csv_val(p["peak_area"]),
            _csv_val(p["recovery"]),
        ])

    if include_slice_data and data["has_slice_data"]:
        writer.writerow([])
        writer.writerow(["peak_id", "time_min", "molar_mass_g_mol", "radius_nm", "concentration_g_mL"])
        for s in data["slice_data"]:
            writer.writerow([
                s["peak_id"],
                _csv_val(s["time"]),
                _csv_val(s["molar_mass"]),
                _csv_val(s["radius_nm"]),
                _csv_val(s["concentration"]),
            ])

    return buf.getvalue().encode("utf-8")


def _csv_val(v: Any) -> str:
    """Format a value for CSV — empty string for NaN/None."""
    fv = _nan_to_none(v)
    if fv is None:
        return ""
    return repr(fv)


def generate_excel_report(data: dict, include_slice_data: bool = True) -> bytes:
    """Generate an Excel (.xlsx) report with peak results and per-slice data.

    Returns the raw .xlsx bytes.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    wb = Workbook()

    ws = wb.active
    ws.title = "Metadata"
    meta_entries = [
        ("File", data["experiment"]["file_name"]),
        ("Sample", data["experiment"]["sample_name"]),
        ("Solvent", data["experiment"]["solvent_name"]),
        ("Solvent Description", data["experiment"]["solvent_description"]),
        ("Operator", data["experiment"]["operator_name"]),
        ("Collection Time", data["experiment"]["collection_time"]),
        ("Processing Time", data["experiment"]["processing_time"]),
        ("ASTRA Version", data["experiment"]["astra_version"]),
    ]
    if data.get("mals_wavelength_nm"):
        meta_entries.append(("MALS Wavelength (nm)", data["mals_wavelength_nm"]))
    header_font = Font(bold=True)
    for row_idx, (label, val) in enumerate(meta_entries, start=1):
        ws.cell(row=row_idx, column=1, value=label).font = header_font
        ws.cell(row=row_idx, column=2, value=val if val is not None else "")

    ws2 = wb.create_sheet("Peak Results")
    peak_headers = ["Peak", "Range Start", "Range End", "Mn (g/mol)", "Mw (g/mol)", "Mz (g/mol)", "Pd", "Rg (nm)", "Area", "Recovery"]
    for col_idx, h in enumerate(peak_headers, start=1):
        cell = ws2.cell(row=1, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    for row_idx, p in enumerate(data["peaks"], start=2):
        vals = [
            p["range_number"] if p["range_number"] is not None else p["peak_id"],
            p["range_start"], p["range_end"],
            p["mn"], p["mw"], p["mz"], p["polydispersity"],
            p["rms_radius"], p["peak_area"], p["recovery"],
        ]
        for col_idx, v in enumerate(vals, start=1):
            ws2.cell(row=row_idx, column=col_idx, value=v)

    if include_slice_data and data["has_slice_data"]:
        ws3 = wb.create_sheet("Slice Data")
        slice_headers = ["Peak ID", "Time (min)", "Molar Mass (g/mol)", "Radius (nm)", "Concentration (g/mL)"]
        for col_idx, h in enumerate(slice_headers, start=1):
            cell = ws3.cell(row=1, column=col_idx, value=h)
            cell.font = header_font
            cell.fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
        for row_idx, s in enumerate(data["slice_data"], start=2):
            vals = [s["peak_id"], s["time"], s["molar_mass"], s["radius_nm"], s["concentration"]]
            for col_idx, v in enumerate(vals, start=1):
                ws3.cell(row=row_idx, column=col_idx, value=v)

    buf = io.BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()
    buf.close()
    return xlsx_bytes
