import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { h5pEditorApi, type H5PStudioContent } from '../../services/api';

/** Course navigation shares activity identity, without implying a lossless reverse conversion. */
export default function CourseStudioActivities({ courseId, learningObjects }: {
  courseId: string;
  learningObjects: Array<{ id: string; name: string }>;
}) {
  const [contents, setContents] = useState<H5PStudioContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setContents([]); setLoading(true); setError(false);
    void h5pEditorApi.listContents({ folderId: courseId }).then(response => {
      if (active) setContents(response.data?.contents || []);
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [courseId, retry]);
  return (
    <section className="course-workspace-section" aria-labelledby="course-studio-title">
      <div className="course-workspace-section-heading">
        <div>
          <span className="eyebrow">Advanced authoring</span>
          <h3 id="course-studio-title">H5P Studio activities{!loading && !error ? ` (${contents.length})` : ''}</h3>
          <p>Continue editing activities linked to this course. Studio saves its own version; course questions, coverage and course exports still use the guided workflow.</p>
        </div>
      </div>
      {loading && <p role="status">Loading course activities…</p>}
      {error && <p role="alert">Course activities could not be loaded. <button className="btn btn-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
      {!loading && !error && contents.length === 0 && <p>Open a learning object's Preview &amp; Export tab and choose Advanced H5P Editor to create a linked Studio activity.</p>}
      {contents.length > 0 && <div className="quiz-grid">
        {contents.map(content => {
          const source = learningObjects.find(object => object.id === content.quizId);
          return <article className="card" key={content.contentId} style={{ padding: 20 }}>
            <h4>{content.title}</h4>
            <p>{content.mainLibrary || 'H5P activity'} · {content.status === 'ready' ? 'Saved' : 'Draft'}</p>
            <p>Separate Studio version · Edited {new Date(content.lastEditedAt || content.updatedAt).toLocaleDateString()}</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" to={`/h5p-studio?contentId=${encodeURIComponent(content.contentId)}`}>Continue in Studio</Link>
              {source && <Link className="btn btn-secondary" to={`/course/${encodeURIComponent(courseId)}/quiz/${encodeURIComponent(source.id)}?tab=review`}>Course source: {source.name}</Link>}
            </div>
          </article>;
        })}
      </div>}
    </section>
  );
}
