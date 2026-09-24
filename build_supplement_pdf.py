"""
Build Constitutional Law SUPPLEMENT PDF — combines Parts 1-4 into a single
styled HTML file with a linked Table of Contents for PDF export.
"""
import markdown2
import os
import re

SUPP_DIR = r"F:\Bianna - Law\Bianna-Law-Final"
OUTPUT_HTML = os.path.join(SUPP_DIR, "Bianna_ConLaw_Supplement_Complete.html")

PART_FILES = [
    "Con_Law_Supplement_Part1_Federalism_Commerce.md",
    "Con_Law_Supplement_Part2_DCC_Preemption_SOP.md",
    "Con_Law_Supplement_Part3_Master_Attack.md",
    "Con_Law_Supplement_Part4_Checks_Amendments.md",
]

CSS = r"""
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Fira+Code:wght@400&display=swap');

@page {
    size: letter;
    margin: 0.75in;
}

@media print {
    body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .cover { page-break-after: always; }
    .toc-page { page-break-after: always; }
    .part-break { page-break-before: always; }
    h1, h2, h3 { page-break-after: avoid; }
    table, pre, blockquote { page-break-inside: avoid; }
    .no-print { display: none !important; }
}

:root {
    --navy: #1a2744;
    --gold: #c9a227;
    --gold-light: #f5e6b8;
    --cream: #faf8f3;
    --charcoal: #2c2c2c;
    --brown: #5a4a3a;
    --blue: #2e5090;
    --red: #8b2232;
    --teal: #1a6b5a;
    --rule: #d4c9b0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'Source Sans Pro', 'Segoe UI', Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.55; color: var(--charcoal);
    max-width: 8.5in; margin: 0 auto; padding: 0.5in;
}
.print-btn {
    position: fixed; top: 16px; right: 16px; z-index: 999;
    background: var(--navy); color: #fff; border: none;
    padding: 12px 28px; font-size: 14px; font-weight: 700;
    border-radius: 6px; cursor: pointer; letter-spacing: 1px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: all 0.2s ease;
}
.print-btn:hover { background: var(--gold); color: var(--navy); }

/* COVER */
.cover {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 2.5in 0.5in 2in;
    min-height: 95vh;
}
.cover .seal { font-size: 54pt; margin-bottom: 8pt; }
.cover h1 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 28pt; color: var(--navy); letter-spacing: 2px;
    text-transform: uppercase; margin: 0 0 4pt; border: none;
}
.cover h2 {
    font-family: 'Source Sans Pro', sans-serif;
    font-size: 13pt; color: var(--gold); font-weight: 600;
    letter-spacing: 3px; text-transform: uppercase; margin: 0 0 6pt;
    border: none;
}
.cover h3 {
    font-family: 'Source Sans Pro', sans-serif;
    font-size: 11pt; color: var(--teal); font-weight: 600;
    letter-spacing: 2px; text-transform: uppercase; margin: 0 0 18pt;
    border: none;
}
.cover .bar {
    width: 260pt; height: 2.5pt; margin: 10pt auto;
    background: linear-gradient(90deg, transparent, var(--gold), transparent);
}
.cover .meta {
    font-size: 11pt; color: var(--brown); line-height: 2;
}
.cover .meta strong { color: var(--navy); }

/* TABLE OF CONTENTS PAGE */
.toc-page {
    padding: 0.5in 0;
}
.toc-page .toc-heading {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 20pt; color: var(--navy); text-align: center;
    border-bottom: 2.5pt solid var(--gold); padding-bottom: 6pt;
    margin-bottom: 18pt; letter-spacing: 2px;
}
.toc-section {
    margin-bottom: 14pt;
}
.toc-section-title {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 11pt; color: var(--navy); font-weight: 700;
    background: var(--cream); padding: 4pt 8pt;
    border-left: 3pt solid var(--gold);
    margin-bottom: 4pt;
}
.toc-entry {
    display: flex; align-items: baseline;
    padding: 2pt 0 2pt 16pt;
    font-size: 9.5pt;
}
.toc-entry.level-1 {
    padding-left: 8pt;
    font-weight: 700;
    font-size: 10pt;
    color: var(--navy);
    margin-top: 4pt;
}
.toc-entry.level-2 {
    padding-left: 20pt;
    font-weight: 600;
    color: var(--blue);
}
.toc-entry.level-3 {
    padding-left: 34pt;
    font-weight: 400;
    color: var(--charcoal);
    font-size: 9pt;
}
.toc-entry a {
    color: inherit; text-decoration: none;
    flex: 1;
}
.toc-entry a:hover {
    color: var(--gold);
}
.toc-dots {
    flex: 1;
    border-bottom: 1pt dotted var(--rule);
    margin: 0 6pt;
    min-width: 20pt;
}

/* HEADINGS */
h1 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 18pt; color: var(--navy);
    border-bottom: 2.5pt solid var(--gold);
    padding-bottom: 4pt; margin: 26pt 0 10pt;
}
h2 {
    font-size: 13pt; color: var(--blue); font-weight: 700;
    border-bottom: 1pt solid var(--rule);
    padding-bottom: 3pt; margin: 20pt 0 8pt;
}
h3 { font-size: 11pt; color: var(--navy); font-weight: 700; margin: 14pt 0 5pt; }
h4 { font-size: 10pt; color: var(--brown); font-weight: 700; margin: 10pt 0 4pt; }

/* TABLES */
table { width: 100%; border-collapse: collapse; margin: 8pt 0 14pt; font-size: 9.5pt; }
thead th {
    background: var(--navy); color: #fff; font-weight: 700;
    text-align: left; padding: 5pt 8pt; font-size: 8.5pt;
    letter-spacing: 0.5px; text-transform: uppercase;
}
td { padding: 4pt 8pt; border-bottom: 0.5pt solid var(--rule); vertical-align: top; }
tr:nth-child(even) { background: var(--cream); }

/* CODE / FLOWCHARTS */
code {
    font-family: 'Fira Code', Consolas, monospace;
    background: #f0ebe0; padding: 1pt 3pt; border-radius: 2pt;
    font-size: 8.5pt; color: var(--red);
}
pre {
    background: var(--navy); color: #e8dcc8;
    padding: 12pt 16pt; border-radius: 4pt;
    font-size: 8.5pt; line-height: 1.5;
    margin: 8pt 0 14pt; border-left: 3pt solid var(--gold);
    white-space: pre-wrap; word-wrap: break-word;
}
pre code { background: none; color: inherit; padding: 0; font-size: inherit; }

/* BLOCKQUOTES — Fisher Tips/Traps */
blockquote {
    border-left: 3pt solid var(--gold); background: var(--cream);
    margin: 8pt 0; padding: 8pt 14pt;
    font-style: italic; color: var(--brown); font-size: 9.5pt;
}
blockquote strong { color: var(--red); font-style: normal; }

/* LISTS */
ul, ol { margin: 4pt 0 8pt 20pt; }
li { margin-bottom: 2pt; }
li strong { color: var(--navy); }

hr { border: none; border-top: 1.5pt solid var(--gold); margin: 18pt 0; }
a { color: var(--blue); text-decoration: none; }
em { color: var(--brown); }
p { margin: 4pt 0; }

/* HEADER BAR */
.header-bar {
    text-align: center; font-size: 7.5pt; color: var(--brown);
    letter-spacing: 1.5px; text-transform: uppercase;
    border-bottom: 0.5pt solid var(--rule); padding-bottom: 4pt; margin-bottom: 8pt;
}
"""


def extract_toc_from_html(html_body):
    """Parse the generated HTML to extract headings with their IDs for TOC generation."""
    # Match h1, h2, h3 tags with their id attributes and text content
    pattern = re.compile(r'<(h[123])\s+id="([^"]+)"[^>]*>(.*?)</\1>', re.DOTALL)
    entries = []

    for match in pattern.finditer(html_body):
        tag = match.group(1)
        anchor_id = match.group(2)
        # Strip inner HTML tags to get plain text
        text = re.sub(r'<[^>]+>', '', match.group(3)).strip()

        # Skip empty or very short headings, and skip the supplement title headers themselves
        if not text or len(text) < 3:
            continue

        level = int(tag[1])  # 1, 2, or 3
        entries.append((level, anchor_id, text))

    return entries


def build_toc_html(entries):
    """Build a styled, linked Table of Contents page from heading entries."""
    # Group by Part (we identify Part boundaries by the H1 "CONSTITUTIONAL LAW SUPPLEMENT" headers)
    part_labels = {
        1: "PART 1: Federalism & The Commerce Power",
        2: "PART 2: Dormant Commerce Clause, Preemption & Separation of Powers",
        3: "PART 3: Master Exam Attack Frameworks",
        4: "PART 4: Checks & Balances, Amendments 1-27 & Criminal Procedure",
    }

    toc_lines = []
    toc_lines.append('<div class="toc-page">')
    toc_lines.append('  <div class="toc-heading">Table of Contents</div>')

    current_part = 0
    part_keywords = [
        ("FEDERALISM", 1),
        ("COMMERCE POWER", 1),
        ("DORMANT COMMERCE", 2),
        ("PREEMPTION", 2),
        ("SEPARATION OF POWERS", 2),
        ("MASTER ISSUE", 3),
        ("MASTER EXAM", 3),
        ("CROSS-REFERENCE", 3),
        ("CHECKS", 4),
        ("AMENDMENTS", 4),
        ("CRIMINAL PROCEDURE", 4),
    ]

    seen_parts = set()
    for level, anchor_id, text in entries:
        # Detect part transitions for section headers
        text_upper = text.upper()
        for kw, part_num in part_keywords:
            if kw in text_upper and part_num not in seen_parts and level == 1:
                seen_parts.add(part_num)
                current_part = part_num
                if part_num in part_labels:
                    toc_lines.append(f'  <div class="toc-section">')
                    toc_lines.append(f'    <div class="toc-section-title">{part_labels[part_num]}</div>')
                    toc_lines.append(f'  </div>')
                break

        level_class = f"level-{level}"
        toc_lines.append(f'  <div class="toc-entry {level_class}">')
        toc_lines.append(f'    <a href="#{anchor_id}">{text}</a>')
        toc_lines.append(f'    <span class="toc-dots"></span>')
        toc_lines.append(f'  </div>')

    toc_lines.append('</div>')
    return '\n'.join(toc_lines)


def build():
    md_parts = []
    for i, fname in enumerate(PART_FILES):
        path = os.path.join(SUPP_DIR, fname)
        if not os.path.isfile(path):
            print(f"WARNING: {fname} not found, skipping...")
            continue
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        # Add page break before each part (except the first)
        if i > 0:
            content = '<div class="part-break"></div>\n\n' + content
        md_parts.append(content)

    combined_md = '\n\n'.join(md_parts)
    html_body = markdown2.markdown(
        combined_md,
        extras=["tables", "fenced-code-blocks", "header-ids", "code-friendly"]
    )

    # Extract headings and build linked TOC
    toc_entries = extract_toc_from_html(html_body)
    toc_html = build_toc_html(toc_entries)

    cover = """
    <div class="cover">
        <div class="seal">&\#9878;&\#65039;</div>
        <h1>Constitutional Law</h1>
        <h2>Complete Supplement</h2>
        <h3>Parts 1&ndash;4 Combined Edition</h3>
        <div class="bar"></div>
        <div class="meta">
            <strong>Professor Keith R. Fisher</strong><br>
            Spring 2026<br><br>
            <strong>Bianna L. Estrella</strong><br>
            St. Thomas University College of Law<br><br>
            <em>Companion to the V2 Master Attack Outline<br>
            Deep IRACs &middot; Decision Trees &middot; Fisher Traps &middot; Amendments 1&ndash;27</em>
        </div>
        <div class="bar"></div>
    </div>
    """.replace("&\\#", "&#")

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Constitutional Law Supplement &mdash; Bianna L. Estrella</title>
<style>{CSS}</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">EXPORT TO PDF</button>
{cover}
{toc_html}
<div class="header-bar">
CONSTITUTIONAL LAW SUPPLEMENT &mdash; PROFESSOR FISHER &mdash; SPRING 2026 &mdash; BIANNA L. ESTRELLA
</div>
{html_body}
</body>
</html>"""

    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(full_html)

    size_kb = os.path.getsize(OUTPUT_HTML) / 1024
    toc_count = len(toc_entries)
    print(f"[OK] HTML saved: {OUTPUT_HTML}")
    print(f"     Size: {size_kb:.0f} KB")
    print(f"     Parts combined: {len(md_parts)}")
    print(f"     TOC entries: {toc_count}")
    print(f"\nOpen in browser and click 'EXPORT TO PDF' or press Ctrl+P to save as PDF.")


if __name__ == '__main__':
    build()
