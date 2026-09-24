import os
import re
import json
import requests
import time
from markdown_pdf import MarkdownPdf, Section

# Configuration
# API key MUST be in environment variable for security
API_KEY = os.environ.get("DEEPSEEK_API_KEY")
if not API_KEY:
    raise RuntimeError("Please set the DEEPSEEK_API_KEY environment variable.")

API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"

DOCX_CONTENT_PATH = "docx_content.txt"
STYLE_PATH = "skills/bia-outline-style.txt"
EXAM_CONTEXT_PATH = "exam_context.txt"
OUTPUT_MD = "Bianna_Criminal_Law_Outline.md"
OUTPUT_PDF = "Bianna_Criminal_Law_Outline.pdf"

def load_file(path):
    if not os.path.exists(path):
        return "" # Return empty if optional file missing
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def call_deepseek(prompt, system_message, retries=3):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    data = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system_message},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "max_tokens": 8000 
    }
    
    for attempt in range(retries):
        try:
            print(f"  [API] Sending request ({len(prompt)} chars)...")
            response = requests.post(API_URL, headers=headers, json=data, timeout=180)
            if response.status_code == 200:
                return response.json()["choices"][0]["message"]["content"]
            elif response.status_code == 429:
                print(f"  [API] Rate limited. Retrying in 30s... (Attempt {attempt + 1}/{retries})")
                time.sleep(30)
            else:
                print(f"  [API] Error {response.status_code}: {response.text}")
                time.sleep(10)
        except Exception as e:
            print(f"  [API] Request failed: {e}. Retrying in 5s...")
            time.sleep(5)
    
    return None

def split_content_into_safe_chunks(content, max_words=5000):
    # Ensure any text before the first marker is captured
    if not re.match(r"(?i)WEEK\s+\d+|CHAPTER\s+\d+", content):
        content = "SECTION START\n" + content
        
    # First split by the original markers
    raw_chunks = re.split(r"(?i)(?=WEEK\s+\d+|CHAPTER\s+\d+|SECTION\s+START)", content)
    safe_chunks = []
    
    for chunk in raw_chunks:
        chunk = chunk.strip()
        if not chunk: continue
        
        words = chunk.split()
        if len(words) <= max_words:
            safe_chunks.append(chunk)
        else:
            print(f"  [Split] Chunk too large ({len(words)} words), sub-splitting...")
            # Sub-split into smaller pieces at paragraph breaks or double newlines
            paragraphs = re.split(r"\n\s*\n", chunk)
            current = ""
            for p in paragraphs:
                if len((current + "\n\n" + p).split()) > max_words:
                    if current:
                        safe_chunks.append(current.strip())
                    current = p
                else:
                    current += "\n\n" + p if current else p
            if current:
                safe_chunks.append(current.strip())
                
    return safe_chunks

def main():
    print("=== Criminal Law Outline Generator ===")
    try:
        content = load_file(DOCX_CONTENT_PATH)
        style_guide = load_file(STYLE_PATH)
        exam_context = load_file(EXAM_CONTEXT_PATH)
        
        if not content:
            print(f"Error: {DOCX_CONTENT_PATH} is empty or missing.")
            return
    except Exception as e:
        print(f"Initialization error: {e}")
        return

    chunks = split_content_into_safe_chunks(content)
    print(f"Ready to process {len(chunks)} chunks.")

    system_message = f"""You are a senior law professor and mentor. 
Your task is to transform raw criminal law notes into a professional 'SOP-style' learning handbook.

STYLE GUIDE:
{style_guide}

PROFESSOR'S EXAM STYLE & CONTEXT (Include relevant 'Exam Tips' or 'Traps' based on these patterns):
{exam_context[:4000]} # Limit context to save tokens

INSTRUCTIONS:
1. Apply Bianna's strict formatting (Roman numerals, elements, exceptions).
2. For EVERY case, use the IRAC mini-brief format.
3. At the end of each doctrine, add a 'Common Exam Issues / Traps' section based on the Professor's style.
4. Mentorship tone: guide the student through the nuances of MPC vs. Common Law.
5. NO flowing paragraphs. Use structured bullets.
6. Headers: **<u>TITLE</u>**
"""

    full_markdown = ""
    
    for i, chunk in enumerate(chunks):
        words = len(chunk.split())
        title_match = re.match(r"(?i)(WEEK\s+\d+|CHAPTER\s+\d+|SECTION\s+START)", chunk)
        section_title = title_match.group(0) if title_match else f"Part {i+1}"
        
        print(f"[{i+1}/{len(chunks)}] Processing {section_title} ({words} words)...")
        
        prompt = f"Format and expand these notes into the outline. Focus on legal precision and the professor's exam nuances:\n\n{chunk}"
        
        result = call_deepseek(prompt, system_message)
        if result:
            full_markdown += result + "\n\n---\n\n"
            # Intermediate save
            with open(OUTPUT_MD, "w", encoding="utf-8") as f:
                f.write(full_markdown)
        else:
            print(f"!!! FAILED chunk {i+1} !!!")

    if not full_markdown:
        print("No content generated. Skipping PDF.")
        return

    print("Generating final PDF...")
    try:
        pdf = MarkdownPdf(toc_level=2)
        pdf.add_section(Section(full_markdown))
        pdf.save(OUTPUT_PDF)
        print(f"Successfully generated {OUTPUT_PDF}")
    except Exception as e:
        print(f"Error generating PDF: {e}")

if __name__ == "__main__":
    main()
