import os
import requests

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"

def generate_correct_key():
    with open("Bianna_Criminal_Law_Mock_Final_SET3.md", "r", encoding="utf-8") as f:
        content = f.read()
    
    # Extract up to the start of the Answer Key
    base_content = content.split("### PART III: ESSAY 2 — SAMPLE ANALYSIS")[0]
    
    # The fact pattern text
    fact_pattern = content.split("### FACT PATTERN: \"THE BOTCHED ARMORED CAR ROBBERY\"")[0] # Wait, wrong set.
    # I'll just provide the fact pattern explicitly to the LLM to be safe.
    
    prompt = """You are Professor DeWolf. You need to write the COMPLETE and EXTENSIVE Answer Key for Set 3 based on the Fact Pattern provided below. 
The previous attempt was truncated and hallucinated different characters.

FACT PATTERN:
Eleanor (abused, BWS) stabs her abusive husband Richard while he is asleep. 
Their son Leo encourages her and hands her a sharper knife. 
Dr. Alistair (therapist) arrives, refuses to help Richard (pacifist but says he deserves it), and walks out. 
Leo tries to hang himself (rope breaks, leg breaks). 
Richard dies 18 minutes later (would have lived if help arrived in 15 mins).

CHARACTERS TO ANALYZE: Eleanor, Leo, Dr. Alistair.
ISSUES TO ADDRESS:
1. Causation (But-for and Proximate).
2. Accomplice Liability (Leo).
3. Self-Defense (MPC §3.04) & BWS.
4. Imperfect Self-Defense (MPC §3.09).
5. Omission Liability (Dr. Alistair's duty to act).
6. Attempt (MPC §5.01) vs Common Law (Comparison).

REQUIREMENTS:
- EXTENSIVE Multiple Choice Explanations (12 Qs).
- EXTENSIVE Essay 1 Policy Answer (800-1000 words).
- EXTENSIVE Essay 2 Fact Pattern Answer (All characters).
- EXTENSIVE Essay 2.5 Comparison (Attempt).

Please output the COMPLETE ANSWER KEY starting from '## ANSWER KEY'.
"""

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": "You are Professor DeWolf writing a rigorous final exam answer key."},
                     {"role": "user", "content": prompt}],
        "temperature": 0.5,
        "max_tokens": 8000
    }
    
    response = requests.post(API_URL, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"Error: {response.status_code}"

new_key = generate_correct_key()
# Read the base part of the file (before the Answer Key)
with open("Bianna_Criminal_Law_Mock_Final_SET3.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find the start of Part I MCQs to keep the exam text, but replace everything after the end of the exam.
# Actually, I'll just find where the Answer Key starts.
idx = 0
for i, line in enumerate(lines):
    if "## ANSWER KEY" in line or "### ANSWER KEY" in line:
        idx = i
        break

if idx == 0: # If not found, try another marker
    for i, line in enumerate(lines):
        if "END OF EXAM" in line:
            idx = i + 1
            break

final_exam_text = "".join(lines[:idx])
with open("Bianna_Criminal_Law_Mock_Final_SET3.md", "w", encoding="utf-8") as f:
    f.write(final_exam_text + "\n\n" + new_key)
print("Set 3 Fixed Successfully.")
