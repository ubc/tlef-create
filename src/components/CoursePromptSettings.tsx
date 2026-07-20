import { useCallback, useEffect, useState } from 'react';
import {
  coursePromptsApi,
  CoursePromptApproach,
  CoursePromptLibraryItem,
  CoursePromptOverride,
  CoursePromptType,
  EffectiveCoursePrompt,
  PromptValidationResult
} from '../services/api';

const PROMPT_TYPES: Array<{ value: CoursePromptType; label: string; description: string }> = [
  {
    value: 'quiz-blueprint',
    label: 'Quiz Blueprint',
    description: 'Plans the quiz allocation: total count, question types, LO/subpoint coverage, Bloom levels, and difficulty.'
  },
  {
    value: 'learning-objectives',
    label: 'Learning Objectives',
    description: 'Extracts and structures measurable learning objectives and subpoints from assigned materials.'
  },
  {
    value: 'question-generation',
    label: 'Question Generation',
    description: 'Writes each individual question, answer, tip, and feedback by following the approved blueprint and evidence.'
  },
  {
    value: 'coverage-map',
    label: 'Coverage Map',
    description: 'Links materials, source evidence, learning objectives, subpoints, and generated questions.'
  },
  {
    value: 'history-summary',
    label: 'Question History Summary',
    description: 'Compresses existing questions into coverage and duplication memory for future generations.'
  },
  {
    value: 'question-validation',
    label: 'Question Validation',
    description: 'Checks grounding, alignment, ambiguity, difficulty, and similarity before a question is accepted.'
  }
];

const APPROACHES: Array<{ value: CoursePromptApproach; label: string }> = [
  { value: 'support', label: 'Support Learning' },
  { value: 'assess', label: 'Assess Understanding' },
  { value: 'gamify', label: 'Gamify Learning' }
];

const APPROACH_DEPENDENT_PROMPT_TYPES = new Set<CoursePromptType>([
  'quiz-blueprint',
  'question-generation'
]);

interface CoursePromptSettingsProps {
  courseId: string;
  defaultPromptType?: CoursePromptType;
  defaultApproach?: CoursePromptApproach;
}

export default function CoursePromptSettings({
  courseId,
  defaultPromptType = 'quiz-blueprint',
  defaultApproach = 'support'
}: CoursePromptSettingsProps) {
  const [promptType, setPromptType] = useState<CoursePromptType>(defaultPromptType);
  const [approach, setApproach] = useState<CoursePromptApproach>(defaultApproach);
  const [effectivePrompt, setEffectivePrompt] = useState<EffectiveCoursePrompt | null>(null);
  const [history, setHistory] = useState<CoursePromptOverride[]>([]);
  const [library, setLibrary] = useState<CoursePromptLibraryItem[]>([]);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [promptName, setPromptName] = useState('Course prompt');
  const [validation, setValidation] = useState<PromptValidationResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [applyingPromptId, setApplyingPromptId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedApproach = APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType) ? approach : 'general';
  const selectedPromptDefinition = PROMPT_TYPES.find(type => type.value === promptType);

  const loadPrompt = useCallback(async (preserveMessage = false) => {
    setIsLoading(true);
    if (!preserveMessage) setMessage(null);
    try {
      const [{ prompt }, { history }, { library }] = await Promise.all([
        coursePromptsApi.getPrompt(courseId, promptType, selectedApproach),
        coursePromptsApi.getHistory(courseId, promptType, selectedApproach),
        coursePromptsApi.getLibrary(courseId, promptType, selectedApproach)
      ]);
      setEffectivePrompt(prompt);
      setDraftPrompt(prompt.editablePrompt ?? prompt.innerPrompt);
      setPromptName(
        prompt.activeOverride?.name
        || `${PROMPT_TYPES.find(type => type.value === promptType)?.label || 'Course'} prompt`
      );
      setHistory(history);
      setLibrary(library);
      setValidation(prompt.activeOverride?.validation || null);
    } catch (error) {
      console.error('Failed to load course prompt:', error);
      setMessage('Failed to load course prompt.');
    } finally {
      setIsLoading(false);
    }
  }, [courseId, promptType, selectedApproach]);

  useEffect(() => {
    loadPrompt();
  }, [loadPrompt]);

  const handleValidate = async () => {
    setMessage(null);
    setIsValidating(true);
    try {
      const result = await coursePromptsApi.validatePrompt(draftPrompt, promptType, selectedApproach);
      setValidation(result.validation);
      setMessage(
        result.validation.isSystemDefault
          ? 'This is the unchanged CREATE system default. Its locked instructions and runtime context are already included, so no additional course-level fixes are required.'
          : result.validation.aiReview?.available
          ? `Static checks and AI review completed with ${result.validation.aiReview.model}. Saving will run blocking checks again.`
          : 'Static checks completed. AI review was unavailable; saving will run blocking checks again.'
      );
    } catch (error) {
      console.error('Failed to validate prompt:', error);
      setMessage('Prompt validation failed.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await coursePromptsApi.savePrompt(courseId, {
        promptType,
        approach: selectedApproach,
        customInnerPrompt: draftPrompt,
        name: promptName.trim() || `${PROMPT_TYPES.find(type => type.value === promptType)?.label || 'Course'} prompt`
      });
      await loadPrompt(true);
      setValidation(result.validation);
      setMessage(`Course prompt saved as version ${result.prompt.version}.`);
    } catch (error) {
      console.error('Failed to save course prompt:', error);
      setMessage('Failed to save course prompt. Check validation errors and try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await coursePromptsApi.resetPrompt(courseId, promptType, selectedApproach);
      setEffectivePrompt(result.prompt);
      setDraftPrompt(result.prompt.editablePrompt ?? result.prompt.innerPrompt);
      setValidation(null);
      await loadPrompt(true);
      setMessage('Course prompt reset to the default. Previous versions remain in history.');
    } catch (error) {
      console.error('Failed to reset course prompt:', error);
      setMessage('Failed to reset course prompt.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraftPrompt(value);
    setValidation(null);
    setMessage(null);
  };

  const handleApplyValidationChanges = () => {
    if (!validation?.suggestedPrompt) return;
    setDraftPrompt(validation.suggestedPrompt);
    setValidation(null);
    setMessage('Suggested changes were applied to the draft. Review the text, then Validate again before saving.');
  };

  const handleLoadHistory = (item: CoursePromptOverride) => {
    setDraftPrompt(item.customInnerPrompt);
    setPromptName(item.name);
    setValidation(item.validation || null);
    setMessage(`Loaded version ${item.version} as a draft. Select Save Course Prompt to make it active.`);
  };

  const handleApplyPrompt = async (item: CoursePromptLibraryItem) => {
    setApplyingPromptId(item._id);
    setMessage(null);
    try {
      const result = await coursePromptsApi.applyPrompt(courseId, item._id);
      await loadPrompt(true);
      setValidation(result.validation);
      setMessage(`Applied “${item.name}” from ${item.folder.name} as a new course version.`);
    } catch (error) {
      console.error('Failed to apply saved prompt:', error);
      setMessage('Failed to apply this saved prompt.');
    } finally {
      setApplyingPromptId(null);
    }
  };

  const sourceLabel = effectivePrompt?.source === 'course'
    ? `Course override${effectivePrompt.activeOverride?.version ? ` v${effectivePrompt.activeOverride.version}` : ''}`
    : effectivePrompt?.source === 'user'
      ? 'User default'
      : 'System default';

  return (
    <div className="card course-prompt-card">
      <div className="card-header course-prompt-header">
        <div>
          <h3 className="card-title">Course Prompts</h3>
          <p className="card-description">
            View and customize the prompt strategy used for this course.
          </p>
        </div>
        <button className="btn btn-outline" onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? 'Hide Prompts' : 'Edit Prompts'}
        </button>
      </div>

      {isExpanded && (
        <div className="course-prompt-body">
          <div className="course-prompt-controls">
            <label>
              Prompt Type
              <select
                className="input"
                value={promptType}
                onChange={(event) => setPromptType(event.target.value as CoursePromptType)}
              >
                {PROMPT_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </label>

            {APPROACH_DEPENDENT_PROMPT_TYPES.has(promptType) ? (
              <label>
                Teaching Purpose
                <select
                  className="input"
                  value={approach}
                  onChange={(event) => setApproach(event.target.value as CoursePromptApproach)}
                >
                  {APPROACHES.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="course-prompt-source">
                <span>Prompt scope</span>
                <strong>General course prompt</strong>
              </div>
            )}

            <div className="course-prompt-source">
              <span>Active source</span>
              <strong>{isLoading ? 'Loading...' : sourceLabel}</strong>
            </div>

            <label>
              Version Name
              <input
                className="input"
                value={promptName}
                maxLength={120}
                onChange={(event) => setPromptName(event.target.value)}
              />
            </label>
          </div>

          <div className="course-prompt-purpose">
            <strong>{selectedPromptDefinition?.label}</strong>
            <span>{selectedPromptDefinition?.description}</span>
            {promptType === 'quiz-blueprint' && (
              <small>Blueprint decides what to generate; it does not write question content.</small>
            )}
            {promptType === 'question-generation' && (
              <small>Question Generation writes content for one allocation; it does not redesign the quiz plan.</small>
            )}
          </div>

          <div className="course-prompt-layer">
            <div className="course-prompt-layer-heading">
              <div>
                <strong>Editable course instructions</strong>
                <span>Teaching context and reusable preferences for this course and workflow.</span>
              </div>
              <span className="course-prompt-layer-badge is-editable">Editable</span>
            </div>
            <textarea
              className="course-prompt-editor"
              value={draftPrompt}
              onChange={(event) => handleDraftChange(event.target.value)}
              spellCheck={false}
              aria-label="Editable course prompt instructions"
            />
          </div>

          <details className="course-prompt-locked" open={promptType === 'quiz-blueprint' || promptType === 'question-generation'}>
            <summary>
              <span>
                <strong>Locked CREATE instructions</strong>
                <small>Applied to every request and cannot be changed at course level.</small>
              </span>
              <span className="course-prompt-layer-badge">Read only</span>
            </summary>
            <pre>{effectivePrompt?.lockedPrompt || 'Loading locked workflow instructions...'}</pre>
            {effectivePrompt?.lockedGuardrails?.length ? (
              <div className="course-prompt-guardrails">
                <strong>Runtime guardrails</strong>
                <ul>
                  {effectivePrompt.lockedGuardrails.map(item => <li key={item}>{item}</li>)}
                </ul>
                {effectivePrompt.hasDynamicRuntimeContext && (
                  <small>Objectives, evidence, Blueprint rows, history, and output schemas are inserted dynamically for the current request.</small>
                )}
              </div>
            ) : null}
          </details>

          {validation && (
            <div className={`course-prompt-validation validation-${validation.status}`}>
              <strong>Validation: {validation.status}</strong>
              {[...validation.errors, ...validation.warnings, ...validation.suggestions].map((item, index) => (
                <p key={`${item}-${index}`}>{item}</p>
              ))}
              {validation.changeSummary?.length ? (
                <div className="course-prompt-validation-summary">
                  <strong>Suggested changes</strong>
                  <ul>
                    {validation.changeSummary.map(item => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              ) : null}
              {validation.suggestedPrompt && (
                <div className="course-prompt-validation-actions">
                  <button type="button" className="btn btn-outline" onClick={handleApplyValidationChanges}>
                    Apply Changes
                  </button>
                  <small>Updates the draft only. Validate again, then save when ready.</small>
                </div>
              )}
            </div>
          )}

          {message && <p className="course-prompt-message">{message}</p>}

          <div className="course-prompt-actions">
            <button className="btn btn-outline" onClick={handleValidate} disabled={isSaving || isLoading || isValidating}>
              {isValidating ? 'Validating...' : 'Validate'}
            </button>
            <button className="btn btn-outline" onClick={handleReset} disabled={isSaving || isLoading}>
              Reset to Default
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={isSaving || isLoading}>
              {isSaving ? 'Saving...' : 'Save Course Prompt'}
            </button>
          </div>

          {history.length > 0 && (
            <div className="course-prompt-history">
              <h4>Version History</h4>
              {history.slice(0, 5).map(item => (
                <button
                  key={item._id}
                  className="course-prompt-history-item"
                  onClick={() => handleLoadHistory(item)}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>Version {item.version}{item.isActive ? ' · active' : ''} · Load as draft</small>
                  </span>
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                </button>
              ))}
            </div>
          )}

          <div className="course-prompt-library">
            <div className="course-prompt-library-heading">
              <div>
                <h4>Saved Prompt Library</h4>
                <p>Reuse a saved {PROMPT_TYPES.find(type => type.value === promptType)?.label.toLowerCase()} prompt from another course.</p>
              </div>
              <span>{library.length} saved</span>
            </div>
            {library.length === 0 ? (
              <p className="course-prompt-library-empty">No matching prompts have been saved in another course yet.</p>
            ) : (
              <div className="course-prompt-library-list">
                {library.slice(0, 8).map(item => (
                  <article key={item._id} className="course-prompt-library-item">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.folder.name} · Version {item.version}</span>
                      <p>{item.customInnerPrompt.slice(0, 150)}{item.customInnerPrompt.length > 150 ? '…' : ''}</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => handleApplyPrompt(item)}
                      disabled={isSaving || isLoading || applyingPromptId !== null}
                    >
                      {applyingPromptId === item._id ? 'Applying...' : 'Apply to This Course'}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
