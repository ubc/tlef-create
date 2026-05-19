/**
 * Builds the LLM prompt for Documentation Tool generation.
 *
 * The LLM fills in:
 *   - title: overall tool title
 *   - pages[type=intro]: introText + fields[].label
 *   - pages[type=task]: title + fields[].label
 *
 * Fixed page types (goals, assessment, export) are declared in the skeleton
 * so the LLM knows not to generate content for them.
 */
export function buildDocumentationPrompt(customPrompt, learningObjective) {
  const context = learningObjective
    ? `Learning Objective: ${learningObjective}`
    : `Instructor Prompt: ${customPrompt}`;

  return `Generate a Documentation Tool for students to document their work on the following topic.

${context}

The Documentation Tool is a structured reflection/documentation wizard. Students fill in each page's text fields, set and assess goals, then export their responses as a Word document.

RULES:
1. Only fill in [FILL] fields. Do NOT add or remove pages.
2. Keep field labels concise (under 15 words) and directly relevant to the topic.
3. Intro page: write 1-2 sentences introducing the documentation task.
4. Task pages: each should focus on a distinct phase (e.g. Planning, Implementation, Reflection).
5. Return valid JSON only — no explanation outside the JSON.

Page skeleton to fill in:

  Page 1 (intro): "[FILL: 1-2 sentence intro]", fields: [
    "[FILL: open-ended prompt for students to describe their starting point]",
    "[FILL: prompt asking about prior knowledge or experience]"
  ]
  Page 2 (goals): FIXED — do not generate content
  Page 3 (task - Planning): title: "[FILL]", fields: [
    "[FILL: planning prompt 1]",
    "[FILL: planning prompt 2]"
  ]
  Page 4 (task - Work): title: "[FILL]", fields: [
    "[FILL: work documentation prompt 1]",
    "[FILL: work documentation prompt 2]"
  ]
  Page 5 (task - Reflection): title: "[FILL]", fields: [
    "[FILL: reflection prompt 1]",
    "[FILL: reflection prompt 2]"
  ]
  Page 6 (assessment): FIXED — do not generate content
  Page 7 (export): FIXED — do not generate content

Return this exact JSON shape:
{
  "title": "...",
  "pages": [
    {
      "type": "intro",
      "introText": "...",
      "fields": [
        { "label": "..." },
        { "label": "..." }
      ]
    },
    { "type": "goals" },
    {
      "type": "task",
      "title": "...",
      "fields": [
        { "label": "..." },
        { "label": "..." }
      ]
    },
    {
      "type": "task",
      "title": "...",
      "fields": [
        { "label": "..." },
        { "label": "..." }
      ]
    },
    {
      "type": "task",
      "title": "...",
      "fields": [
        { "label": "..." },
        { "label": "..." }
      ]
    },
    { "type": "assessment" },
    { "type": "export" }
  ]
}`;
}
