# Image Hotspot Question Generator — Technical Architecture

> Date: 2026-02-26
> Goal: Upload an image → AI identifies key objects → auto-generates H5P hotspot-based questions

---

## 1. The Problem

Instructor has an image (anatomy diagram, map, circuit, artwork, lab photo).
They want to create interactive questions like:
- "Click on the mitochondria" (Find the Hotspot)
- "What is this organ?" with a hotspot revealing the answer (Image Hotspots)
- "Drag the labels to the correct positions" (Drag and Drop)

**Manual process**: Open H5P editor → eyeball coordinates → draw hotspot rectangles → type questions → repeat 10x. Takes 30-60 minutes per image.

**Goal**: Upload image → AI does it in 30 seconds.

---

## 2. Technical Challenge: Precise Object Localization

| Approach | Identifies Objects | Coordinate Precision | Understands Context |
|---|:---:|:---:|:---:|
| GPT-4o Vision | ✅ Excellent | ❌ ~10-20% off | ✅ Excellent |
| Gemini 2.5 | ✅ Excellent | ⚠️ Normalized 0-1000, occasional misses | ✅ Excellent |
| Grounding DINO | ✅ (from text prompt) | ✅ Precise bounding boxes | ❌ No context |
| Florence-2 | ✅ Caption + grounding | ✅ Good bounding boxes | ⚠️ Limited |
| SAM (Segment Anything) | ❌ (needs prompt) | ✅✅ Pixel-level masks | ❌ None |

**Key insight**: No single model does both well. The solution is a **two-stage pipeline**.

---

## 3. Recommended Architecture: Two-Stage Pipeline

```
                    Stage 1: UNDERSTAND                 Stage 2: LOCATE
                    (Vision LLM)                        (Grounding Model)

  Image ──────────► GPT-4o / Gemini / Claude ─────────► Grounding DINO
                    │                                    │
                    ├─ "What objects are in              ├─ "Find: mitochondria"
                    │   this image?"                     │   → bbox [0.23, 0.45, 0.38, 0.62]
                    │                                    │
                    ├─ "Which are educationally          ├─ "Find: cell membrane"
                    │   important?"                      │   → bbox [0.01, 0.02, 0.99, 0.98]
                    │                                    │
                    ├─ Generate questions:               ├─ "Find: nucleus"
                    │   Q1: "Click on the                │   → bbox [0.40, 0.35, 0.60, 0.55]
                    │    mitochondria"                   │
                    │   Q2: "What organelle              │
                    │    produces ATP?"                  │
                    │                                    │
                    ▼                                    ▼
              Object List +                       Precise Coordinates
              Questions                           (bounding boxes)
                    │                                    │
                    └──────────── MERGE ─────────────────┘
                                   │
                                   ▼
                          H5P Hotspot Content
                          (questions + coordinates)
```

### Stage 1: Vision LLM — "What's important in this image?"

**Input**: Image + (optional) topic context from uploaded materials

**Prompt**:
```
You are an educational content analyzer. Given this image from a
[Biology / Geography / Art History] course:

1. Identify all notable objects, regions, or elements in the image
2. For each object, provide:
   - name: the object name (e.g., "mitochondria")
   - description: brief educational description
   - question: a quiz question targeting this object
   - question_type: "find_hotspot" | "label" | "info"
   - difficulty: "easy" | "medium" | "hard"
3. Rank by educational importance

Return as JSON array.
```

**Output**:
```json
[
  {
    "name": "mitochondria",
    "description": "Powerhouse of the cell, produces ATP through cellular respiration",
    "question": "Click on the organelle responsible for ATP production",
    "question_type": "find_hotspot",
    "difficulty": "medium"
  },
  {
    "name": "nucleus",
    "description": "Contains genetic material (DNA) and controls cell activities",
    "question": "Identify the structure that contains the cell's DNA",
    "question_type": "find_hotspot",
    "difficulty": "easy"
  }
]
```

**Why Vision LLM here**: It understands educational context, can prioritize what's worth quizzing, and generates pedagogically sound questions. Coordinate precision doesn't matter at this stage.

### Stage 2: Grounding Model — "Where exactly is each object?"

For each object identified in Stage 1, query a grounding model:

**Option A: Grounding DINO via Roboflow API** (recommended)
```javascript
// For each identified object:
const response = await fetch('https://detect.roboflow.com/grounding-dino/1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    api_key: ROBOFLOW_API_KEY,
    image: base64Image,
    text: 'mitochondria',        // from Stage 1
    confidence: 0.3
  })
});

// Returns:
{
  "predictions": [{
    "x": 245, "y": 380,           // center point
    "width": 120, "height": 140,   // bbox dimensions
    "confidence": 0.87,
    "class": "mitochondria"
  }]
}
```

**Option B: Gemini 2.5 native bounding boxes**
```javascript
const result = await gemini.generateContent({
  contents: [{
    parts: [
      { inlineData: { mimeType: 'image/png', data: base64Image } },
      { text: 'Return a bounding box for: mitochondria. Format: [y_min, x_min, y_max, x_max] normalized 0-1000.' }
    ]
  }]
});
// Returns: [450, 230, 620, 380]
// Convert: divide by 1000 → [0.45, 0.23, 0.62, 0.38]
```

**Option C: Replicate hosted Grounding DINO**
```javascript
const output = await replicate.run('adirik/grounding-dino', {
  input: {
    image: imageUrl,
    text_prompt: 'mitochondria',
    box_threshold: 0.3
  }
});
```

### Stage 3: Merge & Generate H5P

Combine Stage 1 (questions + context) with Stage 2 (coordinates) → H5P content JSON.

---

## 4. Coordinate Conversion to H5P

H5P hotspot coordinates are **percentages relative to image dimensions** (0-100%).

```javascript
function bboxToH5PHotspot(bbox, imageWidth, imageHeight) {
  // bbox from Grounding DINO: { x, y, width, height } in pixels
  // H5P wants: { x: %, y: %, width: %, height: % } as percentages
  return {
    x: ((bbox.x - bbox.width / 2) / imageWidth) * 100,
    y: ((bbox.y - bbox.height / 2) / imageHeight) * 100,
    width: (bbox.width / imageWidth) * 100,
    height: (bbox.height / imageHeight) * 100
  };
}
```

---

## 5. Target H5P Content Types

### 5.1 Find the Hotspot (H5P.ImageHotspotQuestion)

**Use case**: "Click on the correct area"

```json
{
  "library": "H5P.ImageHotspotQuestion 1.8",
  "params": {
    "imageHotspotQuestion": {
      "backgroundImageSettings": {
        "backgroundImage": {
          "path": "images/cell-diagram.png",
          "width": 800,
          "height": 600
        }
      },
      "hotspotSettings": {
        "hotspot": [
          {
            "userDefined": true,
            "computedSettings": {
              "x": 23.5,
              "y": 45.2,
              "width": 15.0,
              "height": 17.0,
              "figure": "rectangle"
            },
            "feedbackText": "Correct! This is the mitochondria."
          }
        ],
        "showFeedback": true,
        "taskDescription": "Click on the organelle that produces ATP."
      }
    }
  }
}
```

### 5.2 Image Hotspots (H5P.ImageHotspots) — Informational

**Use case**: Click hotspots to learn about each part

```json
{
  "library": "H5P.ImageHotspots 1.10",
  "params": {
    "image": { "path": "images/cell-diagram.png" },
    "hotspots": [
      {
        "position": { "x": 31.0, "y": 53.6 },
        "header": "Mitochondria",
        "content": [{
          "library": "H5P.Text 1.1",
          "params": { "text": "<p>The powerhouse of the cell...</p>" }
        }]
      }
    ]
  }
}
```

### 5.3 Drag and Drop (H5P.DragQuestion) — Label Placement

**Use case**: Drag labels to correct positions on the image

---

## 6. Practical Recommendations

### Which grounding approach to use?

| Scenario | Recommended Approach | Why |
|---|---|---|
| **Diagrams with text labels** (anatomy charts, circuit diagrams) | Gemini 2.5 only (single-stage) | Text labels give strong grounding signals; Gemini handles well |
| **Photos of real objects** (lab equipment, specimens) | Grounding DINO via Roboflow | Real-world objects need specialized detection |
| **Maps / Geography** | Gemini 2.5 + manual adjustment | Named regions are conceptual, not visual objects |
| **Artwork / Art History** | GPT-4o Stage 1 + Gemini Stage 2 | Needs both artistic understanding and spatial grounding |
| **Any image + high precision needed** | Grounding DINO (best precision) | Production-grade bounding boxes |

### Cost per image

| Service | Cost | Latency |
|---|---|---|
| GPT-4o (Stage 1) | ~$0.01-0.03 per image | ~3-5s |
| Gemini 2.5 (combined) | ~$0.005-0.02 per image | ~2-4s |
| Grounding DINO via Roboflow | Free tier: 10k/month | ~1-2s |
| Grounding DINO via Replicate | ~$0.002 per prediction | ~2-3s |

### Fallback: Manual Adjustment UI

Even with the best AI, some hotspots will need tweaking. Provide a simple adjustment UI:

```
┌──────────────────────────────────────────────────┐
│  🖼️ [Cell Diagram Image]                         │
│                                                   │
│     ┌──────┐                                      │
│     │ mito │ ← AI-placed hotspot (draggable)      │
│     └──────┘                                      │
│          ┌────────┐                               │
│          │nucleus │ ← drag to adjust              │
│          └────────┘                               │
│                                                   │
│  Detected Objects:                                │
│  ✅ mitochondria (87% confidence)  [Adjust]       │
│  ✅ nucleus (94% confidence)       [Adjust]       │
│  ⚠️ ribosome (42% confidence)     [Adjust][Remove]│
│  ➕ [Add Manual Hotspot]                          │
│                                                   │
│  Questions:                                       │
│  Q1: "Click on the organelle that produces ATP"   │
│  Q2: "Identify the structure containing DNA"      │
│  Q3: "Where are proteins synthesized?"            │
│                                                   │
│  [Generate H5P]  [Preview]                        │
└──────────────────────────────────────────────────┘
```

---

## 7. Implementation Plan

### Phase 1: Single-stage (Gemini only) — Fastest to ship

1. User uploads image + provides topic/context
2. Send to Gemini 2.5 with combined prompt:
   - Identify objects + return bounding boxes (0-1000 normalized)
   - Generate questions for each object
3. Convert coordinates to H5P percentage format
4. Generate H5P.ImageHotspotQuestion content
5. Preview + manual adjustment UI
6. Export as .h5p

**Effort**: ~1-2 weeks
**Precision**: Good enough for labeled diagrams, ~70-80% accuracy on photos

### Phase 2: Two-stage pipeline — Production quality

1. Add Grounding DINO via Roboflow API as Stage 2
2. Vision LLM identifies objects → Grounding DINO locates them precisely
3. Confidence-based filtering (hide low-confidence detections)
4. Support all 3 H5P types (Hotspot Question, Image Hotspots, Drag and Drop)

**Effort**: +1 week on top of Phase 1
**Precision**: ~90%+ accuracy

### Phase 3: Interactive editing — Polish

1. Drag-to-adjust hotspot positions on canvas
2. Add/remove hotspots manually
3. Resize hotspot regions
4. Re-generate questions for adjusted hotspots

---

## 8. Example: End-to-End Flow

```
Instructor uploads: human-heart-diagram.png
Provides context: "Cardiovascular system, Biology 101"

  ┌─ Stage 1 (GPT-4o) ──────────────────────────────────────┐
  │ Identified 6 objects:                                     │
  │  1. Left ventricle — pumps oxygenated blood               │
  │  2. Right atrium — receives deoxygenated blood            │
  │  3. Aorta — largest artery                                │
  │  4. Pulmonary artery — carries blood to lungs             │
  │  5. Superior vena cava — returns blood from upper body    │
  │  6. Mitral valve — between left atrium and ventricle      │
  │                                                           │
  │ Generated questions:                                      │
  │  Q1: "Click on the chamber that pumps blood to the body"  │
  │  Q2: "Find the vessel that carries blood to the lungs"    │
  │  Q3: "Identify the valve between the left chambers"       │
  └───────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─ Stage 2 (Grounding DINO) ──────────────────────────────┐
  │ "left ventricle"     → bbox [320, 280, 420, 380] (94%)  │
  │ "right atrium"       → bbox [180, 120, 260, 200] (91%)  │
  │ "aorta"              → bbox [280, 60, 340, 160]  (88%)  │
  │ "pulmonary artery"   → bbox [220, 80, 300, 140]  (85%)  │
  │ "superior vena cava" → bbox [160, 40, 200, 150]  (82%)  │
  │ "mitral valve"       → bbox [300, 240, 340, 270] (79%)  │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌─ Output ─────────────────────────────────────────────────┐
  │ H5P.ImageHotspotQuestion with:                           │
  │  - Background: human-heart-diagram.png                    │
  │  - 3 questions, each with correct hotspot zone           │
  │  - Feedback text per hotspot                             │
  │  - Additional info hotspots for learning                 │
  └──────────────────────────────────────────────────────────┘
```

---

## References

- [Grounding DINO — Roboflow](https://roboflow.com/model/grounding-dino)
- [Grounding DINO — Replicate API](https://replicate.com/adirik/grounding-dino)
- [Florence-2 Overview](https://medium.com/data-science/florence-2-mastering-multiple-vision-tasks-with-a-single-vlm-model-435d251976d0)
- [Gemini Bounding Boxes](https://ai.google.dev/gemini-api/docs/image-understanding)
- [GPT-4o Localization Limitations](https://community.openai.com/t/gpt-4o-model-image-coordinate-recognition/907625)
- [H5P Image Hotspot Question](https://h5p.org/image-hotspot-question)
- [H5P Image Hotspots](https://h5p.org/image-hotspots)
- [H5P Image Hotspots semantics.json](https://github.com/h5p/h5p-image-hotspots/blob/master/semantics.json)
