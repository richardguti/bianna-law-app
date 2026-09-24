"""Export the combined supplement HTML to PDF using headless Chromium via Playwright."""
import asyncio
from playwright.async_api import async_playwright
import os

INPUT_HTML = r"F:\Bianna - Law\Bianna-Law-Final\Bianna_ConLaw_Supplement_Complete.html"
OUTPUT_PDF = r"F:\Bianna - Law\Con-Law-Supplement-V1.pdf"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        file_url = "file:///" + INPUT_HTML.replace("\\", "/").replace(" ", "%20")
        print(f"Loading: {file_url}")
        await page.goto(file_url, wait_until="networkidle", timeout=60000)

        # Wait for fonts to load
        await page.wait_for_timeout(3000)

        await page.pdf(
            path=OUTPUT_PDF,
            format="Letter",
            margin={"top": "0.75in", "bottom": "0.75in", "left": "0.75in", "right": "0.75in"},
            print_background=True,
            display_header_footer=False,
        )

        await browser.close()

    size_mb = os.path.getsize(OUTPUT_PDF) / (1024 * 1024)
    print(f"PDF saved: {OUTPUT_PDF}")
    print(f"Size: {size_mb:.1f} MB")

asyncio.run(main())
