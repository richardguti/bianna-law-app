import json

with open("toc_output.json", "r", encoding="utf-8") as f:
    data = json.load(f)

for item in data[:40]:
    print(f"Title: {item['title']} - Page: {item['page']}")
