import type { AuthoringTeachingBrief as TeachingBrief } from '../../../services/api';

export interface ObjectiveEdit {
  sessionId: string;
  assistantId?: string;
  assistantRevision?: number;
  currentVersionId: string | null;
  items: Array<{ id: string; text: string }>;
  originalItems: Array<{ id: string; text: string }>;
}
export interface AssumptionEdit {
  sessionId: string;
  items: Array<{ key: string; value: string }>;
  originalItems: Array<{ key: string; value: string }>;
}
interface Props {
  brief: TeachingBrief;
  objectives: Array<{ id: string; text: string }>;
  active: boolean;
  disabled: boolean;
  objectiveEdit: ObjectiveEdit | null;
  objectiveEditStale: boolean;
  assumptionEdit: AssumptionEdit | null;
  onEditObjectives: () => void;
  onChangeObjective: (id: string, text: string) => void;
  onSaveObjectives: () => void;
  onEditAssumptions: () => void;
  onChangeAssumption: (key: string, value: string) => void;
  onSaveAssumptions: () => void;
  onCancelEdit: () => void;
}
const classifications: Record<TeachingBrief['materials'][number]['classification'], string> = {
  'lecture-notes': 'Lecture notes', slides: 'Slides', 'worked-examples': 'Worked examples', assessment: 'Assessment',
  'reference-reading': 'Reference reading', mixed: 'Mixed material', unknown: 'Not classified'
};
const basisLabels = { metadata: 'Inferred from file details', 'text-excerpts': 'Inferred from sampled text', uncertain: 'Classification uncertain' };
const coverageLabels = { sampled: 'Sampled source excerpts', 'instructor-brief': 'Instructor teaching brief', 'not-read': 'Source text not read' };

export default function AuthoringTeachingBrief({ brief, objectives, active, disabled, objectiveEdit, objectiveEditStale, assumptionEdit,
  onEditObjectives, onChangeObjective, onSaveObjectives, onEditAssumptions, onChangeAssumption, onSaveAssumptions, onCancelEdit }: Props) {
  const validObjectives = !!objectiveEdit?.items.length && objectiveEdit.items.length <= 8
    && objectiveEdit.items.every(item => item.text.trim().length > 0 && item.text.trim().length <= 500)
    && objectiveEdit.items.some(item => objectiveEdit.originalItems.find(original => original.id === item.id)?.text.trim() !== item.text.trim());
  const validAssumptions = !!assumptionEdit?.items.length && assumptionEdit.items.every(item => item.value.trim())
    && assumptionEdit.items.map(item => `${item.key}: ${item.value.trim()}`).join('\n').length < 3800
    && assumptionEdit.items.some(item => assumptionEdit.originalItems.find(original => original.key === item.key)?.value.trim() !== item.value.trim());
  return <section className="authoring-teaching-brief" aria-label="Task teaching brief">
    <header><strong>Task teaching brief</strong><span className="authoring-brief-grounding">{brief.grounding === 'material-grounded' ? 'Based on selected materials' : 'From your teaching brief'}</span></header>
    {brief.summary && <p className="authoring-brief-summary">{brief.summary}</p>}
    <p className="authoring-brief-grounding">Coverage: {coverageLabels[brief.scope.coverage]}</p>
    {!!brief.scope.topics.length && <p>Topics: {brief.scope.topics.join('; ')}</p>}
    {!!brief.scope.exclusions.length && <p>Excluded: {brief.scope.exclusions.join('; ')}</p>}
    {!!brief.materials.length && <details className="authoring-brief-materials"><summary>Material review · {brief.materials.length} {brief.materials.length === 1 ? 'material' : 'materials'}</summary>
      <ul>{brief.materials.map(material => <li key={material.id}><strong>{material.name}</strong><span>{material.format.toUpperCase()} · {classifications[material.classification]}</span>
        <small>{basisLabels[material.basis]} · {material.readStatus === 'sampled'
          ? `${material.sourceCount} source ${material.sourceCount === 1 ? 'excerpt' : 'excerpts'} sampled` : 'Source text not read'}</small></li>)}</ul>
    </details>}
    {!!objectives.length && <div className="authoring-brief-objectives"><strong>Learning objectives · {objectives.length}</strong>
      {objectiveEdit ? <div className="authoring-brief-editor">
        {objectiveEdit.items.map((item, index) => <label key={item.id}><span>Objective {index + 1}</span>
          <textarea aria-label={`Edit learning objective ${index + 1}`} value={item.text} maxLength={500} rows={2} disabled={disabled || active}
            onChange={event => onChangeObjective(item.id, event.target.value)} /></label>)}
        {objectiveEditStale && <p role="alert">The saved objectives changed while you were editing. Your edits are kept here. Cancel edits and reopen the latest objectives before saving.</p>}
        <div className="authoring-brief-actions"><button type="button" className="btn btn-primary" disabled={disabled || active || objectiveEditStale || !validObjectives} onClick={onSaveObjectives}>Save objectives</button>
          <button type="button" className="authoring-quiet" disabled={disabled || active} onClick={onCancelEdit}>Cancel edits</button></div>
      </div> : <><ol>{objectives.map(item => <li key={item.id}>{item.text}</li>)}</ol><div className="authoring-brief-actions">
        <button type="button" className="authoring-quiet" disabled={disabled || !!assumptionEdit} onClick={onEditObjectives}>{active ? 'Pause and edit' : 'Edit learning objectives'}</button></div></>}
    </div>}
    {!!brief.assumptions.length && <details className="authoring-brief-assumptions" open={!!assumptionEdit}><summary>Teaching assumptions · {brief.assumptions.length}</summary>
      {assumptionEdit ? <div className="authoring-brief-editor">{assumptionEdit.items.map(item => <label key={item.key}><span>{item.key}</span>
        <input aria-label={`Edit teaching assumption ${item.key}`} value={item.value} maxLength={500} disabled={disabled || active}
          onChange={event => onChangeAssumption(item.key, event.target.value)} /></label>)}
        <div className="authoring-brief-actions"><button type="button" className="btn btn-primary" disabled={disabled || active || !validAssumptions} onClick={onSaveAssumptions}>Save teaching assumptions</button>
          <button type="button" className="authoring-quiet" disabled={disabled || active} onClick={onCancelEdit}>Cancel edits</button></div></div>
        : <><dl>{brief.assumptions.map(item => <div key={item.key}><dt>{item.key}</dt><dd>{item.value}<small>{item.provenance === 'default' ? 'Default assumption' : 'Inferred assumption'}{item.reason ? ` · ${item.reason}` : ''}</small></dd></div>)}</dl>
          <button type="button" className="authoring-quiet" disabled={disabled || active || !!objectiveEdit} onClick={onEditAssumptions}>Edit teaching assumptions</button></>}
    </details>}
  </section>;
}
