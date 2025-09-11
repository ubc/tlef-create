import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Wand2, Settings, Zap, Gamepad2, GraduationCap, CheckCircle, Edit } from 'lucide-react';
import { RootState, AppDispatch } from '../store';
import { generatePlan, fetchPlans, approvePlan, setCurrentPlan } from '../store/slices/planSlice';
import { questionsApi, Question } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import AdvancedEditModal from './AdvancedEditModal';
import '../styles/components/QuestionGeneration.css';

interface QuestionGenerationProps {
  learningObjectives: string[];
  assignedMaterials: string[];
  quizId: string;
  onQuestionsGenerated?: () => void;
}

type PedagogicalApproach = 'support' | 'assess' | 'gamify' | 'custom';

interface QuestionTypeConfig {
  type: string;
  count: number;
  percentage: number;
  scope: 'per-lo' | 'whole-quiz'; // New: scope for each question type
  editMode: 'count' | 'percentage'; // New: editing mode
}

interface CustomFormula {
  questionTypes: QuestionTypeConfig[];
  totalQuestions: number;
  totalPerLO: number; // Questions per LO
  totalWholeQuiz: number; // Additional questions for whole quiz
}

const QuestionGeneration = ({ learningObjectives, assignedMaterials, quizId, onQuestionsGenerated }: QuestionGenerationProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentPlan, activePlan, loading, generating, error } = useSelector((state: RootState) => state.plan);
  const { showNotification } = usePubSub('QuestionGeneration');
  
  // Question generation state management
  const [approach, setApproach] = useState<PedagogicalApproach>('support');
  const [questionsPerLO, setQuestionsPerLO] = useState(3);
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);
  const [isUserEditingApproach, setIsUserEditingApproach] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [hasExistingQuestions, setHasExistingQuestions] = useState(false);
  const [customFormula, setCustomFormula] = useState<CustomFormula>(() => {
    // Initialize with default support approach distribution
    return {
      questionTypes: [
        { type: 'multiple-choice', count: 1, percentage: 35, scope: 'per-lo', editMode: 'count' },
        { type: 'true-false', count: 1, percentage: 20, scope: 'per-lo', editMode: 'count' },
        { type: 'flashcard', count: 1, percentage: 25, scope: 'per-lo', editMode: 'count' },
        { type: 'discussion', count: 0, percentage: 10, scope: 'per-lo', editMode: 'count' },
        { type: 'summary', count: 0, percentage: 10, scope: 'per-lo', editMode: 'count' }
      ],
      totalQuestions: 3,
      totalPerLO: 3,
      totalWholeQuiz: 0
    };
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalJustSaved, setModalJustSaved] = useState(false);

  // Load existing plans and restore quiz-specific settings when component mounts
  useEffect(() => {
    if (quizId) {
      dispatch(fetchPlans(quizId));
      // Restore quiz-specific settings from localStorage
      restoreQuizSettings(quizId);
      // Load existing questions if any
      loadExistingQuestions(quizId);
    }
  }, [quizId, dispatch]);

  // Load existing questions for the quiz
  const loadExistingQuestions = async (quizId: string) => {
    try {
      const result = await questionsApi.getQuestions(quizId);
      if (result.questions.length > 0) {
        console.log('📝 Loaded existing questions:', result.questions.length);
        setQuestions(result.questions);
        setHasExistingQuestions(true);
        // Questions loaded successfully
      } else {
        setHasExistingQuestions(false);
      }
    } catch (error) {
      console.error('Failed to load existing questions:', error);
      setHasExistingQuestions(false);
    }
  };

  // Save quiz-specific settings to localStorage
  const saveQuizSettings = (quizId: string) => {
    const settings = {
      approach,
      questionsPerLO,
      showAdvancedEdit,
      customFormula,
      timestamp: Date.now()
    };
    localStorage.setItem(`quiz-settings-${quizId}`, JSON.stringify(settings));
    console.log('💾 Saved quiz settings for:', quizId, settings);
  };


  // Helper function for prompt analysis
  const getPromptAnalysis = () => {
    const methodUsage = questions.reduce((acc, question) => {
      const metadata = question.generationMetadata;
      const method = metadata?.generationMethod || 'template-based';
      acc[method] = (acc[method] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const promptsByLO = learningObjectives.map((lo) => {
      const loQuestions = questions.filter(q => {
        const loText = typeof q.learningObjective === 'string' ? q.learningObjective : (q.learningObjective as any)?.text;
        return loText === lo;
      });
      
      return {
        objective: lo.substring(0, 50) + (lo.length > 50 ? '...' : ''),
        questionCount: loQuestions.length,
        prompts: loQuestions.map(q => ({
          questionNumber: q.order + 1,
          type: q.type,
          prompt: q.generationMetadata?.generationPrompt || `Generate ${q.type} question for: ${lo}`,
          subObjective: q.generationMetadata?.subObjective || 'General knowledge application',
          focusArea: q.generationMetadata?.focusArea || 'general knowledge',
          complexity: q.generationMetadata?.complexity || 'medium',
          method: q.generationMetadata?.generationMethod || 'template-based'
        }))
      };
    });

    return { methodUsage, promptsByLO };
  };

  // Restore quiz-specific settings from localStorage
  const restoreQuizSettings = (quizId: string) => {
    try {
      const saved = localStorage.getItem(`quiz-settings-${quizId}`);
      if (saved) {
        const settings = JSON.parse(saved);
        console.log('🔄 Restoring quiz settings from localStorage for:', quizId, settings);
        
        // Only restore if settings are recent (within 24 hours)
        const isRecent = Date.now() - settings.timestamp < 24 * 60 * 60 * 1000;
        if (isRecent) {
          // Set a flag to prevent the restoration from being overridden immediately
          setIsUserEditingApproach(true);
          
          setApproach(settings.approach || 'support');
          setQuestionsPerLO(settings.questionsPerLO || 3);
          setShowAdvancedEdit(settings.showAdvancedEdit || false);
          if (settings.customFormula) {
            setCustomFormula(settings.customFormula);
          }
          
          // Reset the flag after restoration is complete
          setTimeout(() => setIsUserEditingApproach(false), 200);
        }
      }
    } catch (error) {
      console.error('Failed to restore quiz settings:', error);
    }
  };

  // Restore custom formula when currentPlan changes
  // Database plan takes priority over localStorage settings
  useEffect(() => {
    if (currentPlan && currentPlan.customFormula && !isUserEditingApproach) {
      console.log('🔄 Restoring custom formula from database plan:', currentPlan.customFormula);
      setCustomFormula({
        questionTypes: currentPlan.customFormula.questionTypes || [],
        totalQuestions: currentPlan.customFormula.totalQuestions || 3,
        totalPerLO: currentPlan.customFormula.totalPerLO || 3,
        totalWholeQuiz: currentPlan.customFormula.totalWholeQuiz || 0
      });
      
      // Set the approach and questionsPerLO from the plan  
      setApproach(currentPlan.approach);
      setQuestionsPerLO(currentPlan.questionsPerLO);
      
      // Show advanced edit if custom formula exists
      if (currentPlan.customFormula.questionTypes && currentPlan.customFormula.questionTypes.length > 0) {
        setShowAdvancedEdit(true);
      }
      
      // Update localStorage with the plan data to keep them in sync
      saveQuizSettings(quizId);
    } else if (isUserEditingApproach) {
      console.log('⏭️ Skipping plan restoration - user is editing approach');
    }
  }, [currentPlan, isUserEditingApproach, quizId]);


  const pedagogicalApproaches = [
    {
      id: 'support' as PedagogicalApproach,
      title: 'Support Learning',
      description: 'Flashcards and summaries to help students memorize and understand',
      icon: GraduationCap,
    },
    {
      id: 'assess' as PedagogicalApproach,
      title: 'Assess Learning', 
      description: 'Classic assessment questions to test student comprehension',
      icon: Zap,
    },
    {
      id: 'gamify' as PedagogicalApproach,
      title: 'Gamify Learning',
      description: 'Interactive and engaging questions to make learning fun',
      icon: Gamepad2,
    },
    {
      id: 'custom' as PedagogicalApproach,
      title: 'Custom Formula',
      description: 'Define your own mix of question types and quantities',
      icon: Settings,
    }
  ];

  // Plan generation handlers
  const handleGeneratePlan = async () => {
    try {
      const effectiveQuestionsPerLO = approach === 'custom' ? customFormula.totalPerLO : questionsPerLO;
      
      // Prepare the plan generation data
      const planData: any = {
        quizId,
        approach,
        questionsPerLO: effectiveQuestionsPerLO
      };
      
      // Add custom formula for advanced settings
      if (approach === 'custom' || showAdvancedEdit) {
        planData.customFormula = {
          questionTypes: customFormula.questionTypes,
          totalPerLO: customFormula.totalPerLO,
          totalWholeQuiz: customFormula.totalWholeQuiz,
          totalQuestions: (learningObjectives.length * customFormula.totalPerLO) + customFormula.totalWholeQuiz
        };
      }
      
      // Save current settings before generating plan
      saveQuizSettings(quizId);
      
      // Reset user editing flag before generating plan
      setIsUserEditingApproach(false);
      
      await dispatch(generatePlan(planData));
      showNotification('success', 'Plan Generated', 'Generation plan created successfully with your custom settings');
    } catch (error) {
      console.error('Failed to generate plan:', error);
      showNotification('error', 'Plan Generation Failed', 'Failed to generate plan');
    }
  };

  // Delete existing questions before regeneration
  const handleDeleteExistingQuestions = async () => {
    try {
      console.log('🗑️ Deleting existing questions before regeneration...');
      const result = await questionsApi.deleteAllQuestions(quizId);
      console.log(`✅ Deleted ${result.deletedCount} existing questions`);
      
      // Clear local questions state
      setQuestions([]);
      setHasExistingQuestions(false);
      
      return result.deletedCount;
    } catch (error) {
      console.error('Failed to delete existing questions:', error);
      throw error;
    }
  };

  // Reset plan to allow user to change approach and regenerate
  const handleGoBackToPlan = () => {
    // Reset the plan state to show plan generation UI again
    dispatch(setCurrentPlan(null));
    
    // Clear questions to ensure we go back to plan phase
    setQuestions([]);
    setHasExistingQuestions(false);
    
    // Enable user editing mode
    setIsUserEditingApproach(true);
    
    showNotification('info', 'Plan Reset', 'You can now modify your approach and generate a new plan.');
  };

  const handleGenerateQuestions = async (isRegeneration = false) => {
    if (!currentPlan) return;
    
    try {
      setIsRegenerating(isRegeneration);
      
      // Delete existing questions if this is a regeneration
      if (isRegeneration && hasExistingQuestions) {
        await handleDeleteExistingQuestions();
        showNotification('info', 'Questions Deleted', 'Previous questions deleted. Generating new ones...');
      }
      
      // First approve the plan
      await dispatch(approvePlan(currentPlan._id));
      console.log('✅ Plan approved, starting question generation');
      
      // Show generating state while maintaining plan phase
      showNotification('info', 'Generating Questions', 'AI is generating questions based on your plan...');
      
      // Small delay to ensure database is updated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Call the question generation API
      const result = await questionsApi.generateFromPlan(quizId);
      console.log('🎉 Questions generated successfully:', result);
      
      // Store the generated questions
      setQuestions(result.questions);
      setHasExistingQuestions(result.questions.length > 0);
      
      const message = isRegeneration 
        ? `Successfully regenerated ${result.questions.length} questions with new approach!`
        : `Successfully generated ${result.questions.length} questions!`;
      
      showNotification('success', 'Questions Generated', message);
      
      // Redirect to Review & Edit page after generation
      if (onQuestionsGenerated) {
        // Small delay to allow notification to show
        setTimeout(() => {
          onQuestionsGenerated();
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to generate questions:', error);
      const errorMessage = isRegeneration 
        ? 'Failed to regenerate questions'
        : 'Failed to generate questions';
      showNotification('error', 'Question Generation Failed', errorMessage);
    } finally {
      setIsRegenerating(false);
    }
  };




  // Advanced settings handlers - moved to modal component

  // Get approach-specific question type distribution (matches backend)
  const getApproachDistribution = (approach: PedagogicalApproach, questionsPerLO: number) => {
    const distributions = {
      'support': {
        'multiple-choice': 35,
        'true-false': 20,
        'flashcard': 25,
        'discussion': 10,
        'summary': 10
      },
      'assess': {
        'multiple-choice': 50,
        'true-false': 20,
        'discussion': 20,
        'summary': 10
      },
      'gamify': {
        'matching': 30,
        'ordering': 25,
        'multiple-choice': 25,
        'flashcard': 20
      },
      'custom': {
        'multiple-choice': 35,
        'true-false': 15,
        'flashcard': 15,
        'discussion': 15,
        'summary': 10,
        'matching': 10
      }
    };

    const dist = distributions[approach] || distributions['support'];
    const questionTypes = [];
    
    Object.entries(dist).forEach(([type, percentage]) => {
      const count = Math.round((percentage / 100) * questionsPerLO);
      if (count > 0) {
        questionTypes.push({
          type,
          count,
          percentage,
          scope: 'per-lo' as const,
          editMode: 'count' as const
        });
      }
    });

    return {
      questionTypes,
      totalQuestions: questionsPerLO,
      totalPerLO: questionsPerLO,
      totalWholeQuiz: 0
    };
  };

  // Update custom formula when questionsPerLO or approach changes
  // But only if we don't have a current plan with existing custom formula AND user is not being restored
  useEffect(() => {
    console.log('🔄 Approach changed to:', approach, 'questionsPerLO:', questionsPerLO);
    console.log('🔄 Current plan exists:', !!currentPlan, 'has customFormula:', !!(currentPlan && currentPlan.customFormula));
    console.log('🔄 isUserEditingApproach:', isUserEditingApproach, 'modalJustSaved:', modalJustSaved);
    
    // Skip if modal was just saved to prevent overriding user changes
    if (modalJustSaved) {
      console.log('⏭️ Skipping formula update - modal was just saved');
      return;
    }
    
    // Skip if we have a current plan that should restore its own data, UNLESS user is actively editing
    if (currentPlan && currentPlan.customFormula && !isUserEditingApproach) {
      console.log('⏭️ Skipping formula update - using current plan data');
      return;
    }
    
    if (approach === 'custom') {
      const totalPerLO = customFormula.questionTypes.filter(qt => qt.scope === 'per-lo').reduce((sum, qt) => sum + qt.count, 0);
      setQuestionsPerLO(totalPerLO);
    } else {
      // Use approach-specific distribution (matches backend logic)
      console.log('🎯 Setting approach-specific distribution for:', approach);
      const newFormula = getApproachDistribution(approach, questionsPerLO);
      console.log('🎯 New formula:', newFormula);
      setCustomFormula(newFormula);
    }
  }, [approach, questionsPerLO, currentPlan, isUserEditingApproach, modalJustSaved]);

  // Debug advanced edit visibility
  useEffect(() => {
    console.log('🔍 Advanced edit visibility check:', {
      approach,
      showAdvancedEdit,
      shouldShow: approach === 'custom' || showAdvancedEdit,
      customFormula
    });
  }, [approach, showAdvancedEdit, customFormula]);

  // Auto-save settings when they change (but not during initial load/restoration)
  useEffect(() => {
    // Skip saving during initial component mount and plan restoration
    if (!quizId || isUserEditingApproach) return;
    
    // Add small delay to avoid saving during rapid state changes
    const timeoutId = setTimeout(() => {
      saveQuizSettings(quizId);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [approach, questionsPerLO, showAdvancedEdit, customFormula, quizId, isUserEditingApproach]);

  if (learningObjectives.length === 0) {
    return (
      <div className="question-generation">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Generate Questions</h3>
            <p className="card-description">
              Please set learning objectives first before generating questions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="question-generation">
      {/* Phase indicator */}
      <div className="phase-progress">
        <div className="phase-steps">
          <div className={`phase-step ${questions.length === 0 ? 'active' : 'completed'}`}>
            <div className="step-indicator">
              <div className="step-number">1</div>
              {activePlan && <CheckCircle className="step-check" size={16} />}
            </div>
            <div className="step-content">
              <div className="step-title">Plan Generation</div>
            </div>
          </div>
          
          <div className="phase-connector">
            <div className={`connector-line ${questions.length > 0 ? 'completed' : ''}`}></div>
          </div>
          
          <div className={`phase-step ${questions.length > 0 ? 'active' : ''}`}>
            <div className="step-indicator">
              <div className="step-number">2</div>
              {questions.length > 0 && <CheckCircle className="step-check" size={16} />}
            </div>
            <div className="step-content">
              <div className="step-title">Question Generation</div>
            </div>
          </div>
        </div>
      </div>

      {questions.length === 0 ? (
        // Phase 1: Plan Generation & Review
        <div className="plan-phase">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Generation Plan</h3>
              <p className="card-description">
                Configure how questions will be generated based on your learning objectives and pedagogical approach
              </p>
            </div>

            {/* Approach Selection */}
            <div className="pedagogical-approaches">
              <h4>Choose Pedagogical Approach</h4>
              <div className="approaches-grid">
                {pedagogicalApproaches.map((app) => (
                  <div
                    key={app.id}
                    className={`approach-card ${approach === app.id ? 'selected' : ''}`}
                    onClick={() => {
                      console.log('🎯 Approach selected:', app.id);
                      setIsUserEditingApproach(true);
                      setApproach(app.id);
                      
                      // If Custom Formula is selected, automatically open the modal
                      if (app.id === 'custom') {
                        setTimeout(() => {
                          setIsModalOpen(true);
                        }, 150); // Small delay to allow approach to be set first
                      }
                      
                      // Reset the flag after a short delay to allow approach change to process
                      setTimeout(() => setIsUserEditingApproach(false), 100);
                    }}
                  >
                    <app.icon size={24} />
                    <h5>{app.title}</h5>
                    <p>{app.description}</p>
                    {app.id !== 'custom' && approach === app.id && (
                      <button
                        className="btn btn-outline btn-sm advanced-edit-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('🔧 Advanced Edit clicked for approach:', approach);
                          setIsUserEditingApproach(true);
                          setIsModalOpen(true);
                        }}
                      >
                        <Edit size={14} />
                        Advanced Edit
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Settings */}
            {approach !== 'custom' && (
              <div className="generation-settings">
                <div className="setting-group">
                  <label>Questions per Learning Objective: {questionsPerLO}</label>
                  <div className="questions-counter">
                    <button
                      className="btn btn-outline counter-btn"
                      onClick={() => setQuestionsPerLO(Math.max(1, questionsPerLO - 1))}
                    >
                      -
                    </button>
                    <span className="counter-value">{questionsPerLO}</span>
                    <button
                      className="btn btn-outline counter-btn"
                      onClick={() => setQuestionsPerLO(Math.min(10, questionsPerLO + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div className="setting-group">
                  <label>Total Questions: {learningObjectives.length * questionsPerLO}</label>
                  <p className="setting-description">
                    Based on {learningObjectives.length} learning objectives
                  </p>
                </div>
              </div>
            )}

            {approach === 'custom' && (
              <div className="generation-settings">
                <div className="setting-group">
                  <label>Custom Formula Configuration</label>
                  <p className="setting-description">
                    Configure question types and quantities using the advanced editor below.
                  </p>
                </div>
                <div className="setting-group">
                  <label>Total Questions: {learningObjectives.length * customFormula.totalQuestions}</label>
                  <p className="setting-description">
                    {customFormula.totalQuestions} questions per learning objective × {learningObjectives.length} objectives
                  </p>
                </div>
              </div>
            )}

            {/* Advanced Edit Modal */}
            <AdvancedEditModal
              isOpen={isModalOpen}
              onClose={() => {
                setIsModalOpen(false);
                setIsUserEditingApproach(false);
                // Clear the flag after a delay to prevent overriding
                setTimeout(() => setModalJustSaved(false), 100);
              }}
              customFormula={customFormula}
              onFormulaChange={(newFormula) => {
                console.log('🔄 Formula changed in modal:', newFormula);
                setCustomFormula(newFormula);
                // Update questionsPerLO to match the formula's totalPerLO
                setQuestionsPerLO(newFormula.totalPerLO);
                // Enable showAdvancedEdit to indicate custom settings are active
                if (approach !== 'custom') {
                  setShowAdvancedEdit(true);
                }
              }}
              approach={approach}
              learningObjectivesCount={learningObjectives.length}
              onSave={() => {
                console.log('💾 Saving advanced edit changes');
                setModalJustSaved(true);
                saveQuizSettings(quizId);
                setIsUserEditingApproach(false);
              }}
            />

            {/* Generate Plan Button */}
            <div className="plan-action">
              <button
                className="btn btn-primary"
                onClick={handleGeneratePlan}
                disabled={generating || learningObjectives.length === 0 || assignedMaterials.length === 0}
              >
                {generating ? (
                  <>
                    <div className="loading-spinner"></div>
                    Generating Plan...
                  </>
                ) : (
                  <>
                    <Wand2 size={16} />
                    Generate Plan
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Plan Review */}
          {currentPlan && (
            <div className="card">
              <div className="card-header">
                <div className="card-header-content">
                  <div>
                    <h3 className="card-title">Plan Review</h3>
                    <p className="card-description">
                      Review the generated plan and approve it to proceed with question generation
                    </p>
                  </div>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleGoBackToPlan}
                    disabled={loading || isRegenerating}
                  >
                    <Settings size={16} />
                    Change Approach
                  </button>
                </div>
              </div>

              <div className="plan-summary">
                {/* Plan Overview Cards */}
                <div className="plan-overview">
                  <div className="overview-card">
                    <div className="overview-label">Approach</div>
                    <div className="overview-value">{currentPlan.approach}</div>
                  </div>
                  <div className="overview-card">
                    <div className="overview-label">Questions per LO</div>
                    <div className="overview-value">{currentPlan.questionsPerLO}</div>
                  </div>
                  <div className="overview-card">
                    <div className="overview-label">Total Questions</div>
                    <div className="overview-value">{currentPlan.totalQuestions}</div>
                  </div>
                </div>

                {/* Question Type Distribution */}
                <div className="plan-section-card">
                  <div className="section-header">
                    <h4 className="section-title">Question Type Distribution</h4>
                  </div>
                  <div className="distribution-grid">
                    {currentPlan.distribution.map((dist, index) => (
                      <div key={index} className="distribution-item-card">
                        <div className="distribution-header">
                          <span className="question-type-label">{dist.type.replace('-', ' ')}</span>
                          <span className="question-percentage">{dist.percentage}%</span>
                        </div>
                        <div className="question-count-large">{dist.totalCount}</div>
                        <div className="question-count-label">questions</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Breakdown by Learning Objective */}
                <div className="plan-section-card">
                  <div className="section-header">
                    <h4 className="section-title">Breakdown by Learning Objective</h4>
                  </div>
                  <div className="breakdown-grid">
                    {currentPlan.breakdown.map((item, index) => (
                      <div key={index} className="breakdown-item-card">
                        <div className="lo-header">
                          <div className="lo-number">LO {index + 1}</div>
                        </div>
                        <div className="lo-text">
                          {typeof item.learningObjective === 'string' 
                            ? learningObjectives[index] 
                            : item.learningObjective.text}
                        </div>
                        <div className="lo-question-types">
                          {item.questionTypes.map((qt, qtIndex) => (
                            <div key={qtIndex} className="question-type-badge">
                              <span className="question-count-badge">{qt.count}</span>
                              <span className="question-type-name">{qt.type.replace('-', ' ')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="plan-actions">
                <button
                  className="btn btn-secondary btn-lg"
                  onClick={handleGoBackToPlan}
                  disabled={loading || isRegenerating}
                >
                  <Settings size={18} />
                  Change Approach & Regenerate Plan
                </button>
                
                {hasExistingQuestions && (
                  <button
                    className="btn btn-warning"
                    onClick={() => handleGenerateQuestions(true)}
                    disabled={loading || isRegenerating}
                  >
                    <Wand2 size={16} />
                    Regenerate Questions
                  </button>
                )}
                
                <button
                  className="btn btn-primary"
                  onClick={() => handleGenerateQuestions(false)}
                  disabled={loading || isRegenerating}
                >
                  <Wand2 size={16} />
                  {hasExistingQuestions ? 'Add More Questions' : 'Generate Questions'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Show Generated Questions Directly (No intermediate page)
        <div className="questions-container">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Questions Generated Successfully!</h3>
              <p className="card-description">
                Your quiz has been generated with {questions.length} questions. Review the summary below.
              </p>
            </div>
            

            {/* Prompt Analysis Section */}
            <div className="prompt-analysis">
              <h4>Generation Prompt Analysis</h4>
              <p>See exactly how each question was generated and what prompts were used:</p>
              
              <div className="prompt-tabs">
                <div className="prompt-tab-content">
                  <div className="prompts-by-lo">
                    {getPromptAnalysis().promptsByLO.map((loData, index) => (
                      <div key={index} className="lo-prompt-group">
                        <div className="lo-header">
                          <span className="lo-title">LO {index + 1}: {loData.objective}</span>
                          <span className="lo-count">{loData.questionCount} questions</span>
                        </div>
                        <div className="prompt-list">
                          {loData.prompts.map((promptData, pIndex) => (
                            <div key={pIndex} className="prompt-item">
                              <div className="prompt-header">
                                <span className="prompt-question">Q{promptData.questionNumber}</span>
                                <span className="prompt-type">{promptData.type.replace('-', ' ')}</span>
                                <span className="prompt-method">{promptData.method}</span>
                                <span className={`complexity-badge ${promptData.complexity}`}>{promptData.complexity}</span>
                              </div>
                              <div className="sub-objective">
                                <strong>Sub-Learning Objective:</strong> {promptData.subObjective}
                              </div>
                              <div className="focus-area">
                                <strong>Focus Area:</strong> <span className="focus-tag">{promptData.focusArea}</span>
                              </div>
                              <div className="prompt-text">
                                <strong>Detailed AI Prompt:</strong> {promptData.prompt}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="generation-summary">
                <h5>AI Generation Method Summary</h5>
                <div className="method-stats">
                  {Object.entries(getPromptAnalysis().methodUsage).map(([method, count]) => (
                    <div key={method} className="method-stat">
                      <span className="method-name">{method.replace('-', ' → ')}</span>
                      <span className="method-count">{count} questions</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="prompt-analysis-actions">
                <button
                  className="btn btn-secondary"
                  onClick={handleGoBackToPlan}
                  disabled={loading || isRegenerating}
                >
                  <Settings size={16} />
                  Change Approach & Regenerate
                </button>
                
                {hasExistingQuestions && (
                  <button
                    className="btn btn-warning"
                    onClick={() => handleGenerateQuestions(true)}
                    disabled={loading || isRegenerating}
                  >
                    <Wand2 size={16} />
                    Regenerate with Same Plan
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="card error-card">
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        </div>
      )}
    </div>
  );
};



export default QuestionGeneration;