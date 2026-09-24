import os
import requests

# Configuration
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-4d35de213ac046c19dfa8fa10704daff")
API_URL = "https://api.deepseek.com/chat/completions"
MODEL = "deepseek-chat"

OUTLINE_PATH = "Bianna_Criminal_Law_Outline.md"
EXAM_CONTEXT_PATH = "full_exam_context.txt"

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
        return f"Error: {response.status_code} - {response.text}"

def generate_full_exam(set_number, policy_topic, fact_pattern_theme):
    print(f"Generating EXTENSIVE Mock Exam Set {set_number}...")
    outline = load_file(OUTLINE_PATH)
    exam_context = load_file(EXAM_CONTEXT_PATH)

    system_message = f"""You are Professor DeWolf. You write EXTREMELY EXTENSIVE, challenging, and detailed Criminal Law exams.
Your exams are legendary for their complexity and depth.

REPLICA REQUIREMENTS:
1. 12 MULTIPLE CHOICE (36 Points): Each question must have a complex fact pattern (80-120 words) and 4-5 options. Every option must be plausible, and the Answer Key must explain why EACH wrong option is incorrect, citing specific MPC sections.
2. ESSAY 1 (POLICY - 20 Points): This is a formal essay prompt.
   - Summarize the doctrine (MPC vs Common Law).
   - Provide a deep philosophical critique (Retribution, Utility, Legality).
   - Provide a rigorous counter-argument.
   - Total expected length of answer: 800-1000 words.
3. ESSAY 2 (FACT PATTERN - 30 Points): A 400-600 word narrative with at least 3 distinct "acts" and 3-4 characters. It must involve:
   - Complex Causation (But-for vs Proximate).
   - Accomplice Liability (Purpose vs Knowledge).
   - Specific Defenses (Duress, Self-Defense, Intoxication, Insanity).
4. ESSAY 2.5 (COMPARISON - 14 Points): A detailed comparison of a specific doctrine (e.g., Conspiracy or Attempt) between MPC and Common Law.

SOURCE MATERIAL:
OUTLINE: {outline[:8000]}
PREVIOUS FINALS: {exam_context[:8000]}

TASK:
Produce SET {set_number} as a high-fidelity replica.
Policy Topic: {policy_topic}
Fact Pattern Theme: {fact_pattern_theme}
"""

    prompt = f"Please generate the complete, EXTENSIVE Mock Final Exam Set {set_number}."
    return call_deepseek(prompt, system_message)

def main():
    # Set 2: Punishment & Felony Murder
    exam2 = generate_full_exam(2, 
        "Critique the Mixed Theory of Punishment (Hart/Rawls) and its application to the 'Three Strikes' proportionality debate.",
        "A multi-party botched robbery involving 'The Lookout', 'The Trigger-man', and 'The Accomplice who tried to quit'. Focus on Felony Murder Presumptions, Accomplice Liability, and the Withdrawal/Renunciation defense.")
    
    with open("Bianna_Criminal_Law_Mock_Final_SET2.md", "w", encoding="utf-8") as f:
        f.write(exam2)
    
    # Set 3: Insanity & Domestic Violence
    exam3 = generate_full_exam(3, 
        "Critique the MPC's 'Substantial Capacity' test for Insanity vs. the Federal/M'Naghten standard. Focus on the abolition of the 'Control Prong' after Hinckley.",
        "A domestic tragedy involving Battered Woman Syndrome, 'Imperfect' Self-Defense, and Homicide grading. Focus on EMED (§ 210.3), Mistake as to Self-Defense (§ 3.04/3.09), and Causation.")
    
    with open("Bianna_Criminal_Law_Mock_Final_SET3.md", "w", encoding="utf-8") as f:
        f.write(exam3)

    print("Successfully generated extensive Set 2 and Set 3.")

if __name__ == "__main__":
    main()
