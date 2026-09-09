import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2, Search, Wand2 } from 'lucide-react';
import { H5PStudioActivityType, H5PStudioContent, h5pEditorApi } from '../../services/api';

interface Props {
  contents: H5PStudioContent[];
  quizId?: string;
  onGenerated: (content: H5PStudioContent) => void;
  onBusyChange: (busy: boolean) => void;
}

export default function StudioAIComposer({ contents, quizId, onGenerated, onBusyChange }: Props) {
  const [types, setTypes] = useState<H5PStudioActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState('');
  const [templateContentId, setTemplateContentId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const selected = types.find(type => type.library === library);
  const templates = contents.filter(content => content.mainLibrary === selected?.machineName);
  const filtered = useMemo(() => types.filter(type => `${type.title} ${type.category}`.toLowerCase().includes(query.toLowerCase())), [types, query]);
  const groups = [...new Set(filtered.map(type => type.category))];

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    h5pEditorApi.getActivityCatalog().then(response => {
      if (active) setTypes(response.data?.types || []);
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : 'Could not load activity types.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  const generate = async () => {
    if (!selected || generating) return;
    setGenerating(true);
    onBusyChange(true);
    setError('');
    try {
      const response = await h5pEditorApi.generateActivity({ library, instructions: instructions.trim(), templateContentId: templateContentId || undefined, quizId });
      if (!response.data?.content) throw new Error('The saved draft was not returned. Refresh Your content before retrying.');
      onGenerated(response.data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the activity. Your original content is unchanged.');
    } finally {
      setGenerating(false);
      onBusyChange(false);
    }
  };

  const prepare = async () => {
    if (!selected || generating || preparing) return;
    setPreparing(true); onBusyChange(true); setError('');
    try {
      const response = await h5pEditorApi.prepareTemplate(library);
      if (!response.data?.content) throw new Error('The template was not returned. Check Your content before retrying.');
      onGenerated(response.data.content);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare the template.'); }
    finally { setPreparing(false); onBusyChange(false); }
  };

  return (
    <section className="studio-ai-composer" aria-labelledby="studio-ai-heading">
      <span className="h5p-studio-eyebrow">AI activity builder · Beta</span>
      <h2 id="studio-ai-heading">What would you like your students to do?</h2>
      <p>Choose an activity, describe the learning experience, then review your AI draft in the official editor.</p>
      {quizId && <p className="studio-ai-context">Using this Quiz’s saved objectives and questions as context. The new activity will not replace or change your Quiz.</p>}
      {loading ? <p role="status"><Loader2 className="spin" size={16} /> Checking installed H5P types…</p> : (
        <fieldset disabled={generating || preparing}>
          <legend className="sr-only">AI activity settings</legend>
          <div className="studio-ai-fields">
            <section>
              <h3>1. Choose an activity</h3>
              <label htmlFor="studio-type-search"><Search size={16} /> Find a type</label>
              <input id="studio-type-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Try chart, video, memory…" />
              <label htmlFor="studio-type">Activity type</label>
              <select id="studio-type" value={library} onChange={event => { setLibrary(event.target.value); setTemplateContentId(''); setError(''); }}>
                <option value="">Choose from {types.length} installed types</option>
                {selected && !filtered.includes(selected) && <option value={selected.library}>{selected.title}</option>}
                {groups.map(group => <optgroup key={group} label={group}>{filtered.filter(type => type.category === group).map(type => (
                  <option key={type.library} value={type.library}>{type.title}{type.mode === 'template' ? ' — needs a saved template' : type.mode === 'unavailable' ? ' — needs maintenance' : ''}</option>
                ))}</optgroup>)}
              </select>
              {filtered.length === 0 && <p>No matching types. Try a different search.</p>}
              {selected && <div className="studio-ai-guidance" role="status"><strong>{selected.title} · {selected.version}</strong><p>{selected.guidance}</p></div>}
              {selected && selected.mode !== 'unavailable' && (selected.mode === 'template' || templates.length > 0) && (
                <>
                  <label htmlFor="studio-template">{selected.mode === 'template' ? 'Saved template (required)' : 'Start from a saved activity (optional)'}</label>
                  <select id="studio-template" value={templateContentId} onChange={event => setTemplateContentId(event.target.value)}>
                    <option value="">{selected.mode === 'template' ? 'Choose your prepared template' : 'Create a new activity'}</option>
                    {templates.map(content => <option key={content.contentId} value={content.contentId}>{content.title}</option>)}
                  </select>
                  <p className="studio-ai-hint">AI uses the saved version and creates a separate draft. It does not generate new images or audio.</p>
                  {selected.mode === 'template' && !templates.length && <button type="button" className="btn btn-outline" onClick={prepare}>Prepare a template in the editor <ArrowRight size={16} /></button>}
                </>
              )}
            </section>
            <section>
              <h3>2. Describe the learning experience</h3>
              <label htmlFor="studio-instructions">Teaching instructions</label>
              <textarea id="studio-instructions" rows={8} maxLength={12000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="For first-year biology students, create a short activity about cell organelles. Focus on their functions, use plain language, and include explanations for incorrect answers. Paste source facts here if needed." />
              <p className="studio-ai-hint">Include your audience, learning goal and source facts. For media templates, explain what the media shows; AI does not inspect the image or listen to the audio.</p>
            </section>
          </div>
          <footer className="studio-ai-footer">
            <p><strong>Next: review, then preview.</strong> AI drafts need your accuracy, layout and accessibility checks before sharing.</p>
            <button type="button" className="btn btn-primary" onClick={generate} disabled={!selected || selected.mode === 'unavailable' || (selected.mode === 'template' && !templateContentId) || instructions.trim().length < 10}>
              <Wand2 size={17} /> Generate AI draft
            </button>
          </footer>
        </fieldset>
      )}
      {generating && <p className="studio-ai-progress" role="status"><Loader2 className="spin" size={20} /> Generating and validating your draft. Keep this page open; complex activities may take a few minutes.</p>}
      {preparing && <p className="studio-ai-progress" role="status"><Loader2 className="spin" size={20} /> Preparing the selected version in the official editor…</p>}
      {error && <div className="studio-ai-error" role="alert"><p>{error}</p>{!types.length && <button className="btn btn-outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading types</button>}</div>}
    </section>
  );
}
