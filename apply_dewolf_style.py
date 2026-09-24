import os
import requests

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"

def get_dewolf_style_answers(set_number, exam_context):
    prompt = f"""You are Professor David K. DeWolf (Gonzaga Law, Yale JD). You are writing the SAMPLE MODEL ANSWERS for your Criminal Law Final Exam (SET {set_number}).

YOUR WRITING STYLE:
- FORMAL & ACADEMIC: Use high-level legal vocabulary (e.g., 'interposed', 'doctrinal incoherence', 'palpable tension').
- TAXONOMY OF APPROACHES: Don't just give one answer. Explain how 'Some courts take Path A, while others prefer Path B.'
- PHILOSOPHICAL DEPTH: Connect issues to the 'Principle of Legality' and the 'Morality of Punishment' (Retribution vs. Utility).
- CITATION RIGOR: Cite specific MPC sections (§) and cases where possible.
- STRUCTURE: Use 'GOAL', 'ANALYSIS', and 'CONCLUSION' headers for Fact Pattern answers. Use formal academic headings for Policy essays.

FACT PATTERN / POLICY TOPIC FOR SET {set_number}:
{exam_context}

TASK:
Rewrite the ESSAY 1 (Policy) and ESSAY 2 (Fact Pattern) model answers in YOUR VOICE. 
Ensure they are EXTENSIVE (Essay 1: 800-1000 words, Essay 2: 600-800 words).

Output the rewritten answers starting from '## DEWOLF MODEL ANSWERS -- SET {set_number}'.
"""
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": "You are Professor David K. DeWolf."},
                     {"role": "user", "content": prompt}],
        "temperature": 0.5,
        "max_tokens": 8000
    }
    response = requests.post(API_URL, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"Error: {response.status_code}"

# Set 1 Context
exam1_context = "Policy: MPC § 2.02 and the Principle of Legality. Fact Pattern: Homicide/Accomplice involving a shooting at a park."
# Set 2 Context
exam2_context = "Policy: Mixed Theory of Punishment & 3 Strikes. Fact Pattern: Botched Armored Car Robbery (Dwayne, Marcus, Elena)."
# Set 3 Context
exam3_context = "Policy: Insanity Control Prong vs. Cognitive Prong. Fact Pattern: Domestic Tragedy (Eleanor, Richard, Leo, Dr. Alistair)."

# Generate all 3
print("Generating Set 1 DeWolf Answers...")
key1 = get_dewolf_style_answers(1, exam1_context)
with open("Bianna_Criminal_Law_Mock_Final_SET1_DEWOLF.md", "w", encoding="utf-8") as f:
    f.write(key1)

print("Generating Set 2 DeWolf Answers...")
key2 = get_dewolf_style_answers(2, exam2_context)
with open("Bianna_Criminal_Law_Mock_Final_SET2_DEWOLF.md", "w", encoding="utf-8") as f:
    f.write(key2)

print("Generating Set 3 DeWolf Answers...")
key3 = get_dewolf_style_answers(3, exam3_context)
with open("Bianna_Criminal_Law_Mock_Final_SET3_DEWOLF.md", "w", encoding="utf-8") as f:
    f.write(key3)

print("DeWolf persona answers generated.")
