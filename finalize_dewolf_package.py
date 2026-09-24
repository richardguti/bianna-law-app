import os

def update_file_with_dewolf_answers(md_file, dewolf_file):
    with open(md_file, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    with open(dewolf_file, "r", encoding="utf-8") as f:
        dewolf_answers = f.read()
    
    # Find the start of the Answer Key or the first Essay
    idx = 0
    for i, line in enumerate(lines):
        if "PART II: ESSAY 1" in line or "PART II: ESSAY 1" in line:
            # We want to keep the question but replace the MODEL ANSWER if it exists.
            # Actually, the DeWolf files contain both Question and Answer in his style.
            # So I should find where the Answer Key starts and replace from there.
            pass

    # Better approach: find "## ANSWER KEY"
    idx = -1
    for i, line in enumerate(lines):
        if "## ANSWER KEY" in line or "### ANSWER KEY" in line:
            idx = i
            break
    
    if idx == -1:
        # Fallback to "END OF EXAM"
        for i, line in enumerate(lines):
            if "END OF EXAM" in line or "END OF EXAMINATION" in line:
                idx = i + 1
                break
    
    if idx != -1:
        base_text = "".join(lines[:idx])
        # The DeWolf files start with "## DEWOLF MODEL ANSWERS"
        # I'll just append them.
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(base_text + "\n\n" + dewolf_answers)
        return True
    return False

# Update all 3
update_file_with_dewolf_answers("Bianna_Criminal_Law_Mock_Final.md", "Bianna_Criminal_Law_Mock_Final_SET1_DEWOLF.md")
update_file_with_dewolf_answers("Bianna_Criminal_Law_Mock_Final_SET2.md", "Bianna_Criminal_Law_Mock_Final_SET2_DEWOLF.md")
update_file_with_dewolf_answers("Bianna_Criminal_Law_Mock_Final_SET3.md", "Bianna_Criminal_Law_Mock_Final_SET3_DEWOLF.md")

# Now regenerate PDFs
from markdown_pdf import MarkdownPdf, Section

def to_pdf(src, out):
    with open(src, 'r', encoding='utf-8') as f:
        content = f.read()
    pdf = MarkdownPdf(toc_level=0)
    pdf.add_section(Section(content))
    pdf.save(out)

to_pdf('Bianna_Criminal_Law_Mock_Final.md', 'Bianna_Criminal_Law_Mock_Final.pdf')
to_pdf('Bianna_Criminal_Law_Mock_Final_SET2.md', 'Bianna_Criminal_Law_Mock_Final_SET2.pdf')
to_pdf('Bianna_Criminal_Law_Mock_Final_SET3.md', 'Bianna_Criminal_Law_Mock_Final_SET3.pdf')

print("All exams updated with DeWolf style answers and PDFs regenerated.")
