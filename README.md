# TrackMe: Personalized AI Application Auto-Fill Assistant

> **A professional, privacy-first Manifest V3 Chrome Extension that memorizes your complete candidate profile, answers complex demographic & personal questions, programmatically attaches your resume file, cascades across free-tier LLM providers, and conducts live cover letter role-fit audits.**

---

## 🌟 Key Features

1. **Multi-Model Free-Tier Inference Router**:
   - Seamlessly connect your free API keys for:
     - **Google AI Studio / Gemini API** (High daily quota, multimodal PDF ingestion)
     - **Groq** (Ultra-low latency, `<300ms` inference on Llama 3.3 70B)
     - **Cerebras** (Ultra-high token throughput for deep context)
     - **OpenRouter** (Universal free model aggregator & fallback)
     - **SambaNova** (Developer tier for large open models)
     - **Together AI** (High-speed open models)
     - **Cloudflare Workers AI** (Serverless edge models)
   - **Automatic Cascade Fallback**: If your primary model hits a rate-limit (`429`) or server error, TrackMe immediately cascades to the next available provider with zero disruption.

2. **Resume Intake & "The Final Run" Verification Stage**:
   - Upload your resume (PDF, TXT, or DOCX).
   - The AI parser extracts your contact info, roll number / student ID, education, work experience, projects, skills, and inferred compliance details.
   - **The Final Run Screen**: Displays every parsed field in an interactive verification review. Edit any corrections before clicking **"Confirm & Lock Profile"**.

3. **Demographic & Personal Questions Memory**:
   - Google Autofill cannot answer sensitive compliance or personal questions. TrackMe records and automatically populates:
     - **Work Authorization & Visa Sponsorship** (Legally authorized, visa sponsorship required now/future, visa type)
     - **Voluntary Disability Status** (ADA self-identification)
     - **Veteran Status** (Protected veteran classifications)
     - **Gender Identity, Pronouns, & Race / Ethnicity** (EEOC classifications)
     - **Logistics** (Notice period, expected salary, relocation willingness)

4. **Programmatic Resume File Attachment (Zero OS Dependency)**:
   - Web browser security sandboxes intentionally block extensions from reading arbitrary file paths like `C:\Users\...` or `/home/...`.
   - **TrackMe's Solution**: Stores your resume binary `Blob` directly in local browser `IndexedDB`. When an application form has an `<input type="file">` for Resume/CV, TrackMe uses the native `DataTransfer` API to programmatically inject the file and dispatch synthetic change events.

5. **Cover Letter Hub & Role-Fit Internal Audit**:
   - Scrapes the active page for **Job Title**, **Company Name**, and **Job Description / Requirements**.
   - Compares your cover letter against the target role:
     - **Role-Fit Score** (0–100%)
     - **Matching Strengths**
     - **Missing Keywords & Skills**
     - **Tailoring Recommendations**
     - **Tailored Hook Snippet** personalized for that exact company.

6. **Continuous Learning Memory Bank**:
   - Whenever you encounter a new or unique application question (e.g. "Why do you want to join?", "Describe a technical challenge"), TrackMe captures your answer and saves it to your persistent Memory Bank.

7. **Interactive In-Place Refactoring (Double-Click Any Answer)**:
   - Double-click directly on any filled text input or textarea on the application page (e.g. *"Why do you want to join our team?"*).
   - TrackMe instantly queries the LLM with the field context, role requirements, and your profile to produce a fresh, alternative angle.
   - **Continuous Cycling**: Double-click again, and TrackMe rotates through different tones (technical impact, cultural alignment, concise punchiness, architecture problem-solving) with clean inline feedback!

8. **Google Forms Support**:
   - Seamlessly fills modern Google Forms (`docs.google.com/forms`) by parsing Google's question items (`div[role="listitem"]`, `.M7eMe`, `.geS5n`), selecting custom radio options (`div[role="radio"]`), and updating Closure/Wiz inputs with synthetic keyboard events.

9. **In-Popup Key Editor & .env / JSON Key Importer**:
   - Update, test, and change API keys directly from the extension popup.
   - Or click **"📁 Import from .env / JSON"** in the dashboard to import all your provider keys at once.

---

## 📂 Project Directory Structure

```text
/home/satty/Windows_D/Codes/track_me/
├── manifest.json              # Manifest V3 specification
├── package.json               # Package metadata
├── ARCHITECTURE.md           # Deep deployment feasibility & security report
├── README.md                 # User documentation & setup guide
├── background/
│   └── service-worker.js     # Background worker: handles API proxying (CORS-safe)
├── content/
│   ├── content.js            # Page DOM scanner, floating assistant pill, filler
│   └── content.css           # Glassmorphism styling for floating assistant
├── popup/
│   ├── popup.html            # Extension popup UI
│   ├── popup.css             # Popup dark aesthetic styles
│   └── popup.js              # Popup action controller
├── options/
│   ├── options.html          # Full-screen Dashboard (Keys, Resume, Profile, Memory)
│   ├── options.css           # Dashboard styling & layout
│   └── options.js            # Dashboard logic & verification run
├── lib/
│   ├── storage.js            # chrome.storage.local + IndexedDB binary blob store
│   ├── llm-router.js         # Multi-provider router with fallback cascade
│   ├── resume-parser.js      # Structured resume intelligence extractor
│   ├── form-analyzer.js      # DOM element & job context analyzer
│   └── field-filler.js       # React synthetic event simulator & DataTransfer file injector
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   └── generate-icons.js     # Node.js PNG icon builder
└── test/
    └── sample-application.html # Realistic job application test portal
```

---

## 🚀 How to Install & Deploy in Chrome

### Step 1: Load the Extension in Chrome
1. Open Google Chrome (or any Chromium browser like Brave, Edge, Arc).
2. Navigate to `chrome://extensions/` in the URL bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click the **Load unpacked** button.
5. Select the folder:
   `/home/satty/Windows_D/Codes/track_me`
6. TrackMe will now appear in your extensions list! Pin it to your toolbar.

---

## 🛠️ Step-by-Step Usage Flow

### 1. Configure Your Free API Keys
* Click the TrackMe icon in your toolbar and choose **⚙️ Open Dashboard** (or right-click the extension -> Options).
* Navigate to **API Keys & Router**.
* Paste at least one free API key (e.g. your Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey) or Groq key from [Groq Console](https://console.groq.com/keys)).
* Click **Test Connection** to verify live connectivity.
* Click **Save Key Settings**.

### 2. Upload Your Resume & Run the "Final Run" Verification
* Go to the **Resume & Final Run** tab.
* Drag and drop your resume file (PDF, TXT, or DOCX).
* Click **Run AI Extraction & Parse**.
* The **Review & Confirm Extracted Profile (The Final Run)** screen appears with all parsed attributes (Full Name, Roll No / Student ID, Email, Phone, College, Skills, Links).
* Edit any details to perfection, then click **✅ Confirm & Lock Profile**.

### 3. Set Up Demographics & Compliance
* Navigate to **Demographics & Q&A**.
* Fill in your work authorization status, visa sponsorship needs, ADA disability choice, veteran status, pronouns, and compensation expectations.
* Click **Save Demographic Preferences**.

### 4. Test Auto-Fill on a Real Application Page
* Open the included test application in your browser:
  Open `file:///home/satty/Windows_D/Codes/track_me/test/sample-application.html` or visit any real job post on Greenhouse, Lever, Workday, or Ashby.
* You will see the floating **TrackMe** pill in the bottom right corner!
* Click **TrackMe -> Auto-Fill Application**.
* Notice how:
  - Text fields and links populate with React-compatible synthetic events.
  - Dropdowns (Work Authorization, Disability, Veteran status) select the exact matching option.
  - The Resume file is **automatically attached** to the file input!
* Click **Audit Cover Letter Fit** to inspect your cover letter alignment and receive recommendations.

---

## 🔒 Security & Deployment Feasibility Verdict

* **Can this extension be published to the Chrome Web Store?**
  **YES.** It strictly follows Manifest V3 guidelines, has zero remote code execution, uses declarative permissions, and stores all API keys and personal files **100% locally on your machine**.
* **Zero Third-Party Telemetry**: Your data never leaves your browser except for direct, user-configured API requests sent to your chosen AI providers.



