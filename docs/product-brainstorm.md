# Product Brainstorm — PM Perspective

> Date: 2026-02-26
> Lens: User journeys, habit loops, moats, expansion, positioning

---

## Part 1: Re-thinking the Core Product Loop

Current loop:
```
Upload Materials → Generate LOs → Generate Questions → Export H5P
```

This is a **one-shot linear pipeline**. User comes in, gets output, leaves. No reason to return until next semester.

The question isn't "what features to add" — it's **"how do we make this a tool people live in, not visit once?"**

---

## Part 2: Product Experience Ideas

### 2.1 "Generate from Syllabus" — The Ultimate Onboarding

**Insight**: The first 5 minutes determine if a user stays. Currently: create folder → upload materials → wait → set LOs → wait → generate. Too many steps before value.

**Experience**:
```
Instructor uploads their course syllabus (1 PDF)
  → AI parses it: 13 weeks, topics per week, textbook references
  → Auto-generates a semester plan:

  ┌─────────────────────────────────────────────────┐
  │  CPSC 110 — Fall 2026 Assessment Plan           │
  │                                                  │
  │  Week 1: Intro to Programming                   │
  │    📄 Suggested materials: Ch. 1-2               │
  │    🎯 3 Learning Objectives (auto-generated)     │
  │    📝 Quiz: 5 MC + 2 TF (draft ready)           │
  │                                                  │
  │  Week 2: Data Types & Variables                  │
  │    📄 Suggested materials: Ch. 3                 │
  │    🎯 4 Learning Objectives                      │
  │    📝 Quiz: 4 MC + 2 Cloze + 1 Ordering         │
  │                                                  │
  │  ... (13 weeks)                                  │
  │                                                  │
  │  [Upload Materials & Generate All] [Customize]   │
  └─────────────────────────────────────────────────┘
```

**Why this matters**:
- Time-to-value: 2 minutes to see an entire semester's assessment structure
- Instructor thinks "this tool gets me" before writing a single question
- Even without uploading materials, they see the *potential*
- Converts "I'll try this later" into "let me fill in week 1 right now"

**The hook**: "Upload your syllabus. Get a semester of assessments."

---

### 2.2 Micro-Assessment Mode — Daily 3-Question Pulses

**Insight**: Research shows spaced retrieval practice (frequent low-stakes quizzes) is far more effective than one big exam. But creating daily mini-quizzes is impractical.

**Experience**:
```
Instructor uploads this week's readings
  → Instead of one 20-question quiz:
  → AI generates 5 daily micro-quizzes (Mon-Fri), 3 questions each
  → Each day's quiz targets different LOs with spacing built in
  → Auto-exports as 5 separate H5P packages

  Mon: Q1 (LO1, easy), Q2 (LO2, easy), Q3 (LO3, easy)
  Tue: Q1 (LO1, medium), Q2 (LO2, medium), Q3 (new LO4, easy)
  Wed: Q1 (LO3, medium), Q2 (LO4, medium), Q3 (LO1, hard)  ← spaced
  Thu: Q1 (LO2, hard), Q2 (LO4, medium), Q3 (LO3, hard)
  Fri: Q1 (LO1-4 mixed), Q2 (cumulative), Q3 (challenge)
```

**Why this matters**:
- Backed by learning science (Ebbinghaus, Bjork's desirable difficulties)
- Instructors want to do this but can't justify the time
- Creates a weekly recurring use case (not one-shot)
- Differentiator: no tool thinks about *temporal distribution* of assessment

---

### 2.3 Student-Created Questions — Flip the Model

**Insight**: Research shows creating questions is a more effective learning strategy than answering them (generative learning theory). But there's no structured way for students to do this.

**Experience**:
```
Instructor enables "Student Question Mode" for a quiz
  → Shares a link with students
  → Students submit questions using a simplified creation form
  → AI auto-evaluates each submission:
    - Is it a valid question? (grammar, clarity)
    - Does it align with the LOs?
    - Is it a duplicate of existing questions?
    - Bloom's level classification
  → Instructor sees a curated dashboard:

  ┌─────────────────────────────────────────────────┐
  │  Student-Submitted Questions (47 received)       │
  │                                                  │
  │  ⭐ Top-Rated by AI                              │
  │  1. "Which sorting algorithm..." — Sarah L.      │
  │     Quality: 92/100 | Bloom's: Apply | LO: #3   │
  │     [Add to Quiz] [Edit] [Reject]               │
  │                                                  │
  │  2. "In the context of..." — James K.            │
  │     Quality: 88/100 | Bloom's: Analyze | LO: #1 │
  │     [Add to Quiz] [Edit] [Reject]               │
  │                                                  │
  │  ⚠️ Needs Review                                 │
  │  3. "What is the definition of..." — Amy T.      │
  │     Quality: 45/100 | Issue: Too basic (Remember)│
  │     [Suggest Improvement to Student]             │
  └─────────────────────────────────────────────────┘
```

**Why this matters**:
- Turns students from consumers into contributors
- Instructor gets free question content + sees what students think is important
- Students learn more by creating than by answering
- Creates a viral loop: students tell other students about the tool
- Academic research paper potential (publish on this novel approach)

---

### 2.4 Assessment Health Score — Gamify Instructor Behavior

**Insight**: Instructors don't know if their assessments are "good." They have no benchmark, no feedback loop. They just hope.

**Experience**:
```
┌─────────────────────────────────────────────────┐
│  Assessment Health Score: 72 / 100               │
│  ████████████████████████░░░░░░░░               │
│                                                  │
│  📊 Breakdown:                                   │
│  Bloom's Coverage      ████████░░  16/20         │
│  Difficulty Balance    ██████░░░░  12/20         │
│  Question Variety      ████████████ 20/20        │
│  Content Coverage      ██████████░ 14/20         │
│  Freshness (not reused)██████░░░░  10/20         │
│                                                  │
│  💡 Quick Wins to Improve:                       │
│  +8 pts: Add 2 questions at Evaluate/Create level│
│  +5 pts: Redistribute: too many Easy, need Hard  │
│  +3 pts: Chapter 7 has zero questions            │
│                                                  │
│  [Auto-Fix All]  [Fix One by One]                │
└─────────────────────────────────────────────────┘
```

**Why this matters**:
- Turns abstract quality into a tangible number
- "Quick wins" make improvement feel achievable
- Gamification: instructors want to hit 90+
- "Auto-Fix All" is the magic button — AI fills gaps automatically
- Creates a reason to return and iterate (not one-and-done)

---

### 2.5 Progressive Quiz — Adaptive Difficulty via Branching

**Insight**: Fixed-difficulty quizzes are either too easy for strong students or too hard for weak ones. Adaptive testing exists in standardized tests (GRE, GMAT) but not in classroom quizzes.

**Experience**:
```
Instructor clicks "Generate Adaptive Quiz"
  → AI generates each question at 3 difficulty levels (Easy/Med/Hard)
  → Auto-creates an H5P Branching Scenario:

  Start → Q1 (Medium)
          ├── Correct → Q2 (Hard)
          │             ├── Correct → Q3 (Hard) → "Advanced" ending
          │             └── Wrong → Q3 (Medium) → "Proficient" ending
          └── Wrong → Q2 (Easy)
                      ├── Correct → Q3 (Medium) → "Developing" ending
                      └── Wrong → Q3 (Easy) → "Needs Review" ending

  Each ending: personalized feedback + suggested resources
```

**Why this matters**:
- Combines two powerful H5P types (Questions + Branching Scenario)
- Adaptive testing is a known best practice that's too hard to implement manually
- Every student gets an appropriately challenging experience
- The instructor doesn't need to understand branching — AI handles the tree
- This is genuinely novel — no tool does this

---

### 2.6 "What Would Students Ask?" — Anticipate Confusion

**Insight**: The best instructors anticipate where students get confused. But this takes years of experience.

**Experience**:
```
After uploading materials, before generating quiz questions:

┌─────────────────────────────────────────────────┐
│  🤔 Predicted Student Confusion Points           │
│                                                  │
│  1. "Students often confuse polymorphism with    │
│      overloading. Consider adding a question     │
│      that explicitly distinguishes them."        │
│     [Generate Distinguishing Question]           │
│                                                  │
│  2. "The relationship between abstract classes   │
│      and interfaces is a common source of        │
│      misconceptions."                            │
│     [Generate Misconception-Targeting Question]  │
│                                                  │
│  3. "Students may struggle with why recursion    │
│      needs a base case — the materials explain   │
│      HOW but not WHY."                           │
│     [Generate Conceptual Question]               │
│                                                  │
│  Based on: analysis of 10,000+ student           │
│  interactions across similar courses             │
└─────────────────────────────────────────────────┘
```

**Why this matters**:
- Goes beyond "generate questions" to "help you teach better"
- Positions the tool as a teaching assistant, not just a quiz maker
- Generated questions target actual misunderstandings, not surface recall
- Instructors feel the tool has expertise they don't have

---

### 2.7 Universal Export — Be the Interchange Format

**Insight**: H5P is one format. But instructors use Canvas, Moodle, Google Forms, Kahoot, Quizlet, printed exams. Being locked to H5P limits adoption.

**Experience**:
```
Export Menu:
  ┌─────────────────────────────────────────┐
  │  Export Your Quiz                        │
  │                                          │
  │  📦 H5P Package (.h5p)      [Download]  │
  │  📄 PDF (Print-ready)       [Download]  │
  │  📋 QTI 2.1 (Canvas native) [Download]  │
  │  📋 Moodle XML              [Download]  │
  │  📊 Google Forms             [Create]   │
  │  🎮 Kahoot                   [Create]   │
  │  📚 Anki Deck (.apkg)       [Download]  │
  │  📝 Plain Text / Markdown   [Download]  │
  │  🔗 Shareable Web Link      [Generate]  │
  └─────────────────────────────────────────┘
```

**Why this matters**:
- Removes "but we don't use H5P" as an objection
- Canvas QTI export alone would unlock every Canvas-using university
- Shareable web link = no LMS needed, just send a URL to students
- Positions TLEF-CREATE as THE quiz creation tool, not "an H5P tool"
- Each export format opens a new market segment

**Priority exports**:
1. QTI 2.1 (Canvas) — biggest LMS market
2. Moodle XML — second biggest LMS
3. Shareable link (self-hosted H5P preview page)
4. Kahoot — viral growth potential

---

### 2.8 Clone & Adapt — Cross-Course Reuse

**Insight**: Many courses cover overlapping concepts (e.g., statistics in psychology, biology, economics). A professor teaching 2 courses wants to reuse question structures but with different domain context.

**Experience**:
```
"Clone Quiz to Another Course"
  → Select source: PSYC 100 - Statistics Basics Quiz
  → Select target: BIOL 200 - Research Methods
  → AI adapts every question:

  Original (PSYC 100):
    "A psychologist surveys 100 patients. The mean anxiety
     score is 7.2 with SD 1.5. What is the 95% CI?"

  Adapted (BIOL 200):
    "A biologist samples 100 organisms. The mean body mass
     is 7.2g with SD 1.5g. What is the 95% CI?"

  → Same statistical concept, domain-appropriate context
  → Instructor reviews and publishes
```

**Why this matters**:
- Professors teaching multiple courses save massive time
- Cross-department collaboration potential
- Each adaptation = new quiz in the Question Bank (compounding value)

---

### 2.9 Assessment Calendar — Semester-Level View

**Insight**: Individual quizzes exist in isolation. Nobody has a bird's-eye view of "what am I assessing, when, and how does it all fit together?"

**Experience**:
```
┌──────────────────────────────────────────────────────────────┐
│  CPSC 110 — Fall 2026 Assessment Calendar                     │
│                                                               │
│  Sep  ──── Oct  ──── Nov  ──── Dec                            │
│  W1 W2 W3  W4 W5 W6  W7 W8 W9  W10 W11 W12 W13              │
│  ▪  ▪  ▪   ■  ▪  ▪   ▪  ■  ▪   ▪   ▪   ■   ★               │
│                                                               │
│  ▪ = Weekly micro-quiz (3 Qs)                                 │
│  ■ = Midterm assessment (20 Qs)                               │
│  ★ = Final comprehensive (40 Qs)                              │
│                                                               │
│  LO Coverage Over Time:                                       │
│  LO1: ████░░░░░░░░░ (covered weeks 1-4, not revisited) ⚠️   │
│  LO2: ██████████████ (well-distributed)                ✅    │
│  LO3: ░░░░░░████████ (only in second half)             ⚠️   │
│  LO4: ████████████░░ (drops off before final)          ⚠️   │
│                                                               │
│  💡 Suggestion: Add LO1 review questions to Week 8 midterm   │
│  💡 Suggestion: LO3 needs early introduction in Week 3       │
│                                                               │
│  [Auto-Rebalance]  [Add Quiz]  [Export Semester Plan]         │
└──────────────────────────────────────────────────────────────┘
```

**Why this matters**:
- No tool thinks at the semester level — everyone thinks quiz by quiz
- Visual LO coverage over time reveals gaps instructors never notice
- "Auto-Rebalance" adjusts the entire semester's assessment plan
- This is the view a curriculum coordinator or accreditation reviewer wants

---

### 2.10 Anti-Pattern Detection — Quiz Design Linting

**Insight**: There are well-known quiz design anti-patterns that even experienced instructors fall into. Like code linting, but for assessments.

**Experience**:
```
Quiz Design Lint Report — 7 issues found

❌ Critical:
  • Q4, Q8, Q15: Correct answer is always option (C)
    → Students will notice the pattern
    → [Shuffle Automatically]

  • Q3: "Which of the following is NOT..."
    → Negative stems increase cognitive load unfairly
    → [Rewrite as Positive Stem]

⚠️ Warning:
  • 12 of 15 questions are Multiple Choice
    → Low variety reduces assessment validity
    → [Convert 3 to Different Types]

  • Q7: Stem is 180 words, options are 5 words each
    → Reading burden is in the wrong place
    → [Simplify Stem]

  • Q11, Q12: Test the same concept (both about linked lists)
    → Redundant coverage, missing other topics
    → [Replace Q12 with New Topic]

ℹ️ Info:
  • Average question reading time: 45 seconds
    → 15 questions × 45s = ~11 min reading time
    → Recommended for a 50-min exam: 15-20 min reading
    → ✅ Within range

  • No "All of the above" or "None of the above" detected ✅
```

**Why this matters**:
- Makes invisible quality problems visible
- Each issue has a one-click fix (not just complaints)
- Educates instructors about assessment design (they learn from the linting)
- Builds trust: "this tool catches things I wouldn't have noticed"

---

## Part 3: Product Strategy Themes

### Theme A: "AI Teaching Assistant, Not Just Quiz Generator"

Features: Confusion prediction (2.6), Health Score (2.4), Anti-Pattern Detection (2.10), Assessment Calendar (2.9)

Positioning: "An AI that understands pedagogy. It doesn't just make questions — it makes your teaching better."

Target: Instructors who care about teaching quality (the ones who go to teaching workshops).

### Theme B: "One Input, Every Output"

Features: Universal Export (2.7), Content Type Transformation, Interactive Video / Branching Scenario generation

Positioning: "Create once. Export everywhere. H5P, Canvas, Moodle, Kahoot, PDF, Anki."

Target: Pragmatic instructors who need flexibility across platforms.

### Theme C: "Assessment Intelligence Platform"

Features: Syllabus-to-Semester (2.1), Micro-Assessment (2.2), Calendar (2.9), xAPI Analytics, Health Score (2.4)

Positioning: "The operating system for educational assessment. Plan, create, deploy, analyze, improve."

Target: Institutional buyers (department chairs, instructional design teams, CTLs).

### Theme D: "Community-Powered Learning"

Features: Student Questions (2.3), Question Bank sharing, Template Marketplace, Clone & Adapt (2.8)

Positioning: "Every question makes the platform smarter. Every instructor benefits from the community."

Target: Long-term retention and network effects. The "GitHub for educational content" vision.

---

## Part 4: What to Build vs. What to Position

Some of these are **features** (need engineering). Some are **positioning** (need marketing).

| Idea | Is it a feature or positioning? |
|---|---|
| Syllabus-to-Semester | Feature (high impact onboarding) |
| Assessment Health Score | Feature (medium effort, high differentiation) |
| Anti-Pattern Detection | Feature (mostly prompt engineering) |
| Universal Export (QTI/Moodle XML) | Feature (format mapping) |
| "AI Teaching Assistant" narrative | Positioning (reframe existing capabilities) |
| Student-Created Questions | Feature (new user role + flow) |
| Micro-Assessment Mode | Feature (scheduling logic + spaced repetition algorithm) |
| Progressive/Adaptive Quiz | Feature (branching generation + difficulty levels) |
| Confusion Point Prediction | Feature (LLM prompt + UI) |
| Assessment Calendar | Feature (semester-level data model + visualization) |
| Clone & Adapt | Feature (LLM context transformation) |

---

## Part 5: The "10x Moment" Test

For each feature, ask: **"What's the moment the user says 'holy shit'?"**

| Feature | 10x Moment |
|---|---|
| Syllabus → Semester Plan | "I uploaded my syllabus and it planned 13 weeks of assessments in 30 seconds" |
| Interactive Video | "I pasted a YouTube link and got an interactive quiz video in 2 minutes" |
| Branching Scenario | "It created a patient diagnosis simulation from my case study notes" |
| Anti-Pattern Detection | "It caught that all my correct answers were option C — I never would have noticed" |
| Health Score + Auto-Fix | "My quiz went from 65 to 91 quality score with one click" |
| Student Questions | "My students submitted 47 questions and the AI ranked them — the top ones are better than mine" |
| Adaptive Quiz | "Each student got a different difficulty path and the weak ones got extra practice" |
| Universal Export | "I created one quiz and deployed it to Canvas, Kahoot, and printed PDF in 10 seconds" |

**If you can't articulate the 10x moment, the feature isn't worth building.**

---

## Part 6: Moat Analysis

What makes this defensible over time?

| Moat Type | How TLEF-CREATE Builds It |
|---|---|
| **Data moat** | Every question generated improves the system. Question Bank accumulates. Student performance data (xAPI) trains better difficulty calibration. |
| **Switching cost** | Semester of quizzes + question bank + assessment calendar = too much to recreate elsewhere |
| **Network effects** | Student-created questions, template sharing, cross-instructor question bank |
| **Pedagogical IP** | Bloom's classification, anti-pattern detection, confusion prediction — competitors can copy features but not the pedagogical knowledge baked in |
| **Ecosystem lock-in** | Universal export = easy to adopt. But Assessment Calendar + Health Score + Analytics = reasons to stay |

---

## Appendix: Quick Reference — All Ideas Ranked

| # | Idea | Impact | Effort | 10x Moment? |
|:---:|---|:---:|:---:|:---:|
| 1 | Syllabus → Semester Plan | 🔴 | 🟡 | ✅ |
| 2 | Interactive Video Generator | 🔴 | 🟡 | ✅ |
| 3 | Assessment Health Score | 🔴 | 🟢 | ✅ |
| 4 | Anti-Pattern Detection | 🟡 | 🟢 | ✅ |
| 5 | Universal Export (QTI, Moodle XML) | 🔴 | 🟡 | ✅ |
| 6 | Branching Scenario Generator | 🔴 | 🟡 | ✅ |
| 7 | Progressive Adaptive Quiz | 🟡 | 🟡 | ✅ |
| 8 | Micro-Assessment Mode | 🟡 | 🟢 | ✅ |
| 9 | Student-Created Questions | 🟡 | 🟡 | ✅ |
| 10 | Confusion Point Prediction | 🟡 | 🟢 | ✅ |
| 11 | Assessment Calendar | 🟡 | 🟡 | ⚠️ |
| 12 | Clone & Adapt | 🟡 | 🟢 | ⚠️ |
| 13 | Content Type Transformation | 🟡 | 🟢 | ⚠️ |

🔴 = High | 🟡 = Medium | 🟢 = Low
