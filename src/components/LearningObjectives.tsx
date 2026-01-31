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
import RegeneratePromptModal from './RegeneratePromptModal';
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
  const [targetObjectiveCount, setTargetObjectiveCount] = useState<number | ''>(''); // Allow empty input
  const navigationRef = useRef<HTMLDivElement>(null);

  // Regenerate modal state
  const [regenerateModalOpen, setRegenerateModalOpen] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [objectiveToRegenerate, setObjectiveToRegenerate] = useState<{ index: number; text: string } | null>(null);

  // Delete confirmation modal state
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    show: boolean;
    index: number;
    objectiveId: string;
    questionCount: number;
  } | null>(null);
  const [dontShowDeleteWarning, setDontShowDeleteWarning] = useState(() => {
    return localStorage.getItem('dontShowDeleteLOWarning') === 'true';
  });

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
    const shouldShowNav = currentObjectives.length > 0;

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
  }, [currentObjectives.length, showNavigation]);

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

    const count = typeof targetObjectiveCount === 'number' ? targetObjectiveCount : parseInt(targetObjectiveCount.toString()) || 6;
    
    if (count < 1 || count > 20) {
      alert('Please enter a number between 1 and 20 for learning objectives.');
      return;
    }

    try {
      await dispatch(generateObjectives({ 
        quizId, 
        materialIds: assignedMaterials, 
        targetCount: count 
      }));
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
    try {
      // If using Redux objectives, delete via Redux
      if (reduxObjectives.length > 0 && reduxObjectives[index]) {
        const objectiveId = reduxObjectives[index]._id;
        
        // If user has chosen "don't show again", delete directly with confirmation
        if (dontShowDeleteWarning) {
          await dispatch(deleteObjective({ id: objectiveId, confirmed: true })).unwrap();
          
          // After deletion, update parent component with remaining objectives
          const remainingObjectives = reduxObjectives
            .filter((_, i) => i !== index)
            .map(obj => obj.text);
          onObjectivesChange(remainingObjectives);
          return;
        }
        
        // Otherwise, try to delete (will get confirmation requirement if there are questions)
        const result = await dispatch(deleteObjective({ id: objectiveId, confirmed: false }));
        
        // Check if confirmation is required
        if (result.type === 'learningObjective/deleteObjective/rejected' && result.payload) {
          const payload = result.payload as any;
          if (payload.requiresConfirmation) {
            // Show confirmation dialog
            setDeleteConfirmation({
              show: true,
              index,
              objectiveId: payload.objectiveId,
              questionCount: payload.questionCount
            });
            return;
          }
        }
        
        // If no confirmation needed, update parent component
        const remainingObjectives = reduxObjectives
          .filter((_, i) => i !== index)
          .map(obj => obj.text);
        onObjectivesChange(remainingObjectives);
      } else {
        // Otherwise, delete from local state and save to backend
        const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
        const objectivesData = updatedObjectives.map((text, i) => ({ text, order: i }));
        await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        onObjectivesChange(updatedObjectives);
      }
    } catch (error) {
      console.error('Failed to delete objective:', error);
      // Fallback to local state only
      const updatedObjectives = currentObjectives.filter((_, i) => i !== index);
      onObjectivesChange(updatedObjectives);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmation) return;
    
    try {
      // Delete with confirmation
      await dispatch(deleteObjective({ 
        id: deleteConfirmation.objectiveId, 
        confirmed: true 
      })).unwrap();
      
      // Update parent component
      const remainingObjectives = reduxObjectives
        .filter((_, i) => i !== deleteConfirmation.index)
        .map(obj => obj.text);
      onObjectivesChange(remainingObjectives);
      
      // Close dialog
      setDeleteConfirmation(null);
    } catch (error) {
      console.error('Failed to delete objective:', error);
      setDeleteConfirmation(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const handleDontShowAgainChange = (checked: boolean) => {
    setDontShowDeleteWarning(checked);
    localStorage.setItem('dontShowDeleteLOWarning', checked.toString());
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
    {
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
  };

  const openRegenerateModal = (index: number) => {
    if (!assignedMaterials || assignedMaterials.length === 0) {
      alert('Please assign materials to this quiz first to regenerate learning objectives.');
      return;
    }

    const currentObjective = currentObjectives[index];
    setObjectiveToRegenerate({ index, text: currentObjective });
    setRegenerateModalOpen(true);
  };

  const handleRegenerateSingle = async (customPrompt?: string) => {
    if (!objectiveToRegenerate) return;

    const { index } = objectiveToRegenerate;
    setRegenerateLoading(true);

    try {
      // If using Redux objectives, regenerate via Redux action
      if (reduxObjectives.length > 0 && reduxObjectives[index]) {
        const objectiveId = reduxObjectives[index]._id;
        await dispatch(regenerateSingleObjective({
          id: objectiveId,
          customPrompt: customPrompt?.trim() || undefined
        }));
      } else {
        // Fallback: regenerate all and take first result (for local state objectives)
        const generatedObjectives = await dispatch(generateObjectives({ quizId, materialIds: assignedMaterials, targetCount: 1 }));

        if (generatedObjectives.payload && Array.isArray(generatedObjectives.payload) && generatedObjectives.payload.length > 0) {
          const updatedObjectives = [...currentObjectives];
          updatedObjectives[index] = generatedObjectives.payload[0].text;

          const objectivesData = updatedObjectives.map((text: string, i: number) => ({ text, order: i }));
          await dispatch(saveObjectives({ quizId, objectives: objectivesData }));
        }
      }

      setRegenerateModalOpen(false);
      setObjectiveToRegenerate(null);
    } catch (error) {
      console.error('Failed to regenerate objective:', error);
      alert('Failed to regenerate the learning objective. Please try again.');
    } finally {
      setRegenerateLoading(false);
    }
  };

  const closeRegenerateModal = () => {
    setRegenerateModalOpen(false);
    setObjectiveToRegenerate(null);
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
                            
                            <div className="objective-count-input">
                              <label htmlFor="objectiveCount" className="input-label">
                                Number of learning objectives to generate:
                              </label>
                              <input
                                id="objectiveCount"
                                type="number"
                                min="1"
                                max="20"
                                value={targetObjectiveCount}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === '') {
                                    setTargetObjectiveCount('');
                                  } else {
                                    const numValue = parseInt(value);
                                    if (!isNaN(numValue)) {
                                      setTargetObjectiveCount(numValue);
                                    }
                                  }
                                }}
                                className="input number-input"
                                placeholder="Enter number (e.g., 6)"
                              />
                              <small className="input-hint">
                                Enter a number between 1 and 20 (default: 6)
                              </small>
                            </div>

                            <button 
                              className="btn btn-primary" 
                              onClick={handleGenerateObjectives}
                              disabled={
                                targetObjectiveCount === '' || 
                                (typeof targetObjectiveCount === 'number' && (targetObjectiveCount < 1 || targetObjectiveCount > 20))
                              }
                            >
                              <Sparkles size={16} />
                              {targetObjectiveCount === '' ? 
                                'Generate Learning Objectives' : 
                                `Generate ${targetObjectiveCount} Learning Objective${targetObjectiveCount !== 1 ? 's' : ''}`
                              }
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
                                  <button className="btn btn-ghost" onClick={() => openRegenerateModal(index)}>
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
              className={`tab-navigation ${currentObjectives.length > 0 ? 'nav-visible' : 'nav-hidden'}`}
            >
              <div className="nav-content">
                <div className="nav-info">
                  <h4>Learning Objectives Set</h4>
                  <p>You have defined {currentObjectives.length} learning objective{currentObjectives.length !== 1 ? 's' : ''} for this quiz.</p>
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

        {/* Regenerate Prompt Modal */}
        {objectiveToRegenerate && (
          <RegeneratePromptModal
            isOpen={regenerateModalOpen}
            onClose={closeRegenerateModal}
            onRegenerate={handleRegenerateSingle}
            question={{
              _id: reduxObjectives[objectiveToRegenerate.index]?._id || '',
              type: 'learning-objective',
              questionText: objectiveToRegenerate.text,
              learningObjective: {
                text: objectiveToRegenerate.text
              }
            }}
            isLoading={regenerateLoading}
            mode="learning-objective"
          />
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmation?.show && (
          <div className="modal-overlay" onClick={handleCancelDelete}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Delete Learning Objective?</h3>
                <button className="btn-close" onClick={handleCancelDelete}>
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body">
                <p>
                  This Learning Objective has <strong>{deleteConfirmation.questionCount}</strong> question(s) associated with it.
                </p>
                <p>
                  Deleting this Learning Objective will also <strong>permanently delete all {deleteConfirmation.questionCount} question(s)</strong>.
                </p>
                <p style={{ marginTop: '16px' }}>
                  Are you sure you want to continue?
                </p>
                <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    id="dontShowAgain"
                    checked={dontShowDeleteWarning}
                    onChange={(e) => handleDontShowAgainChange(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <label htmlFor="dontShowAgain" style={{ cursor: 'pointer', fontSize: '14px' }}>
                    Don't show this warning again
                  </label>
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={handleCancelDelete}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleConfirmDelete}>
                  Delete Learning Objective and {deleteConfirmation.questionCount} Question(s)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
};

export default LearningObjectives;