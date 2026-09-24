import os
import requests
import json

# Configuration
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"

OUTLINE_PATH = "Bianna_Criminal_Law_Outline.md"
EXAM_CONTEXT_PATH = "full_exam_context.txt"
OUTPUT_MD = "Bianna_Criminal_Law_Mock_Final.md"

def load_file(path):
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def call_deepseek(prompt, system_message):
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
        "temperature": 0.5,
        "max_tokens": 8000
    }
    response = requests.post(API_URL, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return None

def main():
    print("Generating Mock Final Exam...")
    outline = load_file(OUTLINE_PATH)
    exam_context = load_file(EXAM_CONTEXT_PATH)

    system_message = f"""You are Professor DeWolf. You are known for your rigorous, MPC-focused Criminal Law exams.
Your exams typically consist of:
1. 12 Multiple Choice questions (often testing subtle MPC § 2.02 distinctions).
2. 2 Major Essay questions (fact patterns involving homicide, accomplice liability, and defenses).
3. A 'Question 2.5' or similar section comparing MPC to Common Law.

USE THE FOLLOWING SOURCE OF LAW (The Course Outline):
{outline[:5000]} ... (and your general knowledge of the full outline)

USE THE FOLLOWING STYLE GUIDE (Previous Finals):
{exam_context[:5000]}

TASK:
Generate a 'Likely Final Exam' for Spring 2026.
Include:
- 12 Multiple Choice Questions (with choices A-D or A-E).
- 2 Detailed Fact Pattern Essays.
- 1 Section comparing MPC to Non-MPC jurisdictions.
- AN ANSWER KEY with explanations for the Multiple Choice and a 'Checklist' of issues for the Essays.

CRITICAL:
- Ensure the questions cover the syllabus (Legality, Actus Reus, Mens Rea, Homicide, Inchoate Crimes, Complicity, Defenses).
- Use the 'Trap' and 'Issue' patterns from the previous finals.
"""

    prompt = "Please generate the complete Mock Final Exam for Bianna's Criminal Law course."
    
    result = call_deepseek(prompt, system_message)
    if result:
        with open(OUTPUT_MD, "w", encoding="utf-8") as f:
            f.write(result)
        print(f"Successfully generated {OUTPUT_MD}")
    else:
        print("Failed to generate exam.")

if __name__ == "__main__":
    main()
