import os
import requests

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"

def get_full_key_set3():
    prompt = """You are Professor DeWolf. You need to provide the COMPLETE and EXTENSIVE Answer Key for Mock Final Exam SET 3.
The previous version was truncated and had the wrong fact pattern.

EXAM OVERVIEW:
- Policy Essay: Insanity Control Prong vs. Cognitive Prong.
- Fact Pattern: Domestic Tragedy (Eleanor, Richard, Leo, Dr. Alistair).

REQUIREMENTS:
- 12 Multiple Choice Explanations (Full analysis of all 4-5 options for each).
- Essay 1 Policy Model Answer (800-1000 words).
- Essay 2 Fact Pattern Model Answer (Detailed analysis of Eleanor, Leo, Dr. Alistair).
- Essay 2.5 Comparison (Attempt).

Output the COMPLETE ANSWER KEY starting from '## ANSWER KEY -- SET 3'.
"""
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": "You are Professor DeWolf."},
                     {"role": "user", "content": prompt}],
        "temperature": 0.5,
        "max_tokens": 8000
    }
    response = requests.post(API_URL, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"Error: {response.status_code}"

new_key = get_full_key_set3()
with open("Bianna_Criminal_Law_Mock_Final_SET3_KEY.md", "w", encoding="utf-8") as f:
    f.write(new_key)
print("Set 3 Key generated.")
