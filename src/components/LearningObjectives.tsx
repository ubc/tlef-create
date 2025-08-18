import { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Upload, Sparkles, Edit, Plus, Trash2, RotateCcw, X } from 'lucide-react';
import { RootState, AppDispatch } from '../store';
import { 
  fetchObjectives, 
  generateObjectives, 
  classifyObjectives, 
  saveObjectives, 
  updateObjective, 
  deleteObjective,
  clearObjectives,
  regenerateSingleObjective,
  deleteAllObjectives
} from '../store/slices/learningObjectiveSlice';
import '../styles/components/LearningObjectives.css';

interface LearningObjectivesProps {
  assignedMaterials: string[];
  objectives: string[];
  onObjectivesChange: (objectives: string[]) => void;
  quizId: string;
  onNavigateNext?: () => void;
}

const LearningObjectives = ({ assignedMaterials, objectives, onObjectivesChange, quizId, onNavigateNext }: LearningObjectivesProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { objectives: reduxObjectives, loading, generating, classifying, error } = useSelector((state: RootState) => state.learningObjective);
  
  const [mode, setMode] = useState<'classify' | 'generate' | 'edit' | 'manual'>('classify');
  const [textInput, setTextInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [manualObjectives, setManualObjectives] = useState<string[]>([]);
  const [newObjective, setNewObjective] = useState('');
  const [showNavigation, setShowNavigation] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);

  // Use Redux objectives if available, otherwise fallback to props
  const currentObjectives = reduxObjectives.length > 0 ? reduxObjectives.map(obj => obj.text) : objectives;
  const isGenerating = generating || classifying;

  // Load objectives when component mounts
  useEffect(() => {
    if (quizId) {
      dispatch(fetchObjectives(quizId));
    }
  }, [quizId, dispatch]);

  // Sync Redux objectives with parent component
  useEffect(() => {
    if (reduxObjectives.length > 0) {
      onObjectivesChange(reduxObjectives.map(obj => obj.text));
    }
  }, [reduxObjectives, onObjectivesChange]);

  // Effect to handle navigation appearance with smooth scroll
  useEffect(() => {
    const shouldShowNav = objectives.length > 0;
    
    if (shouldShowNav && !showNavigation) {
      // Show navigation section
      setShowNavigation(true);
      
      // Scroll to navigation section after it appears
      setTimeout(() => {
        if (navigationRef.current) {
          navigationRef.current.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'start'
          });
        }
      }, 300); // Delay to allow render
    } else if (!shouldShowNav && showNavigation) {
      // Hide navigation section
      setShowNavigation(false);
    }
  }, [objectives.length, showNavigation]);

  const handleClassifyObjectives = async (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      try {
        await dispatch(classifyObjectives({ quizId, text: textInput }));
        setTextInput('');
        setMode('edit');
      } catch (error) {
        console.error('Failed to classify objectives:', error);
      }
    }
  };

  const handleAddManualObjective = () => {
    if (newObjective.trim()) {
      setManualObjectives([...manualObjectives, newObjective.trim()]);
      setNewObjective('');
    }
  };

  const handleRemoveManualObjective = (index: number) => {
    setManualObjectives(manualObjectives.filter((_, i) => i !== index));
  };

  const handleSaveManualObjectives = async () => {
    if (manualObjectives.length > 0) {
      try {
        const objectivesData = manualObjectives.map((text, index) => ({
          text,
          order: index
        }));
        await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        setManualObjectives([]);
        setMode('edit');
      } catch (error) {
        console.error('Failed to save manual objectives:', error);
      }
    }
  };

  const handleGenerateObjectives = async () => {
    if (assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first.');
      return;
    }

    try {
      await dispatch(generateObjectives({ quizId, materialIds: assignedMaterials }));
      setMode('edit');
    } catch (error) {
      console.error('Failed to generate objectives:', error);
    }
  };

  const handleEditObjective = (index: number) => {
    setEditingIndex(index);
    setEditText(currentObjectives[index]);
  };

  const handleSaveEdit = async () => {
    if (editingIndex !== null && editText.trim()) {
      try {
        // If using Redux objectives, update via Redux
        if (reduxObjectives.length > 0 && reduxObjectives[editingIndex]) {
          const objectiveId = reduxObjectives[editingIndex]._id;
          await dispatch(updateObjective({ id: objectiveId, text: editText.trim() }));
        } else {
          // Otherwise, update via local state and save to backend
          const updatedObjectives = [...currentObjectives];
          updatedObjectives[editingIndex] = editText.trim();
          const objectivesData = updatedObjectives.map((text, i) => ({ text, order: i }));
          await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        }
        setEditingIndex(null);
        setEditText('');
      } catch (error) {
        console.error('Failed to update objective:', error);
        // Fallback to local state only
        const updatedObjectives = [...currentObjectives];
        updatedObjectives[editingIndex] = editText.trim();
        onObjectivesChange(updatedObjectives);
        setEditingIndex(null);
        setEditText('');
      }
    }
  };

  const handleDeleteObjective = async (index: number) => {
    if (confirm('Are you sure you want to delete this learning objective?')) {
      try {
        // If using Redux objectives, delete via Redux
        if (reduxObjectives.length > 0 && reduxObjectives[index]) {
          const objectiveId = reduxObjectives[index]._id;
          await dispatch(deleteObjective(objectiveId));
        } else {
          // Otherwise, delete from local state and save to backend
          const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
          const objectivesData = updatedObjectives.map((text, i) => ({ text, order: i }));
          await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        }
      } catch (error) {
        console.error('Failed to delete objective:', error);
        // Fallback to local state only
        const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
        onObjectivesChange(updatedObjectives);
      }
    }
  };

  const handleAddNewObjective = async () => {
    const newObjectiveText = 'New learning objective...';
    try {
      // Use current objectives (which could be from Redux or local state)
      const existingObjectives = currentObjectives.map((text, i) => ({ text, order: i }));
      const objectivesData = [
        ...existingObjectives,
        { text: newObjectiveText, order: currentObjectives.length }
      ];
      
      await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
      setEditingIndex(currentObjectives.length);
      setEditText(newObjectiveText);
    } catch (error) {
      console.error('Failed to add objective:', error);
      // Fall back to local state
      onObjectivesChange([...currentObjectives, newObjectiveText]);
      setEditingIndex(currentObjectives.length);
      setEditText(newObjectiveText);
    }
  };

  const handleRegenerateAll = async () => {
    if (currentObjectives.length === 0) {
      alert('No learning objectives to regenerate.');
      return;
    }

    if (!assignedMaterials || assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first to regenerate learning objectives.');
      return;
    }

    const currentCount = currentObjectives.length;
    if (confirm(`Are you sure you want to regenerate all ${currentCount} learning objectives? This will replace your current objectives with new AI-generated ones.`)) {
      try {
        console.log('🔄 Regenerate All: Starting with', currentCount, 'objectives');
        
        // First, delete all existing objectives from backend
        console.log('🔄 Regenerate All: Deleting all existing objectives');
        await dispatch(deleteAllObjectives(quizId));
        
        // Also clear local state
        onObjectivesChange([]);
        console.log('🔄 Regenerate All: Cleared local state');
        
        // Generate new objectives with the same count as before
        console.log('🔄 Regenerate All: Generating new objectives with targetCount:', currentCount);
        await dispatch(generateObjectives({ quizId, materialIds: assignedMaterials, targetCount: currentCount }));
        
        console.log('🔄 Regenerate All: Completed successfully');
      } catch (error) {
        console.error('Failed to regenerate all objectives:', error);
        alert('Failed to regenerate learning objectives. Please try again.');
      }
    }
  };

  const handleDeleteAll = async () => {
    console.log('🗑️ Delete All clicked - quizId:', quizId);
    
    if (confirm('Are you sure you want to delete ALL learning objectives? This action cannot be undone.')) {
      console.log('🗑️ Delete All confirmed - dispatching deleteAllObjectives with quizId:', quizId);
      
      try {
        // Use the dedicated delete all endpoint
        const result = await dispatch(deleteAllObjectives(quizId));
        console.log('🗑️ Delete All result:', result);
        
        // Also clear local state
        onObjectivesChange([]);
        console.log('🗑️ Delete All completed successfully');
      } catch (error) {
        console.error('🗑️ Failed to delete all objectives:', error);
        console.error('🗑️ Error details:', error.message, error.stack);
        
        // Fallback to clearing local state only
        dispatch(clearObjectives());
        onObjectivesChange([]);
      }
    } else {
      console.log('🗑️ Delete All cancelled by user');
    }
  };

  const handleRegenerateSingle = async (index: number) => {
    if (!assignedMaterials || assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first to regenerate learning objectives.');
      return;
    }

    const currentObjective = currentObjectives[index];
    const truncatedObjective = currentObjective.length > 50 
      ? currentObjective.substring(0, 50) + '...' 
      : currentObjective;

    if (confirm(`Are you sure you want to regenerate this learning objective?\n\nCurrent: "${truncatedObjective}"\n\nThis will be replaced with a new AI-generated objective based on your course materials.`)) {
      try {
        // If using Redux objectives, regenerate via Redux action
        if (reduxObjectives.length > 0 && reduxObjectives[index]) {
          const objectiveId = reduxObjectives[index]._id;
          await dispatch(regenerateSingleObjective(objectiveId));
        } else {
          // Fallback: regenerate all and take first result (for local state objectives)
          const generatedObjectives = await dispatch(generateObjectives({ quizId, materialIds: assignedMaterials, targetCount: 1 }));
          
          if (generatedObjectives.payload && generatedObjectives.payload.length > 0) {
            const updatedObjectives = [...currentObjectives];
            updatedObjectives[index] = generatedObjectives.payload[0].text;
            
            const objectivesData = updatedObjectives.map((text, i) => ({ text, order: i }));
            await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
          }
        }
      } catch (error) {
        console.error('Failed to regenerate objective:', error);
        alert('Failed to regenerate the learning objective. Please try again.');
      }
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

          {currentObjectives.length === 0 && (
              <div className="objectives-setup">
                <div className="setup-options">
                  <button
                      className={`setup-option ${mode === 'classify' ? 'active' : ''}`}
                      onClick={() => setMode('classify')}
                  >
                    <Upload size={24} />
                    <h4>AI Classify</h4>
                    <p>Paste text and AI will extract learning objectives</p>
                  </button>

                  <button
                      className={`setup-option ${mode === 'manual' ? 'active' : ''}`}
                      onClick={() => setMode('manual')}
                  >
                    <Plus size={24} />
                    <h4>Add Manually</h4>
                    <p>Create learning objectives one by one</p>
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

                {mode === 'classify' && (
                    <div className="classify-section">
                      {isGenerating ? (
                          <div className="generating-state">
                            <div className="loading-spinner"></div>
                            <p>Processing your text to identify learning objectives...</p>
                          </div>
                      ) : (
                          <form onSubmit={handleClassifyObjectives} className="classify-form">
                            <textarea
                                className="textarea"
                                placeholder="Paste your course syllabus, lecture notes, or learning materials. AI will extract learning objectives from the text..."
                                rows={6}
                                value={textInput}
                                onChange={(e) => setTextInput(e.target.value)}
                                required
                            />
                            <div className="form-actions">
                              <button type="submit" className="btn btn-primary">
                                AI Classify
                              </button>
                            </div>
                          </form>
                      )}
                    </div>
                )}

                {mode === 'manual' && (
                    <div className="manual-section">
                      <div className="manual-form">
                        <div className="objective-input-group">
                          <textarea
                              className="textarea"
                              placeholder="Enter a learning objective (e.g., 'Students will be able to explain the key concepts of...')"
                              rows={3}
                              value={newObjective}
                              onChange={(e) => setNewObjective(e.target.value)}
                          />
                          <button
                              type="button"
                              className="btn btn-primary"
                              onClick={handleAddManualObjective}
                              disabled={!newObjective.trim()}
                          >
                            <Plus size={16} />
                            Add Objective
                          </button>
                        </div>

                        {manualObjectives.length > 0 && (
                            <div className="manual-objectives-preview">
                              <h5>Learning Objectives to Save ({manualObjectives.length}):</h5>
                              <div className="objectives-preview-list">
                                {manualObjectives.map((objective, index) => (
                                    <div key={index} className="preview-objective">
                                      <span className="objective-number">LO {index + 1}</span>
                                      <span className="objective-text">{objective}</span>
                                      <button
                                          className="btn btn-ghost btn-sm"
                                          onClick={() => handleRemoveManualObjective(index)}
                                          title="Remove objective"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                ))}
                              </div>
                              <div className="manual-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveManualObjectives}
                                >
                                  Save {manualObjectives.length} Objective{manualObjectives.length !== 1 ? 's' : ''}
                                </button>
                                <button
                                    className="btn btn-outline"
                                    onClick={() => setManualObjectives([])}
                                >
                                  Clear All
                                </button>
                              </div>
                            </div>
                        )}
                      </div>
                    </div>
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

          {currentObjectives.length > 0 && (
              <div className="objectives-list">
                <div className="objectives-header">
                  <h4>Learning Objectives ({currentObjectives.length})</h4>
                  <div className="objectives-actions">
                    <button className="btn btn-outline" onClick={handleAddNewObjective}>
                      <Plus size={16} />
                      Add New
                    </button>
                    <button className="btn btn-outline btn-danger" onClick={handleDeleteAll}>
                      <X size={16} />
                      Delete All
                    </button>
                    <button className="btn btn-outline" onClick={handleRegenerateAll}>
                      <Sparkles size={16} />
                      Regenerate All
                    </button>
                  </div>
                </div>

                <div className="objectives-items">
                  {currentObjectives.map((objective, index) => (
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
                                  <button className="btn btn-ghost" onClick={() => handleRegenerateSingle(index)}>
                                    <RotateCcw size={16} />
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

          {/* Navigation Section */}
          {showNavigation && (
            <div 
              ref={navigationRef}
              className={`tab-navigation ${objectives.length > 0 ? 'nav-visible' : 'nav-hidden'}`}
            >
              <div className="nav-content">
                <div className="nav-info">
                  <h4>Learning Objectives Set</h4>
                  <p>You have defined {objectives.length} learning objective{objectives.length !== 1 ? 's' : ''} for this quiz.</p>
                </div>
                <div className="nav-actions">
                  <button 
                    className="btn btn-primary btn-nav"
                    onClick={() => {
                      if (onNavigateNext) {
                        onNavigateNext();
                      } else {
                        // Fallback method
                        const tabButtons = document.querySelectorAll('button');
                        const questionsTab = Array.from(tabButtons).find(button => 
                          button.textContent?.includes('Generate Questions')
                        );
                        if (questionsTab) {
                          questionsTab.click();
                          setTimeout(() => {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }, 200);
                        }
                      }
                    }}
                  >
                    Next: Generate Questions
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  );
};

export default LearningObjectives;