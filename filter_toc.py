import json

with open("toc_output.json", "r", encoding="utf-8") as f:
    data = json.load(f)

page_ranges = [
    (1, 53),
    (189, 248),
    (248, 294),
    (294, 350),
    (350, 375),
    (378, 405),
    (405, 460),
    (1161, 1170),
    (567, 626),
    (627, 644),
    (651, 685),
    (685, 741),
    (759, 760),
    (803, 832),
    (832, 896),
    (896, 960),
    (960, 990)
]

OFFSET = 68

print("--- CASES AND SECTIONS BY READING RANGE ---")
for r in page_ranges:
    start_pdf = r[0] + OFFSET
    end_pdf = r[1] + OFFSET
    
    print(f"\n--- Pages {r[0]}-{r[1]} ---")
    for item in data:
        if start_pdf <= item['page'] <= end_pdf:
            # We want notable cases. These usually have " v. " or "In re " etc.
            # But we also want the chapter/section headers to structure the outline.
            if item['level'] <= 2 or " v. " in item['title'] or "In re " in item['title']:
                print(f"{item['title']} (Book Page {item['page'] - OFFSET})")
