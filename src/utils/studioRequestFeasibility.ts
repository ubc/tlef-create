export function studioRequestFeasibility(library: string, instructions: string): string {
  const requested = (pattern: RegExp) => [...instructions.matchAll(pattern)].some(match => {
    const clause = instructions.slice(Math.max(0, match.index - 60), match.index).split(/[.!?。！？;\n]/).at(-1) || '';
    return !/(?:\b(?:do not|don't|without|avoid|exclude|no)\b(?:\s+\w+){0,3}\s*|(?:不要|不需要|避免|无需)\s*)$/i.test(clause);
  });
  const multipleChoice = requested(/\bmultiple[\s-]?choice\b|\bMCQs?\b|选择题/gi);
  const wordExport = requested(/(?:export|download|导出|下载).{0,50}(?:Word|docx|\.doc\b)|(?:Word|docx|\.doc\b).{0,50}(?:export|download|导出|下载)/gi);
  if (library.startsWith('H5P.DocumentationTool ') && multipleChoice) {
    return 'Documentation Tool cannot contain multiple-choice questions. Use Question Set or Column for those questions. For a Word export of written responses, use Documentation Tool without the multiple-choice step.';
  }
  if (wordExport && library && !library.startsWith('H5P.DocumentationTool ')) {
    return 'This H5P type cannot export all learner answers to a Word document. Use Documentation Tool for written responses, or remove the Word-export step from this activity.';
  }
  return '';
}
