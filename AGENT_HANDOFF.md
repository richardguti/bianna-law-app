# AGENT_HANDOFF: Senior Law Partner Architecture & Execution Roadmap

**Target Agent:** Claude Code
**Role:** Execution & Integration Developer
**Context:** "Senior Law Partner" is a local desktop application built exclusively for a 1L law student named Bianna. The application acts as a specialized AI legal mentor and study interface, running completely locally to bypass CORS limitations and allow direct native file system access.
**Tech Stack:** Electron.js (Node.js Backend, HTML/CSS/JS or React Frontend), SQLite/ChromaDB/LanceDB (for local RAG), `docx`/`jspdf` (Document Generation).

This document serves as the absolute source of truth for the development phases. Please execute the following 5 phases in order, ensuring all architectural guidelines are met.

---

## Phase 1: Electron Scaffolding & Secure IPC Setup

**Objective:** Establish the foundational Electron architecture, ensuring secure communication between the frontend and the local node environment.

**Tasks:**
1.  **Initialize App:**
    *   Set up a new Node.js project (`npm init -y`) and install `electron` as a dev dependency.
    *   Create the main entry point (`main.js`).
    *   Create a basic `index.html` for the frontend.
2.  **Secure IPC Architecture:**
    *   Implement a `preload.js` script to expose specific, secure APIs to the renderer process via `contextBridge`. **Do not enable `nodeIntegration` in the renderer.**
    *   Establish `ipcMain` and `ipcRenderer` channels (e.g., `ai-prompt-send`, `ai-response-receive`, `generate-document`, `open-settings`) to safely pass text prompts and commands from the UI to the local Node backend.
3.  **API Key Management:**
    *   Install and integrate `electron-store`.
    *   Build a secure, one-time-entry modal in the UI for Bianna to input and save her Anthropic API key.
    *   Ensure the API key is retrieved by the `main.js` process from `electron-store` securely and never exposed to the renderer process beyond checking for its existence.

## Phase 2: The Split-Pane UI Layout

**Objective:** Build the core user interface focusing on a split-pane "IDE-style" layout built with CSS Grid/Flexbox, adhering to the "Sage Green" aesthetic guidelines.

**Tasks:**
1.  **Layout Structure:**
    *   Implement a modular layout using CSS Grid or Flexbox. It should feature a collapsible "Folders / File Explorer" sidebar (similar to Westlaw) on the far end, and a split-pane for the Video Hub / AI Chat. Ensure all panes are responsive and resizable.
2.  **Aesthetic Guidelines & Branding:**
    *   **Atomic Design System:** Apply a strict "Quimbee-Style" UI kit. Shift from plain sage green to a structured UI with cleanly defined Atoms (bold typography, pill-shaped chips in green/red/orange, rounded text fields), Molecules (clean card-based layouts), and Organisms.
    *   **Color Palette:** Use a modern white/light gray background scheme, primary orange action buttons, and secondary black/dark buttons. Ensure all corners are smoothly rounded and elements have appropriate padding.
    *   **Avatar & App Icon:** Use an Animal Crossing-style character (a girl with black wavy hair, brown eyes, wearing a green argyle sweater) as Bianna's main profile/chat icon throughout the UI. Ensure this artwork is also configured in Phase 5 as the primary application icon for the `.exe`.
3.  **Folders / Sidebar (Study Repository):**
    *   **File Explorer Panel:** A dedicated sidebar (replicating Westlaw's folder view) mapped to the `~/Documents/Bianna_Law/` directory. It must allow Bianna to directly select, view, and organize her saved outlines, cases, and PDFs within the portal natively without needing the OS file explorer.
    *   **Native File Viewer:** When Bianna clicks a file in this folder view (like a PDF or DOCX), explicitly render it **inside** the app's split-pane UI. **Crucial Fix:** Force local rendering using an embedded viewer (e.g., `pdf.js` for PDFs) inside a dedicated pane. Absolutely prevent defaults that launch external viewers like Microsoft Edge.
4.  **Left Pane (Quimbee-Mirror Hub):**
    *   **Video/Mini-Browser Player:** Implement a seamless embedded `<webview>`. Set the default homepage to `https://www.google.com` upon launch. **Crucial Fix for Browser:** Resolve the "half black screen" and "typing disappears after first search" bugs by ensuring the webview is properly styled (`flex: 1`, `width: 100%, height: 100%`) and that the main renderer process is not aggressively stealing input focus from the embedded browser.
    *   **Auto-Transcript Extraction:** Include a feature that automatically pulls and populates the YouTube video transcript metadata whenever a video URL is loaded or pasted.
    *   **Scrolling Transcript Box:** A dedicated text area that automatically scrolls or updates alongside the video player using the extracted transcript.
    *   **Difficulty Toggle:** Interactive UI elements (buttons/dropdown) for Easy, Medium, and Hard to dynamic control quiz/question generation based on the transcript.
5.  **Right Pane (Senior Law Partner Interface):**
    *   **Chat UI:** A sleek, conversational interface for Socratic legal mentoring with the AI. Must support markdown rendering. Include a clear "Attach File" button (e.g., a paperclip icon) in the chat input area so Bianna can easily upload PDFs/Word documents for analysis.
    *   **1-Click Outline Exporter:** A prominent input area/button that accepts case links or raw text to trigger the outline/brief generation flow.

## Phase 3: Local Tools & Native File System Integration

**Objective:** Grant the local Node backend the ability to write structured output formats directly to Bianna's local OS.

**Tasks:**
1.  **File System (`fs`) Integration:**
    *   Use Node's native `fs` and `path` modules in `main.js` to handle file creation.
    *   Set up an auto-organization directory structure logic. When the app launches or a file is generated, ensure the path `~/Documents/Bianna_Law/` (cross-platform compatible `app.getPath('documents')`) exists.
2.  **Document Management implementation:**
    *   **PDF Parsing:** Ensure the file reading capability correctly handles PDFs. Fix the `pdfParse is not a function` error by properly installing `npm install pdf-parse` and verifying the import syntax (e.g., `const pdfParse = require('pdf-parse');` instead of invalid destructuring).
    *   **Document Generation:** Integrate a library like `docx` or `jspdf`.
    *   Implement an `ipcMain` handler that intercepts the "1-Click Outline Exporter" request, passes the raw text/prompt to the Claude API, and instructs the API to structure the response strictly into the **4-tier IRAC framework (Issue, Rule, Application, Conclusion)**.
    *   Take the structured JSON/Markdown response and format it beautifully into a `.docx` or `.pdf` file.
    *   Automatically save this generated file into the `Documents/Bianna_Law/` directory using standard naming conventions (e.g., `[Case_Name]_IRAC_[Date].docx`).
3.  **MCP Integration (Notion Workspace Sync & Quiz Tracking):**
    *   **UI Status Toggle:** Fix the UI header so the "NOTION: OFF" button accurately initializes and reflects the active MCP connection state (turning to "NOTION: ACTIVE").
    *   **MCP Architecture:** Leverage the **Model Context Protocol (MCP)** by implementing an MCP Client residing in the Electron `main.js` backend (using `@modelcontextprotocol/sdk`). Connect this client to a Notion MCP Server (e.g., via stdio using a Notion MCP package) so the app's embedded Claude API can natively discover and execute tools to edit Notion.
    *   **Target Workspace:** `Bianna-Law-App-File-Server` (`https://www.notion.so/Getting-Started-32a6c777524780a882cff5a2ae7e3e17?source=copy_link`).
    *   **Auto-Syncing:** Ensure every generated IRAC outline, case study summary, and YouTube video summary is passed as tool-use actions to the Notion MCP server by the AI, pushing them directly into this Notion database.
    *   **Quiz Tracking Feature:** Build an interactive test/quiz generator (via the "Start Quiz" button). The quizzes **must be a dynamic mix of multiple-choice and fill-in-the-blank queries**. Track **right and wrong answers** (gemini style) and sync performance metrics directly into Notion.
    *   **Notion Syllabus Organizer (Agentic AI):** When Bianna uploads a syllabus, the AI must automatically extract, sort, and prioritize her semester readings based on volume, difficulty, and class schedule. It must then use the Notion MCP tools to sync this data offline-to-online, generating a highly structured, color-coded dashboard in Notion visually mirroring modern multi-column productivity templates.

## Phase 4: Local RAG & Database Setup

**Objective:** Embed a local vector database to provide accurate, offline case law retrieval without cloud hallucination or API database fees.

**Tasks:**
1.  **Database Integration:**
    *   Install an embedded vector database compatible with Node.js/Electron. `ChromaDB` (via JS client if running a local server) or `LanceDB` (excellent for pure local node integration) are recommended.
2.  **Data Loading Pipeline:**
    *   Write an offline script/utility to ingest the Federal Rules of Civil Procedure (FRCP) and core 1L Supreme Court cases into the vector database.
    *   Use a local/affordable embedding model (e.g., via `Transformers.js` or OpenAI/Anthropic embeddings if absolutely necessary, but prioritize local for cost/offline capability) to generate vector embeddings.
3.  **RAG Execution Pipeline & Core AI Skills:**
    *   When Bianna asks a question in the chat UI, intercept the query in `main.js`.
    *   Embed the query, search the local vector database, retrieve the top K most relevant legal rules/cases.
    *   Inject this context into the system prompt sent to the Claude API to ensure answers are strictly tethered to the loaded case law and FRCP.
    *   **Load Predefined Skills:** The app's Claude API instance must be explicitly instructed to utilize Bianna's custom predefined Claude Skills: `bia-outline-style` and `law-school-research`.
    *   **Enforce Outline Structure:** When generating outlines (like midterm outlines), the AI must NOT default to conversational text. It must rigorously enforce the highly structured procedural formatting defined in the `bia-outline-style` skill.
    *   **System Persona & Core Skills:** Explicitly program the AI's internal system prompt to embody the crucial intersection of Lawyer and AI skills (as defined in the target criteria): *Analyzing, Researching, Summarization, Drafting, Extracting Information, Reviewing, and executing Tasks Done At Scale*.

## Phase 5: Packaging & Deployment

**Objective:** Package the developed application into standard executable formats.

**Tasks:**
1.  **Electron-Builder Configuration:**
    *   Install `electron-builder` as a dev dependency.
    *   Configure `package.json` with the appropriate build targets.
    *   Set up the build block:
        *   `appId`: `com.biannalaw.seniorpartner`
        *   `productName`: `Senior Law Partner`
        *   Ensure native dependencies (like LanceDB/SQLite) are correctly configured in `asarUnpack` if needed.
2.  **Build Scripts:**
    *   Add scripts to `package.json`:
        *   `"start": "electron ."`
        *   `"pack": "electron-builder --dir"`
        *   `"dist": "electron-builder"`
        *   `"build:win": "electron-builder --win"`
        *   `"build:mac": "electron-builder --mac"`
3.  **Final Target:**
    *   Confirm the ability to run `npm run build:win` to generate a standalone `Senior Law Partner.exe` file.

---
**Execution Note for Claude Code:** Proceed sequentially. Validate that the UI runs locally and IPC channels are functioning in Phase 1 before attempting to wire up the API or Vector Database in subsequent phases.
