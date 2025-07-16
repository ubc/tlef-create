import { useState } from 'react';
import { Upload, Sparkles, Edit, Plus, Trash2 } from 'lucide-react';
import '../styles/components/LearningObjectives.css';

interface LearningObjectivesProps {
  assignedMaterials: string[];
  objectives: string[];
  onObjectivesChange: (objectives: string[]) => void;
}

const LearningObjectives = ({ assignedMaterials, objectives, onObjectivesChange }: LearningObjectivesProps) => {
  const [mode, setMode] = useState<'upload' | 'generate' | 'edit'>('upload');
  const [textInput, setTextInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  const handleUploadObjectives = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      const newObjectives = textInput
          .split('\n')
          .filter(line => line.trim())
          .map(line => line.trim());
      onObjectivesChange(newObjectives);
      setTextInput('');
      setMode('edit');
    }
  };

  const handleGenerateObjectives = async () => {
    if (assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first.');
      return;
    }

    setIsGenerating(true);

    // Simulate AI generation
    setTimeout(() => {
      const generatedObjectives = [
        'Students will be able to analyze and interpret complex geological formations and their formation processes.',
        'Students will demonstrate understanding of plate tectonics and their role in shaping Earth\'s surface.',
        'Students will evaluate the environmental impact of geological processes on human settlements.',
        'Students will apply field observation techniques to identify and classify different rock types.',
        'Students will synthesize knowledge of geological time scales and their significance in Earth history.'
      ];

      onObjectivesChange(generatedObjectives);
      setIsGenerating(false);
      setMode('edit');
    }, 3000);
  };

  const handleEditObjective = (index: number) => {
    setEditingIndex(index);
    setEditText(objectives[index]);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editText.trim()) {
      const updatedObjectives = [...objectives];
      updatedObjectives[editingIndex] = editText.trim();
      onObjectivesChange(updatedObjectives);
      setEditingIndex(null);
      setEditText('');
    }
  };

  const handleDeleteObjective = (index: number) => {
    if (confirm('Are you sure you want to delete this learning objective?')) {
      const updatedObjectives = objectives.filter((_, i) => i !== index);
      onObjectivesChange(updatedObjectives);
    }
  };

  const handleAddNewObjective = () => {
    const newObjective = 'New learning objective...';
    onObjectivesChange([...objectives, newObjective]);
    setEditingIndex(objectives.length);
    setEditText(newObjective);
  };

  const handleRegenerateAll = () => {
    if (confirm('Are you sure you want to regenerate all learning objectives? This will replace your current objectives.')) {
      onObjectivesChange([]);
      setMode('generate');
      handleGenerateObjectives();
    }
  };

  if (assignedMaterials.length === 0) {
    return (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Learning Objectives</h3>
            <p className="card-description">
              Please assign materials to this quiz first before setting learning objectives.
            </p>
          </div>
        </div>
    );
  }

  return (
      <div className="learning-objectives">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Learning Objectives</h3>
            <p className="card-description">
              Define what students should achieve after completing this quiz
            </p>
          </div>

          {objectives.length === 0 && (
              <div className="objectives-setup">
                <div className="setup-options">
                  <button
                      className={`setup-option ${mode === 'upload' ? 'active' : ''}`}
                      onClick={() => setMode('upload')}
                  >
                    <Upload size={24} />
                    <h4>Upload My Own</h4>
                    <p>Paste your existing learning objectives</p>
                  </button>

                  <button
                      className={`setup-option ${mode === 'generate' ? 'active' : ''}`}
                      onClick={() => setMode('generate')}
                  >
                    <Sparkles size={24} />
                    <h4>Generate from Materials</h4>
                    <p>AI will analyze your materials and suggest objectives</p>
                  </button>
                </div>

                {mode === 'upload' && (
                    <form onSubmit={handleUploadObjectives} className="upload-form">
                <textarea
                    className="textarea"
                    placeholder="Enter each learning objective on a new line..."
                    rows={6}
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    required
                />
                      <div className="form-actions">
                        <button type="submit" className="btn btn-primary">
                          Upload Objectives
                        </button>
                      </div>
                    </form>
                )}

                {mode === 'generate' && (
                    <div className="generate-section">
                      {isGenerating ? (
                          <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>Analyzing your materials to suggest learning objectives...</p>
                          </div>
                      ) : (
                          <div className="generate-prompt">
                            <p>Generate learning objectives based on {assignedMaterials.length} assigned material(s)</p>
                            <button className="btn btn-primary" onClick={handleGenerateObjectives}>
                              <Sparkles size={16} />
                              Generate Learning Objectives
                            </button>
                          </div>
                      )}
                    </div>
                )}
              </div>
          )}

          {objectives.length > 0 && (
              <div className="objectives-list">
                <div className="objectives-header">
                  <h4>Learning Objectives ({objectives.length})</h4>
                  <div className="objectives-actions">
                    <button className="btn btn-outline" onClick={handleAddNewObjective}>
                      <Plus size={16} />
                      Add New
                    </button>
                    <button className="btn btn-outline" onClick={handleRegenerateAll}>
                      <Sparkles size={16} />
                      Regenerate All
                    </button>
                  </div>
                </div>

                <div className="objectives-items">
                  {objectives.map((objective, index) => (
                      <div key={index} className="objective-item">
                        <div className="objective-number">LO {index + 1}</div>
                        <div className="objective-content">
                          {editingIndex === index ? (
                              <div className="objective-edit">
                        <textarea
                            className="textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            rows={2}
                        />
                                <div className="edit-actions">
                                  <button className="btn btn-secondary" onClick={() => setEditingIndex(null)}>
                                    Cancel
                                  </button>
                                  <button className="btn btn-primary" onClick={handleSaveEdit}>
                                    Save
                                  </button>
                                </div>
                              </div>
                          ) : (
                              <div className="objective-display">
                                <p>{objective}</p>
                                <div className="objective-actions">
                                  <button className="btn btn-ghost" onClick={() => handleEditObjective(index)}>
                                    <Edit size={16} />
                                  </button>
                                  <button className="btn btn-ghost" onClick={() => handleDeleteObjective(index)}>
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                          )}
                        </div>
                      </div>
                  ))}
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default LearningObjectives;