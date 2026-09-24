"""
Build Bianna-styled Constitutional Law Outline PDF using browser print.
Combines all 4 parts into a single styled HTML file, then user prints to PDF via browser.
"""
import markdown2
import os

PARTS_DIR = r"C:\Users\ibeli\.gemini\antigravity\brain\d70825d5-45c5-4881-80fa-74dc14275df3\artifacts"
OUTPUT_HTML = r"F:\Bianna - Law\Bianna-Law-Final\Bianna_Constitutional_Law_Outline.html"

PART_FILES = [
    "con_law_master_outline_part1.md",
    "con_law_master_outline_part2.md",
    "con_law_master_outline_part3.md",
    "con_law_master_outline_part4.md",
    "con_law_master_outline_part5.md",
]

CSS = r"""
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Sans+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Fira+Code:wght@400&display=swap');

@page {
    size: letter;
    margin: 0.75in;
}

@media print {
    body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .cover { page-break-after: always; min-height: 95vh; }
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
}
.print-btn:hover { background: var(--gold); color: var(--navy); }

/* COVER */
.cover {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center; padding: 2.5in 0.5in 2in;
}
.cover .seal { font-size: 54pt; margin-bottom: 8pt; }
.cover h1 {
    font-family: 'Playfair Display', Georgia, serif;
    font-size: 30pt; color: var(--navy); letter-spacing: 2px;
    text-transform: uppercase; margin: 0 0 4pt; border: none;
}
.cover h2 {
    font-family: 'Source Sans Pro', sans-serif;
    font-size: 14pt; color: var(--gold); font-weight: 600;
    letter-spacing: 3px; text-transform: uppercase; margin: 0 0 18pt;
    border: none;
}
.cover .bar {
    width: 220pt; height: 2.5pt; margin: 10pt auto;
    background: linear-gradient(90deg, transparent, var(--gold), transparent);
}
.cover .meta {
    font-size: 11pt; color: var(--brown); line-height: 2;
}
.cover .meta strong { color: var(--navy); }

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

/* BLOCKQUOTES */
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

/* HEADER / FOOTER for screen */
.header-bar {
    text-align: center; font-size: 7.5pt; color: var(--brown);
    letter-spacing: 1.5px; text-transform: uppercase;
    border-bottom: 0.5pt solid var(--rule); padding-bottom: 4pt; margin-bottom: 8pt;
}
"""

def build():
    md_parts = []
    for i, fname in enumerate(PART_FILES):
        path = os.path.join(PARTS_DIR, fname)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        if i > 0:
            lines = content.split('\n')
            filtered = []
            skip = 0
            for line in lines:
                if skip < 2 and (line.startswith('# ⚖') or line.startswith('## PART')):
                    skip += 1
                    continue
                filtered.append(line)
            content = '\n'.join(filtered)
            content = '<div class="part-break"></div>\n\n' + content
        md_parts.append(content)

    combined_md = '\n\n'.join(md_parts)
    html_body = markdown2.markdown(
        combined_md,
        extras=["tables", "fenced-code-blocks", "header-ids", "code-friendly"]
    )

    cover = """
    <div class="cover">
        <div class="seal">⚖️</div>
        <h1>Constitutional Law</h1>
        <h2>Master Attack Outline</h2>
        <div class="bar"></div>
        <div class="meta">
            <strong>Professor Keith R. Fisher</strong><br>
            Spring 2026<br><br>
            <strong>Bianna L. Estrella</strong><br>
            St. Thomas University College of Law<br><br>
            <em>Exam-Ready Reference<br>All Doctrines · Decision Trees · Case Tables · Fisher Strategies</em>
        </div>
    </div>
    """

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Constitutional Law Outline — Bianna L. Estrella</title>
<style>{CSS}</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">⬇ EXPORT TO PDF</button>
{cover}
<div class="header-bar">
CONSTITUTIONAL LAW OUTLINE — PROFESSOR FISHER — SPRING 2026 — BIANNA L. ESTRELLA
</div>
{html_body}
</body>
</html>"""

    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(full_html)
    print(f"HTML saved: {OUTPUT_HTML}")
    print(f"Size: {os.path.getsize(OUTPUT_HTML) / 1024:.0f} KB")
    print("Open in browser and click 'EXPORT TO PDF' or press Ctrl+P to save as PDF.")

if __name__ == '__main__':
    build()
