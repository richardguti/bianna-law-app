import zipfile
import xml.etree.ElementTree as ET
import sys

sys.stdout.reconfigure(encoding='utf-8')

docx_path = r"F:\Bianna - Law\SPRING CLASSES AND OUTLINES\1. CRIMINAL LAW OUTLINE.docx"

ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

with zipfile.ZipFile(docx_path) as z:
    with z.open('word/document.xml') as f:
        tree = ET.parse(f)
        root = tree.getroot()

lines = []
for para in root.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'):
    texts = []
    for r in para.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t'):
        if r.text:
            texts.append(r.text)
    line = ''.join(texts)
    if line.strip():
        lines.append(line)

output = '\n'.join(lines)
with open('docx_content.txt', 'w', encoding='utf-8') as f:
    f.write(output)

print(f"Extracted {len(lines)} lines, {len(output)} characters")
