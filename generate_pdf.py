from markdown_pdf import MarkdownPdf, Section

pdf = MarkdownPdf(toc_level=2)
pdf.add_section(Section(open("Bianna_Criminal_Law_Outline.md", "r", encoding="utf-8").read()))
pdf.save("Bianna_Criminal_Law_Outline.pdf")
print("PDF generated successfully.")
