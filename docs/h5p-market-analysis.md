# H5P Ecosystem — Market Analysis & Opportunity Map

> Date: 2026-02-26
> Purpose: Identify gaps in the H5P ecosystem that TLEF-CREATE can fill

---

## 1. Current Market Players

### 1.1 H5P.com (Official SaaS) — $690+/year

| Feature | Details |
|---|---|
| Smart Import (AI) | Video/PDF/URL → auto-generate interactive content |
| Content types | 50+ (all official types) |
| Analytics | Drill-down reports (scores, answers, time) — **paid only** |
| LTI integration | SSO + gradebook passback — **paid only** |
| Language | English only fully supported |
| Limitations | Closed SaaS; no API for third-party tools; no pedagogical structure (no LO alignment, no Bloom's); Smart Import produces generic questions without curriculum mapping |

> Source: [H5P Pricing](https://h5p.com/pricing), [Smart Import](https://campaigns.h5p.com/h5p-smart-import/)

### 1.2 H5P.org (Open Source) — Free

| Feature | Details |
|---|---|
| Hosting | Requires WordPress, Moodle, or Drupal plugin |
| Content types | Same 50+ types |
| AI features | None |
| Analytics | None (basic LMS gradebook only) |
| Limitations | No standalone editor; no Smart Import; depends on CMS/LMS admin access |

> Source: [H5P.org](https://h5p.org/), [Self-Hosting H5P](https://isu.pressbooks.pub/openpedagogy/chapter/self-hosting-h5p/)

### 1.3 Lumi Education — Free Desktop Editor

| Feature | Details |
|---|---|
| Platform | Electron desktop app (Windows/Mac/Linux) |
| Offline | Full offline H5P authoring |
| Export | HTML, SCORM |
| AI | None |
| Limitations | H5P library versions outdated and hard to update; no analytics; no collaboration; project appears semi-maintained |

> Source: [Lumi Education](https://lumi.education/en/), [GitHub Issues](https://github.com/Lumieducation/Lumi/issues/2647)

### 1.4 AI H5P Generator (aih5pgenerator.online) — SaaS

| Feature | Details |
|---|---|
| AI generation | Describe content → generate H5P |
| Content types | Crosswords, quizzes, dialog cards, drag words |
| Limitations | Limited content types; no material upload; no LO alignment; no pedagogical framework; basic quality |

> Source: [AI H5P Generator](https://aih5pgenerator.online/)

### 1.5 H5P-AI-Generator (GitHub, pascalkienast) — Open Source

| Feature | Details |
|---|---|
| Platform | Next.js web app |
| AI | Conversational UI → generate H5P |
| Content types | MC, TF, Course Presentation, Interactive Book, Branching Scenario |
| Limitations | Experimental; no material-based generation; no RAG; no curriculum mapping |

> Source: [GitHub](https://github.com/pascalkienast/H5P-AI-Generator)

### 1.6 H5P Interactive Video Generator v2 (GitHub) — Niche Tool

| Feature | Details |
|---|---|
| Platform | Streamlit app |
| AI | Groq AI, YouTube summary → MCQ at timestamps |
| Limitations | Requires manual summary input with timestamps; only MCQ; very basic |

> Source: [GitHub](https://github.com/dgcruzing/H5P-Interactive-Video-Generator-v2)

---

## 2. H5P Content Type Landscape

H5P has ~50 content types. The most complex and high-value ones:

| Content Type | Complexity | Authoring Pain | AI Generation Exists? |
|---|:---:|:---:|:---:|
| **Interactive Video** | Very High | Extreme (timestamp + question placement) | Barely (Streamlit hack) |
| **Branching Scenario** | Very High | Extreme (tree structure design) | No |
| **Course Presentation** | High | High (slide-by-slide + embedded quiz) | No |
| **Interactive Book** | High | High (multi-chapter + activities) | No |
| **Question Set** | Medium | Medium | Yes (TLEF-CREATE, Smart Import) |
| **Column** | Medium | Low | Yes (TLEF-CREATE, Smart Import) |
| Multiple Choice / TF / etc. | Low | Low | Yes (many tools) |
| Dialog Cards (Flashcards) | Low | Low | Yes (many tools) |

**Key insight**: Everyone fights over the easy content types (MC, TF, flashcards). Nobody solves the hard ones (Interactive Video, Branching Scenario, Course Presentation).

---

## 3. Identified Gaps — What Nobody Does Well

### Gap 1: Interactive Video from Materials 🎯🎯🎯

**What exists**: H5P Interactive Video lets you embed MC, TF, fill-in-blank, drag-text questions at specific timestamps in a video. It's one of H5P's most popular content types.

**What's missing**: No tool can take a lecture video + course materials → automatically identify key concepts at each timestamp → generate appropriate questions → output a complete H5P Interactive Video package.

**The pain today**: An instructor manually:
1. Watches the entire lecture video
2. Notes timestamps where key concepts appear
3. Writes questions for each timestamp
4. Manually places them in H5P editor
5. This takes 2-4 hours for a 50-minute lecture

**The opportunity**: "Paste a YouTube URL, upload your slides → get a complete Interactive Video H5P in 2 minutes."

**Technical feasibility**:
- Whisper API for transcription with timestamps
- RAG: align transcript chunks with uploaded materials
- LLM: generate questions per timestamp region
- H5P Interactive Video JSON structure is well-documented
- TLEF-CREATE already has the question generation pipeline

---

### Gap 2: Branching Scenario Generator 🎯🎯🎯

**What exists**: H5P Branching Scenario — a "choose your own adventure" content type where student choices lead to different paths. Extremely powerful for case-based learning (medical diagnosis, legal reasoning, ethical dilemmas).

**What's missing**: Creating branching scenarios is the most tedious H5P authoring task. No tool generates them automatically. The tree structure requires:
- Defining nodes (content screens)
- Defining branches (choices at each node)
- Defining outcomes (scoring per path)
- Ensuring all paths are pedagogically valid

**The pain today**: A nursing instructor wants to create a patient diagnosis scenario. They spend 6+ hours designing the tree in H5P editor, which has no preview-while-editing.

**The opportunity**: "Describe a case study scenario → AI generates a complete branching tree with 3-4 decision points, correct/incorrect paths, and feedback at each node."

**Technical feasibility**:
- LLM is excellent at generating narrative trees
- H5P Branching Scenario JSON schema is structured (nodes + edges)
- Can constrain tree depth/breadth via prompt
- Output as .h5p package using existing packaging code

---

### Gap 3: Course Presentation / Interactive Book Generator 🎯🎯

**What exists**: Course Presentation (like PowerPoint with embedded quizzes) and Interactive Book (multi-chapter textbook with activities). These are H5P's "premium" content types.

**What's missing**: No tool generates these from materials. Smart Import can create basic content but without curriculum structure.

**The opportunity**: "Upload lecture slides (PDF/PPTX) → auto-generate an H5P Course Presentation where each slide has its original content PLUS 1-2 embedded quiz questions."

**Technical feasibility**:
- Parse PPTX slides (existing libraries: python-pptx / pptx2json)
- Each slide → Course Presentation slide + AI-generated check-question
- Course Presentation H5P JSON is well-structured

---

### Gap 4: xAPI Analytics Dashboard (Free Alternative to H5P.com) 🎯🎯

**What exists**: H5P emits xAPI statements (scores, answers, time, completion). H5P.com offers drill-down analytics for $690/year. Self-hosted users get nothing.

**What's missing**: A free/open-source analytics dashboard for H5P xAPI data. Learning Locker is a general LRS — not H5P-specific, and complex to set up.

**The opportunity**: "Deploy our lightweight xAPI receiver → get a beautiful H5P analytics dashboard showing per-question performance, student struggle points, time-on-task, and difficulty calibration — for free."

**Why this matters**: This directly undercuts H5P.com's paid analytics. Every Moodle/WordPress admin running self-hosted H5P would want this.

**Technical feasibility**:
- xAPI receiver = simple Express endpoint that stores statements
- Dashboard = React charts (already have the frontend stack)
- H5P xAPI schema is standardized and well-documented

> Source: [H5P xAPI docs](https://h5p.org/documentation/x-api), [xAPI + H5P](https://xapi.com.au/how-to-capture-xapi-statements-from-h5p-in-moodle/)

---

### Gap 5: H5P Content Transformation Engine 🎯

**What's missing**: No tool converts between H5P content types. Examples:
- Quiz (Question Set) → Course Presentation (one question per slide)
- Flashcards (Dialog Cards) → Branching Scenario (card → node)
- Question Set → Interactive Book (one chapter per LO)
- Any quiz → Interactive Video overlay (if video URL provided)

**The opportunity**: "You already have 20 quiz questions. Click 'Transform' → get them as a Course Presentation, Interactive Book, or Interactive Video."

**Technical feasibility**: JSON-to-JSON transformation. Both source and target H5P schemas are known. This is pure mapping logic.

---

### Gap 6: Pedagogically-Aware H5P Generation 🎯

**What every competitor lacks**: All existing AI-to-H5P tools generate content **without pedagogical structure**:
- No learning objective alignment
- No Bloom's taxonomy awareness
- No difficulty calibration
- No content coverage mapping
- No question quality analysis

**TLEF-CREATE already has this** (LO pipeline, difficulty settings, pedagogical approach selection). This is the core differentiator — but it's invisible to users outside UBC.

**The opportunity**: Position as "the only H5P tool that understands curriculum design, not just content generation."

---

## 4. Competitive Positioning Map

```
                    Pedagogical Intelligence
                           ↑
                           │
                           │  ★ TLEF-CREATE
                           │  (LOs, Bloom's, difficulty,
                           │   RAG from materials)
                           │
                           │              H5P.com Smart Import
                           │              (AI but no pedagogy)
                           │
       Simple ────────────┼──────────────── Complex
       Content Types      │                Content Types
       (MC, TF, Flash)    │                (Interactive Video,
                           │                 Branching, Course Pres)
                           │
          Lumi             │
          (manual only)    │
                           │
          AI H5P Gen       │
          (basic AI)       │
                           │
                           ↓
                    No Pedagogy
```

**TLEF-CREATE sits in the top-left quadrant**: strong pedagogy, but limited to simpler content types (quiz/column). The biggest opportunity is to **move right** — support complex H5P content types while keeping the pedagogical advantage.

---

## 5. Strategic Recommendations

### Priority 1: Interactive Video Generator

**Why #1**:
- Highest pain point (hours of manual work per video)
- Video-based learning is the dominant modality
- YouTube is the #1 educational resource
- No real competitor
- Technical path is clear (Whisper + existing RAG + existing question gen)

**MVP scope**:
1. User pastes YouTube URL
2. Backend transcribes with Whisper (with timestamps)
3. Transcript feeds into existing RAG pipeline
4. LLM generates questions per ~5-minute segment
5. Output as H5P Interactive Video .h5p package
6. User can preview and adjust question placement

**Positioning**: "Turn any lecture video into an interactive H5P lesson in 2 minutes."

---

### Priority 2: Branching Scenario Generator

**Why #2**:
- Zero competition (nobody does this)
- Extremely high-value for professional education (nursing, medicine, law, business)
- H5P Branching Scenario is under-used precisely because it's too hard to author
- Universities would pay for this specifically

**MVP scope**:
1. User describes a scenario or uploads a case study
2. LLM generates a branching tree (3-4 decision points, 2-3 options each)
3. Each node: narrative text + optional embedded question
4. Each ending: score + feedback
5. Output as H5P Branching Scenario .h5p package
6. Visual tree editor for adjustment

**Positioning**: "AI-powered case-based learning. Describe a scenario, get a Branching Scenario."

---

### Priority 3: Content Type Transformation

**Why #3**:
- Low effort (JSON → JSON mapping, no LLM needed for basic transforms)
- Multiplies the value of every question already generated
- Users create quiz once → get 4 different H5P formats
- Unique feature nobody else offers

**MVP scope**:
- Question Set → Course Presentation (1 question per slide)
- Dialog Cards → standalone Flashcard H5P
- Question Set + Video URL → Interactive Video scaffold
- Any content → Interactive Book (1 chapter per LO)

**Positioning**: "One quiz, every H5P format."

---

### Priority 4: xAPI Analytics Dashboard

**Why #4**:
- Undercuts H5P.com's $690/year analytics offering
- Attracts the entire self-hosted H5P community
- Positions TLEF-CREATE as infrastructure, not just a generator
- Creates ongoing engagement (users return to check analytics)

**MVP scope**:
- xAPI statement receiver endpoint
- Per-question analytics: % correct, avg time, score distribution
- Per-student view: progress, struggle points
- Export analytics as CSV/PDF

**Positioning**: "Free H5P analytics. No H5P.com subscription needed."

---

## 6. What TLEF-CREATE Already Has That Others Don't

| Advantage | Detail |
|---|---|
| Learning Objective pipeline | Material → LO → Questions (curriculum-aligned) |
| Pedagogical approach selection | Support / Challenge / Balanced |
| RAG-based generation | Questions grounded in actual course materials |
| 8 question types | Broader than most AI H5P tools |
| Real H5P preview | In-browser rendering matching LMS output |
| Question quality metadata | Difficulty, type, LO tagging |

**This is the moat.** Competitors generate "quiz questions from text." TLEF-CREATE generates "curriculum-aligned assessments from course materials." The positioning should make this distinction loud and clear.

---

## 7. Summary: Where to Go Next

```
Today:  Materials → LOs → Quiz Questions → H5P Quiz/Column export
        (8 question types, strong pedagogy, limited H5P output types)

Next:   Materials → LOs → Quiz Questions ─┬→ H5P Quiz (existing)
                                           ├→ H5P Interactive Video (new)
        + Video URL ───────────────────────┤
                                           ├→ H5P Branching Scenario (new)
        + Case Study ──────────────────────┤
                                           ├→ H5P Course Presentation (new)
                                           ├→ H5P Interactive Book (new)
                                           └→ Transform between any ↑ (new)

        + xAPI Analytics ← Student performance data (new)
```

The strategic move is: **expand H5P output types while keeping the pedagogical intelligence that no competitor has.**
