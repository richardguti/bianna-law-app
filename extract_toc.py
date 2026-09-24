import PyPDF2
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')

pdf_path = r"F:\Leviathan-Law-Obsidian-Memory\Leviathan-Law\Criminal Law and its Processes_ Cases and Materials (Aspen -- Sanford H_ Kadish, Stephen J_ Schulhofer, Rachel E_ Barkow -- 11, 2022 -- Aspen -- 7ed19946bc075a5d5761985dc07c058e -- Anna’s Archive.pdf"

try:
    reader = PyPDF2.PdfReader(pdf_path)
    outline = reader.outline

    result = []
    
    def process_outline(item, level=0):
        if isinstance(item, list):
            for i in item:
                process_outline(i, level + 1)
        elif isinstance(item, PyPDF2.generic.Destination):
            title = item.title
            try:
                page_num = reader.get_destination_page_number(item) + 1
            except:
                page_num = -1
            result.append({"title": title, "page": page_num, "level": level})

    process_outline(outline)
    
    with open("toc_output.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print("TOC extraction complete.")
except Exception as e:
    print(f"Error: {e}")
