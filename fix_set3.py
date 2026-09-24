import os
import requests

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"

def get_completion():
    with open("Bianna_Criminal_Law_Mock_Final_SET3.md", "r", encoding="utf-8") as f:
        current_content = f.read()

    prompt = f"""The following Mock Exam Answer Key was truncated. Please provide the COMPLETE and EXTENSIVE remaining section for:
PART III: ESSAY 2 — SAMPLE ANALYSIS
PART IV: ESSAY 2.5 — COMPARISON

Start from where it left off: "potential superseding causes".
Include detailed analysis for Eleanor, Leo, and Dr. Alistair.
Include the full comparison of Attempt law.

CONTEXT:
{current_content[-1000:]}
"""
    
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "system", "content": "You are Professor DeWolf finishing a detailed exam answer key."},
                     {"role": "user", "content": prompt}],
        "temperature": 0.5,
        "max_tokens": 4000
    }
    
    response = requests.post(API_URL, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        return f"Error: {response.status_code}"

completion = get_completion()
with open("Bianna_Criminal_Law_Mock_Final_SET3_COMPLETION.md", "w", encoding="utf-8") as f:
    f.write(completion)
print("Done")
