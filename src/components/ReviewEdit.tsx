import { useState, useEffect } from 'react';
import { Edit, Trash2, Plus, Eye, EyeOff, Save, RotateCcw, Wand2, Play, Download } from 'lucide-react';
import { questionsApi, Question, exportApi } from '../services/api';
import { usePubSub } from '../hooks/usePubSub';
import '../styles/components/ReviewEdit.css';
import '../styles/components/InteractiveQuestions.css';

interface ReviewEditProps {
  quizId: string;
  learningObjectives: string[];
}

interface ExtendedQuestion extends Question {
  isEditing?: boolean;
}

const ReviewEdit = ({ quizId, learningObjectives }: ReviewEditProps) => {
  const [questions, setQuestions] = useState<ExtendedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const { showNotification } = usePubSub('ReviewEdit');

  const [viewMode, setViewMode] = useState<'edit' | 'interact'>('edit');
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [filterByLO, setFilterByLO] = useState<number | null>(null);
  const [newQuestion, setNewQuestion] = useState({
    type: 'multiple-choice',
    difficulty: 'moderate',
    question: '',
    answer: '',
    correctAnswer: '',
    loIndex: 0
  });
  
  // State for expandable bullet points in summary questions
  const [expandedBulletPoints, setExpandedBulletPoints] = useState<{[questionId: string]: {[bulletIndex: number]: boolean}}>({});

  // Toggle expanded state for bullet points
  const toggleBulletPoint = (questionId: string, bulletIndex: number) => {
    setExpandedBulletPoints(prev => ({
      ...prev,
      [questionId]: {
        ...prev[questionId],
        [bulletIndex]: !prev[questionId]?.[bulletIndex]
      }
    }));
  };

  // Load questions from database
  useEffect(() => {
    loadQuestions();
  }, [quizId]);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      const result = await questionsApi.getQuestions(quizId);
      console.log('📝 Loaded questions for review:', result.questions.length);
      setQuestions(result.questions.map(q => ({ ...q, isEditing: false })));
    } catch (error) {
      console.error('Failed to load questions:', error);
      showNotification('error', 'Load Failed', 'Failed to load questions for review');
    } finally {
      setLoading(false);
    }
  };

  const questionTypes = [
    { id: 'multiple-choice', label: 'Multiple Choice' },
    { id: 'true-false', label: 'True/False' },
    { id: 'flashcard', label: 'Flashcard' },
    { id: 'summary', label: 'Summary' },
    { id: 'discussion', label: 'Discussion' },
    { id: 'matching', label: 'Matching' },
    { id: 'ordering', label: 'Ordering' },
    { id: 'cloze', label: 'Cloze Test' }
  ];

  const filteredQuestions = filterByLO !== null
      ? questions.filter(q => {
          // Find the learning objective index by comparing text
          const loText = typeof q.learningObjective === 'string' ? q.learningObjective : (q.learningObjective as any)?.text;
          const targetLO = learningObjectives[filterByLO];
          return loText === targetLO;
        })
      : questions;

  const toggleEdit = (questionId: string) => {
    setQuestions(questions.map(q =>
        q._id === questionId ? { ...q, isEditing: !q.isEditing } : q
    ));
  };

  const deleteQuestion = async (questionId: string) => {
    try {
      await questionsApi.deleteQuestion(questionId);
      setQuestions(questions.filter(q => q._id !== questionId));
      showNotification('success', 'Question Deleted', 'Question has been removed');
    } catch (error) {
      console.error('Failed to delete question:', error);
      showNotification('error', 'Delete Failed', 'Failed to delete question');
    }
  };

  const updateQuestion = (questionId: string, field: keyof ExtendedQuestion, value: any) => {
    setQuestions(questions.map(q =>
        q._id === questionId ? { ...q, [field]: value } : q
    ));
  };

  // Multiple Choice specific editing functions
  const updateMultipleChoiceOption = (questionId: string, optionIndex: number, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.options) {
        const updatedOptions = [...q.content.options];
        updatedOptions[optionIndex] = { ...updatedOptions[optionIndex], text: newText };
        return {
          ...q,
          content: { ...q.content, options: updatedOptions }
        };
      }
      return q;
    }));
  };

  const updateMultipleChoiceCorrect = (questionId: string, correctIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.options) {
        const updatedOptions = q.content.options.map((option: any, index: number) => ({
          ...option,
          isCorrect: index === correctIndex
        }));
        
        // Also update the correctAnswer field to match
        const correctOption = updatedOptions[correctIndex];
        return {
          ...q,
          content: { ...q.content, options: updatedOptions },
          correctAnswer: correctOption.text
        };
      }
      return q;
    }));
  };

  const addMultipleChoiceOption = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.options) {
        const newOption = {
          text: '',
          isCorrect: false,
          order: q.content.options.length
        };
        const updatedOptions = [...q.content.options, newOption];
        return {
          ...q,
          content: { ...q.content, options: updatedOptions }
        };
      }
      return q;
    }));
  };

  const removeMultipleChoiceOption = (questionId: string, optionIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.options && q.content.options.length > 2) {
        const optionToRemove = q.content.options[optionIndex];
        const updatedOptions = q.content.options.filter((_: any, index: number) => index !== optionIndex);
        
        // If we're removing the correct answer, make the first option correct
        if (optionToRemove.isCorrect && updatedOptions.length > 0) {
          updatedOptions[0].isCorrect = true;
        }
        
        // Update order for remaining options
        updatedOptions.forEach((option: any, index: number) => {
          option.order = index;
        });
        
        // Update correctAnswer to match the new correct option
        const correctOption = updatedOptions.find((opt: any) => opt.isCorrect);
        
        return {
          ...q,
          content: { ...q.content, options: updatedOptions },
          correctAnswer: correctOption?.text || updatedOptions[0]?.text || ''
        };
      }
      return q;
    }));
  };

  // True/False specific editing function
  const updateTrueFalseAnswer = (questionId: string, answer: string) => {
    console.log('🔄 Updating T/F answer:', { questionId, answer });
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'true-false') {
        console.log('📝 Before update:', q.correctAnswer, 'After update:', answer);
        return {
          ...q,
          correctAnswer: answer
        };
      }
      return q;
    }));
  };

  // Matching question specific editing functions
  const updateMatchingLeftItem = (questionId: string, itemIndex: number, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.leftItems) {
        const updatedLeftItems = [...q.content.leftItems];
        updatedLeftItems[itemIndex] = newText;
        
        // Update matching pairs that reference this item
        const updatedMatchingPairs = q.content.matchingPairs?.map(pair => 
          pair[0] === q.content.leftItems[itemIndex] ? [newText, pair[1]] : pair
        ) || [];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            leftItems: updatedLeftItems,
            matchingPairs: updatedMatchingPairs
          }
        };
      }
      return q;
    }));
  };

  const updateMatchingRightItem = (questionId: string, itemIndex: number, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.rightItems) {
        const updatedRightItems = [...q.content.rightItems];
        updatedRightItems[itemIndex] = newText;
        
        // Update matching pairs that reference this item
        const updatedMatchingPairs = q.content.matchingPairs?.map(pair => 
          pair[1] === q.content.rightItems[itemIndex] ? [pair[0], newText] : pair
        ) || [];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            rightItems: updatedRightItems,
            matchingPairs: updatedMatchingPairs
          }
        };
      }
      return q;
    }));
  };

  const addMatchingLeftItem = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.leftItems) {
        const newItem = `New Item ${q.content.leftItems.length + 1}`;
        return {
          ...q,
          content: { 
            ...q.content, 
            leftItems: [...q.content.leftItems, newItem]
          }
        };
      }
      return q;
    }));
  };

  const addMatchingRightItem = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.rightItems) {
        const newItem = `New Answer ${q.content.rightItems.length + 1}`;
        return {
          ...q,
          content: { 
            ...q.content, 
            rightItems: [...q.content.rightItems, newItem]
          }
        };
      }
      return q;
    }));
  };

  const removeMatchingLeftItem = (questionId: string, itemIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.leftItems && q.content.leftItems.length > 2) {
        const itemToRemove = q.content.leftItems[itemIndex];
        const updatedLeftItems = q.content.leftItems.filter((_: string, index: number) => index !== itemIndex);
        
        // Remove matching pairs that reference this item
        const updatedMatchingPairs = q.content.matchingPairs?.filter(pair => pair[0] !== itemToRemove) || [];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            leftItems: updatedLeftItems,
            matchingPairs: updatedMatchingPairs
          }
        };
      }
      return q;
    }));
  };

  const removeMatchingRightItem = (questionId: string, itemIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.rightItems && q.content.rightItems.length > 2) {
        const itemToRemove = q.content.rightItems[itemIndex];
        const updatedRightItems = q.content.rightItems.filter((_: string, index: number) => index !== itemIndex);
        
        // Remove matching pairs that reference this item
        const updatedMatchingPairs = q.content.matchingPairs?.filter(pair => pair[1] !== itemToRemove) || [];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            rightItems: updatedRightItems,
            matchingPairs: updatedMatchingPairs
          }
        };
      }
      return q;
    }));
  };

  const updateMatchingPair = (questionId: string, pairIndex: number, itemIndex: number, newValue: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.matchingPairs) {
        const updatedPairs = [...q.content.matchingPairs];
        updatedPairs[pairIndex] = [...updatedPairs[pairIndex]];
        updatedPairs[pairIndex][itemIndex] = newValue;
        
        return {
          ...q,
          content: { 
            ...q.content, 
            matchingPairs: updatedPairs
          }
        };
      }
      return q;
    }));
  };

  const addMatchingPair = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.matchingPairs) {
        const newPair = ['', ''];
        return {
          ...q,
          content: { 
            ...q.content, 
            matchingPairs: [...q.content.matchingPairs, newPair]
          }
        };
      }
      return q;
    }));
  };

  const removeMatchingPair = (questionId: string, pairIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.matchingPairs && q.content.matchingPairs.length > 1) {
        const updatedPairs = q.content.matchingPairs.filter((_: string[], index: number) => index !== pairIndex);
        
        return {
          ...q,
          content: { 
            ...q.content, 
            matchingPairs: updatedPairs
          }
        };
      }
      return q;
    }));
  };

  // Ordering question specific editing functions
  const updateOrderingItem = (questionId: string, itemIndex: number, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.items) {
        const updatedItems = [...q.content.items];
        updatedItems[itemIndex] = newText;
        
        // Update correctOrder if it exists and references this item
        const updatedCorrectOrder = q.content.correctOrder?.map((item: string) => 
          item === q.content.items[itemIndex] ? newText : item
        ) || [...updatedItems];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            items: updatedItems,
            correctOrder: updatedCorrectOrder
          }
        };
      }
      return q;
    }));
  };

  const addOrderingItem = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.items) {
        const newItem = `New Item ${q.content.items.length + 1}`;
        const updatedItems = [...q.content.items, newItem];
        const updatedCorrectOrder = [...(q.content.correctOrder || q.content.items), newItem];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            items: updatedItems,
            correctOrder: updatedCorrectOrder
          }
        };
      }
      return q;
    }));
  };

  const removeOrderingItem = (questionId: string, itemIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.items && q.content.items.length > 2) {
        const itemToRemove = q.content.items[itemIndex];
        const updatedItems = q.content.items.filter((_: string, index: number) => index !== itemIndex);
        const updatedCorrectOrder = (q.content.correctOrder || q.content.items).filter((item: string) => item !== itemToRemove);
        
        return {
          ...q,
          content: { 
            ...q.content, 
            items: updatedItems,
            correctOrder: updatedCorrectOrder
          }
        };
      }
      return q;
    }));
  };

  const moveOrderingItem = (questionId: string, fromIndex: number, toIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.items) {
        const updatedItems = [...q.content.items];
        const [movedItem] = updatedItems.splice(fromIndex, 1);
        updatedItems.splice(toIndex, 0, movedItem);
        
        // Update correctOrder to match the new order
        const updatedCorrectOrder = [...updatedItems];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            items: updatedItems,
            correctOrder: updatedCorrectOrder
          }
        };
      }
      return q;
    }));
  };

  // Cloze question specific editing functions
  const updateClozeText = (questionId: string, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId) {
        // Count the number of $$ markers in the new text
        const blankCount = (newText.match(/\$\$/g) || []).length;
        const currentBlankOptions = q.content?.blankOptions || [];
        const currentCorrectAnswers = q.content?.correctAnswers || [];
        
        // If we have more blanks than options, add new ones
        let newBlankOptions = [...currentBlankOptions];
        let newCorrectAnswers = [...currentCorrectAnswers];
        
        while (newBlankOptions.length < blankCount) {
          newBlankOptions.push(['']);
          newCorrectAnswers.push('');
        }
        
        // If we have fewer blanks than options, remove excess ones
        if (newBlankOptions.length > blankCount) {
          newBlankOptions = newBlankOptions.slice(0, blankCount);
          newCorrectAnswers = newCorrectAnswers.slice(0, blankCount);
        }
        
        return {
          ...q,
          content: { 
            ...q.content, 
            textWithBlanks: newText,
            blankOptions: newBlankOptions,
            correctAnswers: newCorrectAnswers
          }
        };
      }
      return q;
    }));
  };

  const addClozeBlank = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId) {
        const currentText = q.content?.textWithBlanks || '';
        const newText = currentText + '$$';
        const newBlankOptions = [...(q.content?.blankOptions || []), ['']];
        const newCorrectAnswers = [...(q.content?.correctAnswers || []), ''];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            textWithBlanks: newText,
            blankOptions: newBlankOptions,
            correctAnswers: newCorrectAnswers
          }
        };
      }
      return q;
    }));
  };

  const removeClozeBlank = (questionId: string, blankIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.blankOptions && q.content.blankOptions.length > 1) {
        // Split text by blanks and remove the specified blank
        const textParts = q.content.textWithBlanks?.split('$$') || [];
        if (blankIndex < textParts.length - 1) {
          // Remove the blank by joining adjacent parts
          const newTextParts = [...textParts];
          newTextParts[blankIndex] = newTextParts[blankIndex] + newTextParts[blankIndex + 1];
          newTextParts.splice(blankIndex + 1, 1);
          const newText = newTextParts.join('$$');
          
          const newBlankOptions = q.content.blankOptions.filter((_: string[], index: number) => index !== blankIndex);
          const newCorrectAnswers = q.content.correctAnswers?.filter((_: string, index: number) => index !== blankIndex) || [];
          
          return {
            ...q,
            content: { 
              ...q.content, 
              textWithBlanks: newText,
              blankOptions: newBlankOptions,
              correctAnswers: newCorrectAnswers
            }
          };
        }
      }
      return q;
    }));
  };

  const updateClozeBlankOption = (questionId: string, blankIndex: number, optionIndex: number, newValue: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.blankOptions) {
        const updatedBlankOptions = [...q.content.blankOptions];
        updatedBlankOptions[blankIndex] = [...updatedBlankOptions[blankIndex]];
        updatedBlankOptions[blankIndex][optionIndex] = newValue;
        
        return {
          ...q,
          content: { 
            ...q.content, 
            blankOptions: updatedBlankOptions
          }
        };
      }
      return q;
    }));
  };

  const addClozeBlankOption = (questionId: string, blankIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.blankOptions) {
        const updatedBlankOptions = [...q.content.blankOptions];
        updatedBlankOptions[blankIndex] = [...updatedBlankOptions[blankIndex], ''];
        
        return {
          ...q,
          content: { 
            ...q.content, 
            blankOptions: updatedBlankOptions
          }
        };
      }
      return q;
    }));
  };

  const removeClozeBlankOption = (questionId: string, blankIndex: number, optionIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.blankOptions && q.content.blankOptions[blankIndex].length > 1) {
        const updatedBlankOptions = [...q.content.blankOptions];
        updatedBlankOptions[blankIndex] = updatedBlankOptions[blankIndex].filter((_: string, index: number) => index !== optionIndex);
        
        return {
          ...q,
          content: { 
            ...q.content, 
            blankOptions: updatedBlankOptions
          }
        };
      }
      return q;
    }));
  };

  const updateClozeCorrectAnswer = (questionId: string, blankIndex: number, newAnswer: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId) {
        const updatedCorrectAnswers = [...(q.content?.correctAnswers || [])];
        updatedCorrectAnswers[blankIndex] = newAnswer;
        
        return {
          ...q,
          content: { 
            ...q.content, 
            correctAnswers: updatedCorrectAnswers
          }
        };
      }
      return q;
    }));
  };

  // Summary keyPoints editing functions
  const updateKeyPoint = (questionId: string, keyPointIndex: number, field: string, value: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'summary' && q.content?.keyPoints) {
        const updatedKeyPoints = [...q.content.keyPoints];
        updatedKeyPoints[keyPointIndex] = {
          ...updatedKeyPoints[keyPointIndex],
          [field]: value
        };
        return {
          ...q,
          content: { ...q.content, keyPoints: updatedKeyPoints }
        };
      }
      return q;
    }));
  };

  const addKeyPoint = (questionId: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'summary') {
        const newKeyPoint = {
          title: '',
          explanation: ''
        };
        const existingKeyPoints = q.content?.keyPoints || [];
        return {
          ...q,
          content: {
            ...q.content,
            keyPoints: [...existingKeyPoints, newKeyPoint]
          }
        };
      }
      return q;
    }));
  };

  const removeKeyPoint = (questionId: string, keyPointIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'summary' && q.content?.keyPoints) {
        const updatedKeyPoints = q.content.keyPoints.filter((_, index) => index !== keyPointIndex);
        return {
          ...q,
          content: { ...q.content, keyPoints: updatedKeyPoints }
        };
      }
      return q;
    }));
  };

  const saveQuestion = async (questionId: string) => {
    try {
      const question = questions.find(q => q._id === questionId);
      if (!question) return;

      // Prepare the update data - only send changed fields
      const updates: Partial<Question> = {
        questionText: question.questionText,
        type: question.type,
        difficulty: question.difficulty,
        content: question.content,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation
      };

      const result = await questionsApi.updateQuestion(questionId, updates);
      
      // Update local state with the response
      setQuestions(questions.map(q =>
          q._id === questionId ? { ...result.question, isEditing: false } : q
      ));
      
      showNotification('success', 'Question Saved', 'Question has been updated');
    } catch (error) {
      console.error('Failed to save question:', error);
      showNotification('error', 'Save Failed', 'Failed to save question changes');
    }
  };

  const addManualQuestion = async () => {
    if (!newQuestion.question.trim()) return;

    try {
      // First, we need to get the learning objective ID
      // For now, let's assume we have access to learning objectives with IDs
      // In a real scenario, you'd fetch this from the learningObjectives API
      const learningObjectiveId = 'placeholder-lo-id'; // This needs to be the actual LO ID
      
      const questionData = {
        quizId,
        learningObjectiveId,
        type: newQuestion.type as any,
        difficulty: newQuestion.difficulty as any,
        questionText: newQuestion.question,
        content: {
          // Parse the answer based on question type
          ...(newQuestion.type === 'multiple-choice' && {
            options: newQuestion.answer.split('\n').map((text, index) => ({
              text: text.trim(),
              isCorrect: text.trim() === newQuestion.correctAnswer,
              order: index
            }))
          })
        },
        correctAnswer: newQuestion.correctAnswer,
        explanation: 'Manually created question'
      };

      const result = await questionsApi.createQuestion(questionData);
      setQuestions([...questions, { ...result.question, isEditing: false }]);
      
      setNewQuestion({
        type: 'multiple-choice',
        difficulty: 'moderate',
        question: '',
        answer: '',
        correctAnswer: '',
        loIndex: 0
      });
      setShowManualAdd(false);
      
      showNotification('success', 'Question Added', 'New question has been created');
    } catch (error) {
      console.error('Failed to add question:', error);
      showNotification('error', 'Add Failed', 'Failed to create new question');
    }
  };

  const regenerateQuestion = async (questionId: string) => {
    try {
      const result = await questionsApi.regenerateQuestion(questionId);
      setQuestions(questions.map(q =>
          q._id === questionId ? { ...result.question, isEditing: false } : q
      ));
      showNotification('success', 'Question Regenerated', 'Question has been regenerated using AI');
    } catch (error) {
      console.error('Failed to regenerate question:', error);
      showNotification('error', 'Regeneration Failed', 'Failed to regenerate question');
    }
  };

  const handleH5PExport = async () => {
    if (questions.length === 0) {
      showNotification('warning', 'No Questions', 'Add some questions before exporting to H5P');
      return;
    }

    setExportLoading(true);
    try {
      showNotification('info', 'Generating Export', 'Creating H5P package...');
      
      const result = await exportApi.exportToH5P(quizId);
      console.log('Export API response:', result);
      
      if (result.success && result.data) {
        // Download the file
        const blob = await exportApi.downloadExport(result.data.exportId);
        
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.data.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        showNotification('success', 'Export Complete', `Downloaded ${result.data.filename} successfully`);
      } else {
        console.error('Export failed - Response:', result);
        const errorMessage = result.error?.message || 'Failed to generate H5P export';
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.error('H5P export failed:', error);
      const message = error.message || 'Failed to export quiz to H5P format';
      showNotification('error', 'Export Failed', message);
    } finally {
      setExportLoading(false);
    }
  };

  // Interactive Question Component
  const InteractiveQuestion = ({ question, index }: { question: ExtendedQuestion; index: number }) => {
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [showAnswer, setShowAnswer] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);
    
    // State for different question types
    const [clozeAnswers, setClozeAnswers] = useState<string[]>([]);
    const [orderingItems, setOrderingItems] = useState<string[]>([]);
    const [matchingConnections, setMatchingConnections] = useState<{[key: string]: string}>({});
    const [draggedItem, setDraggedItem] = useState<string | null>(null);

    // Initialize ordering items when component mounts
    useEffect(() => {
      if (question.type === 'ordering') {
        if (question.content?.items) {
          setOrderingItems([...question.content.items]);
        } else {
          // Provide fallback data when items are missing
          const fallbackItems = [
            "Initialize variables and data structures",
            "Read input data from user or file", 
            "Process data using the main algorithm",
            "Generate and display the results",
            "Clean up resources and exit"
          ];
          setOrderingItems(fallbackItems);
        }
      }
    }, [question]);

    const handleAnswerSelect = (answer: string) => {
      setSelectedAnswer(answer);
      setShowAnswer(true);
    };

    const handleClozeAnswerChange = (index: number, value: string) => {
      const newAnswers = [...clozeAnswers];
      newAnswers[index] = value;
      setClozeAnswers(newAnswers);
    };

    const handleOrderingDrop = (fromIndex: number, toIndex: number) => {
      const newItems = [...orderingItems];
      const [movedItem] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, movedItem);
      setOrderingItems(newItems);
    };

    const handleMatchingConnection = (leftItem: string, rightItem: string) => {
      setMatchingConnections(prev => ({ ...prev, [leftItem]: rightItem }));
    };

    const checkOrderingAnswer = () => {
      const correct = question.content?.correctOrder || [
        "Initialize variables and data structures",
        "Read input data from user or file", 
        "Process data using the main algorithm",
        "Generate and display the results",
        "Clean up resources and exit"
      ];
      return JSON.stringify(orderingItems) === JSON.stringify(correct);
    };

    const checkMatchingAnswer = () => {
      const correctPairs = question.content?.matchingPairs || [];
      return correctPairs.every(([left, right]: [string, string]) => 
        matchingConnections[left] === right
      );
    };

    const checkClozeAnswers = () => {
      const correctAnswers = question.content?.correctAnswers || [];
      return clozeAnswers.every((answer, index) => 
        answer.toLowerCase() === correctAnswers[index]?.toLowerCase()
      );
    };

    const isCorrect = (answer: string) => {
      if (question.type === 'multiple-choice' && question.content?.options) {
        const option = question.content.options.find((opt: any) => opt.text === answer);
        return option?.isCorrect;
      }
      if (question.type === 'true-false') {
        return String(answer).toLowerCase() === String(question.correctAnswer).toLowerCase();
      }
      return false;
    };

    return (
      <div className="interactive-question">
        <div className="question-header">
          <span className="question-number">Q{index + 1}</span>
          <span className="question-type">{question.type.replace('-', ' ')}</span>
          <span className="question-difficulty">{question.difficulty}</span>
        </div>

        {question.type === 'flashcard' ? (
          <div className={`flashcard ${isFlipped ? 'flipped' : ''}`} onClick={() => setIsFlipped(!isFlipped)}>
            <div className="flashcard-inner">
              <div className="flashcard-front">
                <div className="flashcard-content">
                  <p>{question.content?.front || question.questionText}</p>
                  <div className="flip-hint">Click to reveal answer</div>
                </div>
              </div>
              <div className="flashcard-back">
                <div className="flashcard-content">
                  <p>{question.content?.back || question.correctAnswer}</p>
                  <div className="flip-hint">Click to return</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="standard-question">
            <div className="question-text">{question.questionText}</div>
            
            <div className="question-options">
              {question.type === 'multiple-choice' && question.content?.options && 
                question.content.options.map((option: any, idx: number) => {
                  const isSelected = selectedAnswer === option.text;
                  const optionIsCorrect = option.isCorrect;
                  const showResult = showAnswer && isSelected;
                  
                  return (
                    <button
                      key={idx}
                      className={`option-button ${isSelected ? 'selected' : ''} ${showResult ? (optionIsCorrect ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => !showAnswer && handleAnswerSelect(option.text)}
                      disabled={showAnswer}
                    >
                      <span className="option-label">{String.fromCharCode(65 + idx)}</span>
                      <span className="option-text">{option.text}</span>
                      {showResult && (
                        <span className="option-result">
                          {optionIsCorrect ? '✓' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })
              }
              
              {question.type === 'true-false' && 
                ['True', 'False'].map((option: string, idx: number) => {
                  const isSelected = selectedAnswer === option;
                  const optionIsCorrect = String(question.correctAnswer).toLowerCase() === option.toLowerCase();
                  const showResult = showAnswer && isSelected;
                  
                  return (
                    <button
                      key={idx}
                      className={`tf-button ${isSelected ? 'selected' : ''} ${showResult ? (optionIsCorrect ? 'correct' : 'incorrect') : ''}`}
                      onClick={() => !showAnswer && handleAnswerSelect(option)}
                      disabled={showAnswer}
                    >
                      <span className="tf-text">{option}</span>
                      {showResult && (
                        <span className="tf-result">
                          {optionIsCorrect ? '✓' : '✗'}
                        </span>
                      )}
                    </button>
                  );
                })
              }

              {/* Summary Question - Show Answer Button */}
              {question.type === 'summary' && (
                <div className="summary-question accordion-style">
                  <div className="summary-content">
                    <h4>Key Learning Points</h4>
                    {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
                      <div className="bullet-points">
                        {question.content.keyPoints.map((keyPoint: any, index: number) => {
                          const isExpanded = expandedBulletPoints[question._id]?.[index];
                          return (
                            <div key={index} className="bullet-point-item">
                              <div 
                                className="bullet-point-header" 
                                onClick={() => toggleBulletPoint(question._id, index)}
                                style={{ cursor: 'pointer' }}
                              >
                                <span className={`dropdown-arrow ${isExpanded ? 'expanded' : 'collapsed'}`}>
                                  {isExpanded ? '▼' : '▶'}
                                </span>
                                <span className="bullet-point-title">{keyPoint.title}</span>
                              </div>
                              {isExpanded && (
                                <div className="bullet-point-content">
                                  <p>{keyPoint.explanation}</p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Fallback to learning objectives if no keyPoints generated yet
                      learningObjectives.map((objective, index) => (
                        <div key={index} className="learning-objective-panel">
                          <div className="objective-header">
                            <span className="dropdown-arrow">▼</span>
                            <h4>Learning Objective {index + 1}</h4>
                          </div>
                          <div className="objective-content">
                            <div className="objective-points">
                              <p><strong>Objective:</strong> {objective}</p>
                              <p><strong>Key Points:</strong> Understanding and application of this concept</p>
                              <p><strong>Assessment Focus:</strong> This objective will be evaluated through various question types</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Discussion Question - No answer interaction, display only */}
              {question.type === 'discussion' && (
                <div className="discussion-question">
                  {/* Discussion questions show only the question text, no answer interaction */}
                </div>
              )}

              {/* Cloze (Fill in the blanks) Question - Input Fields (H5P Style) */}
              {question.type === 'cloze' && question.content?.textWithBlanks && (
                <div className="cloze-question">
                  <div className="cloze-text">
                    {question.content.textWithBlanks?.split('$$').map((part, partIndex) => (
                      <span key={partIndex}>
                        {part}
                        {partIndex < (question.content.textWithBlanks?.match(/\$\$/g) || []).length && (
                          <input
                            type="text"
                            className="cloze-input"
                            value={clozeAnswers[partIndex] || ''}
                            onChange={(e) => handleClozeAnswerChange(partIndex, e.target.value)}
                            placeholder={`Blank ${partIndex + 1}`}
                          />
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="cloze-options-hint">
                    <strong>Available options:</strong>
                    <div className="options-display">
                      {question.content.blankOptions?.map((blankOptions: string[], blankIndex: number) => (
                        <div key={blankIndex} className="blank-options-hint">
                          <span className="blank-label">Blank {blankIndex + 1}:</span>
                          <span className="options-list">
                            {blankOptions.filter(opt => opt.trim()).join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="cloze-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                      disabled={clozeAnswers.some(answer => !answer)}
                    >
                      Check Answers
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="cloze-results">
                      <div className={`answer-feedback ${checkClozeAnswers() ? 'correct' : 'incorrect'}`}>
                        {checkClozeAnswers() ? '✓ Correct!' : '✗ Some answers are incorrect'}
                      </div>
                      <div className="correct-answers">
                        <strong>Correct answers:</strong> {question.content.correctAnswers?.join(', ')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Ordering Question - Drag and Drop */}
              {question.type === 'ordering' && (
                <div className="ordering-question">
                  <div className="ordering-instructions">
                    <p>Drag the items to arrange them in the correct order:</p>
                  </div>
                  <div className="ordering-container">
                    {orderingItems.map((item, index) => (
                      <div
                        key={index}
                        className="ordering-item"
                        draggable
                        onDragStart={() => setDraggedItem(item)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggedItem) {
                            const dragIndex = orderingItems.indexOf(draggedItem);
                            handleOrderingDrop(dragIndex, index);
                            setDraggedItem(null);
                          }
                        }}
                      >
                        <span className="order-number">{index + 1}</span>
                        <span className="order-text">{item}</span>
                        <span className="drag-handle">⋮⋮</span>
                      </div>
                    ))}
                  </div>
                  <div className="ordering-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                    >
                      Check Order
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="ordering-results">
                      <div className={`answer-feedback ${checkOrderingAnswer() ? 'correct' : 'incorrect'}`}>
                        {checkOrderingAnswer() ? '✓ Correct order!' : '✗ Incorrect order'}
                      </div>
                      <div className="correct-order">
                        <strong>Correct order:</strong>
                        <ol>
                          {(question.content.correctOrder || [
                            "Initialize variables and data structures",
                            "Read input data from user or file", 
                            "Process data using the main algorithm",
                            "Generate and display the results",
                            "Clean up resources and exit"
                          ]).map((item: string, idx: number) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Matching Question - Drag and Drop */}
              {question.type === 'matching' && question.content?.leftItems && question.content?.rightItems && (
                <div className="matching-question">
                  <div className="matching-instructions">
                    <p>Drag items from the right to match with items on the left:</p>
                  </div>
                  <div className="matching-container">
                    <div className="matching-left">
                      {question.content.leftItems.map((leftItem: string, index: number) => (
                        <div key={index} className="matching-left-item">
                          <div className="left-text">{leftItem}</div>
                          <div 
                            className="match-target"
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (draggedItem) {
                                handleMatchingConnection(leftItem, draggedItem);
                                setDraggedItem(null);
                              }
                            }}
                          >
                            {matchingConnections[leftItem] || 'Drop here'}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="matching-right">
                      {question.content.rightItems.map((rightItem: string, index: number) => (
                        <div
                          key={index}
                          className="matching-right-item"
                          draggable
                          onDragStart={() => setDraggedItem(rightItem)}
                        >
                          {rightItem}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="matching-actions">
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAnswer(true)}
                      disabled={Object.keys(matchingConnections).length < question.content.leftItems.length}
                    >
                      Check Matches
                    </button>
                  </div>
                  {showAnswer && (
                    <div className="matching-results">
                      <div className={`answer-feedback ${checkMatchingAnswer() ? 'correct' : 'incorrect'}`}>
                        {checkMatchingAnswer() ? '✓ All matches correct!' : '✗ Some matches are incorrect'}
                      </div>
                      <div className="correct-matches">
                        <strong>Correct matches:</strong>
                        <ul>
                          {question.content.matchingPairs?.map(([left, right]: [string, string], idx: number) => (
                            <li key={idx}>{left} → {right}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {showAnswer && question.explanation && (
              <div className="explanation">
                <strong>Explanation:</strong> {question.explanation}
              </div>
            )}

            {!showAnswer && (question.type as string) !== 'flashcard' && question.type !== 'ordering' && question.type !== 'matching' && (
              <div className="question-hint">
                Select an answer to see the result
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="review-edit">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Loading Questions...</h3>
            <p className="card-description">Please wait while we load your questions</p>
          </div>
          <div className="p-6 text-center">
            <div className="loading-spinner">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="review-edit">
        <div className="card">
          <div className="card-header">
            <div className="review-header">
              <div>
                <h3 className="card-title">Review & Edit Questions</h3>
                <p className="card-description">
                  Review generated questions and make final adjustments ({questions.length} questions loaded)
                </p>
              </div>
              <div className="review-actions">
                <button
                    className={`btn ${viewMode === 'interact' ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setViewMode(viewMode === 'edit' ? 'interact' : 'edit')}
                >
                  {viewMode === 'edit' ? <Play size={16} /> : <Edit size={16} />}
                  {viewMode === 'edit' ? 'Interact' : 'Edit'}
                </button>
                {viewMode === 'edit' && (
                  <button
                      className="btn btn-outline"
                      onClick={() => setShowManualAdd(true)}
                  >
                    <Plus size={16} />
                    Add Question
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="review-filters">
            <div className="filter-group">
              <label>Filter by Learning Objective:</label>
              <select
                  className="select-input"
                  value={filterByLO ?? ''}
                  onChange={(e) => setFilterByLO(e.target.value ? parseInt(e.target.value) : null)}
              >
                <option value="">All Objectives</option>
                {learningObjectives.map((obj, index) => (
                    <option key={index} value={index}>
                      LO {index + 1}: {obj.substring(0, 50)}...
                    </option>
                ))}
              </select>
            </div>
            <div className="questions-count">
              {filteredQuestions.length} questions {filterByLO !== null ? 'in this objective' : 'total'}
            </div>
          </div>

          <div className="questions-list">
            {filteredQuestions.length === 0 ? (
              <div className="no-questions">
                <p>No questions found. Generate questions from the Question Generation tab first, or add questions manually.</p>
                {viewMode === 'edit' && (
                  <button
                      className="btn btn-primary"
                      onClick={() => setShowManualAdd(true)}
                  >
                    <Plus size={16} />
                    Add First Question
                  </button>
                )}
              </div>
            ) : viewMode === 'interact' ? (
              // Interactive mode - show questions as interactive cards
              <div className="questions-interactive">
                {filteredQuestions.map((question, index) => (
                  <div key={question._id}>
                    <InteractiveQuestion question={question} index={index} />
                  </div>
                ))}
              </div>
            ) : (
              // Edit mode - show questions as editable list items
              filteredQuestions.map((question, index) => (
                <div key={question._id} className="question-item">
                  <div className="question-header">
                    <div className="question-meta">
                      <span className="question-number">Q{index + 1}</span>
                      <span className="question-type">{question.type.replace('-', ' ')}</span>
                      <span className="question-difficulty">{question.difficulty}</span>
                      <span className="question-lo">Order {question.order + 1}</span>
                    </div>
                    <div className="question-actions">
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => regenerateQuestion(question._id)}
                          title="Regenerate question"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleEdit(question._id)}
                          title={question.isEditing ? 'Cancel edit' : 'Edit question'}
                      >
                        {question.isEditing ? <EyeOff size={14} /> : <Edit size={14} />}
                      </button>
                      <button
                          className="btn btn-ghost btn-sm text-destructive"
                          onClick={() => deleteQuestion(question._id)}
                          title="Delete question"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {question.isEditing ? (
                      <div className="question-edit">
                        <div className="edit-field">
                          <label>{question.type === 'flashcard' ? 'Front side:' : 'Question:'}</label>
                          <textarea
                              className="textarea"
                              value={question.type === 'flashcard' ? (question.content?.front || question.questionText) : question.questionText}
                              onChange={(e) => {
                                if (question.type === 'flashcard') {
                                  updateQuestion(question._id, 'content', { ...question.content, front: e.target.value });
                                } else {
                                  updateQuestion(question._id, 'questionText', e.target.value);
                                }
                              }}
                              rows={3}
                              placeholder={question.type === 'flashcard' ? 'Enter the question/front side content...' : 'Enter your question...'}
                          />
                        </div>

                        {/* Multiple Choice Options Editor */}
                        {question.type === 'multiple-choice' && question.content?.options ? (
                          <div className="edit-field">
                            <label>Answer Options:</label>
                            <div className="multiple-choice-editor">
                              {question.content.options.map((option: any, index: number) => (
                                <div key={index} className="option-editor">
                                  <div className="option-input-group">
                                    <input
                                      type="radio"
                                      name={`correct-${question._id}`}
                                      checked={option.isCorrect}
                                      onChange={() => updateMultipleChoiceCorrect(question._id, index)}
                                      className="option-radio"
                                    />
                                    <textarea
                                      className="option-text-input"
                                      value={option.text}
                                      onChange={(e) => updateMultipleChoiceOption(question._id, index, e.target.value)}
                                      placeholder={`Option ${String.fromCharCode(65 + index)}`}
                                      rows={2}
                                    />
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm remove-option"
                                      onClick={() => removeMultipleChoiceOption(question._id, index)}
                                      disabled={question.content.options.length <= 2}
                                      title="Remove option"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                  <small className="option-hint">
                                    {option.isCorrect ? 'Correct Answer' : `Option ${String.fromCharCode(65 + index)}`}
                                  </small>
                                </div>
                              ))}
                              
                              <button
                                type="button"
                                className="btn btn-outline btn-sm add-option"
                                onClick={() => addMultipleChoiceOption(question._id)}
                                disabled={question.content.options.length >= 6}
                              >
                                <Plus size={14} />
                                Add Option
                              </button>
                            </div>
                          </div>
                        ) : question.type === 'true-false' ? (
                          <div className="edit-field">
                            <label>Correct Answer:</label>
                            <div className="true-false-editor">
                              <div className="tf-option">
                                <input
                                  type="radio"
                                  name={`tf-correct-${question._id}`}
                                  value="True"
                                  checked={String(question.correctAnswer).toLowerCase() === 'true'}
                                  onChange={() => updateTrueFalseAnswer(question._id, 'True')}
                                  className="tf-radio"
                                />
                                <label className="tf-label">True</label>
                              </div>
                              <div className="tf-option">
                                <input
                                  type="radio"
                                  name={`tf-correct-${question._id}`}
                                  value="False"
                                  checked={String(question.correctAnswer).toLowerCase() === 'false'}
                                  onChange={() => updateTrueFalseAnswer(question._id, 'False')}
                                  className="tf-radio"
                                />
                                <label className="tf-label">False</label>
                              </div>
                            </div>
                          </div>
                        ) : question.type === 'flashcard' ? (
                          <div className="edit-field">
                            <label>Back side:</label>
                            <textarea
                                className="textarea"
                                value={question.content?.back || question.correctAnswer || ''}
                                onChange={(e) => updateQuestion(question._id, 'content', { ...question.content, back: e.target.value })}
                                rows={3}
                                placeholder="Enter the answer/back side content..."
                            />
                          </div>
                        ) : question.type === 'summary' ? (
                          <div className="edit-field">
                            <label>Knowledge Points:</label>
                            <div className="summary-keypoints-editor">
                              {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
                                question.content.keyPoints.map((keyPoint: any, index: number) => (
                                  <div key={index} className="keypoint-editor">
                                    <div className="keypoint-header">
                                      <strong>Point {index + 1}:</strong>
                                      <button
                                        type="button"
                                        className="btn btn-outline btn-sm remove-keypoint"
                                        onClick={() => removeKeyPoint(question._id, index)}
                                        disabled={question.content.keyPoints.length <= 1}
                                        title="Remove key point"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                    <div className="keypoint-fields">
                                      <input
                                        type="text"
                                        className="input-field keypoint-title"
                                        value={keyPoint.title || ''}
                                        onChange={(e) => updateKeyPoint(question._id, index, 'title', e.target.value)}
                                        placeholder="Enter the knowledge point title..."
                                      />
                                      <textarea
                                        className="textarea keypoint-explanation"
                                        value={keyPoint.explanation || ''}
                                        onChange={(e) => updateKeyPoint(question._id, index, 'explanation', e.target.value)}
                                        rows={3}
                                        placeholder="Enter detailed explanation of this knowledge point..."
                                      />
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="no-keypoints">
                                  <p>No knowledge points available. Generate the question with AI or add manually.</p>
                                </div>
                              )}
                              <button
                                type="button"
                                className="btn btn-outline btn-sm add-keypoint"
                                onClick={() => addKeyPoint(question._id)}
                                disabled={question.content?.keyPoints?.length >= 8}
                              >
                                <Plus size={14} />
                                Add Knowledge Point
                              </button>
                            </div>
                          </div>
                        ) : question.type === 'matching' ? (
                          <div className="edit-field">
                            <label>Matching Items:</label>
                            <div className="matching-editor">
                              <div className="matching-editor-section">
                                <h4>Left Items (Items to Match):</h4>
                                <div className="matching-items-list">
                                  {question.content?.leftItems?.map((item: string, index: number) => (
                                    <div key={index} className="matching-item-editor">
                                      <div className="item-input-group">
                                        <input
                                          type="text"
                                          className="input-field matching-item-input"
                                          value={item}
                                          onChange={(e) => updateMatchingLeftItem(question._id, index, e.target.value)}
                                          placeholder={`Left item ${index + 1}`}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-sm remove-item"
                                          onClick={() => removeMatchingLeftItem(question._id, index)}
                                          disabled={question.content.leftItems.length <= 2}
                                          title="Remove item"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm add-item"
                                  onClick={() => addMatchingLeftItem(question._id)}
                                  disabled={question.content?.leftItems?.length >= 8}
                                >
                                  <Plus size={14} />
                                  Add Left Item
                                </button>
                              </div>

                              <div className="matching-editor-section">
                                <h4>Right Items (Answer Options):</h4>
                                <div className="matching-items-list">
                                  {question.content?.rightItems?.map((item: string, index: number) => (
                                    <div key={index} className="matching-item-editor">
                                      <div className="item-input-group">
                                        <input
                                          type="text"
                                          className="input-field matching-item-input"
                                          value={item}
                                          onChange={(e) => updateMatchingRightItem(question._id, index, e.target.value)}
                                          placeholder={`Right item ${index + 1}`}
                                        />
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-sm remove-item"
                                          onClick={() => removeMatchingRightItem(question._id, index)}
                                          disabled={question.content.rightItems.length <= 2}
                                          title="Remove item"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm add-item"
                                  onClick={() => addMatchingRightItem(question._id)}
                                  disabled={question.content?.rightItems?.length >= 8}
                                >
                                  <Plus size={14} />
                                  Add Right Item
                                </button>
                              </div>

                              <div className="matching-editor-section">
                                <h4>Correct Matches:</h4>
                                <div className="matching-pairs-editor">
                                  {question.content?.matchingPairs?.map((pair: string[], index: number) => (
                                    <div key={index} className="matching-pair-editor">
                                      <div className="pair-input-group">
                                        <select
                                          className="select-input pair-select"
                                          value={pair[0] || ''}
                                          onChange={(e) => updateMatchingPair(question._id, index, 0, e.target.value)}
                                        >
                                          <option value="">Select left item</option>
                                          {question.content?.leftItems?.map((item: string, itemIndex: number) => (
                                            <option key={itemIndex} value={item}>{item}</option>
                                          ))}
                                        </select>
                                        <span className="pair-arrow">→</span>
                                        <select
                                          className="select-input pair-select"
                                          value={pair[1] || ''}
                                          onChange={(e) => updateMatchingPair(question._id, index, 1, e.target.value)}
                                        >
                                          <option value="">Select right item</option>
                                          {question.content?.rightItems?.map((item: string, itemIndex: number) => (
                                            <option key={itemIndex} value={item}>{item}</option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-sm remove-pair"
                                          onClick={() => removeMatchingPair(question._id, index)}
                                          disabled={question.content.matchingPairs.length <= 1}
                                          title="Remove pair"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm add-pair"
                                  onClick={() => addMatchingPair(question._id)}
                                  disabled={question.content?.matchingPairs?.length >= 6}
                                >
                                  <Plus size={14} />
                                  Add Match Pair
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : question.type === 'cloze' ? (
                          <div className="edit-field">
                            <label>Cloze Question:</label>
                            <div className="cloze-editor">
                              <div className="cloze-editor-section">
                                <h4>Question Text with Blanks:</h4>
                                <div className="cloze-text-editor">
                                  <textarea
                                    className="cloze-text-input"
                                    value={question.content?.textWithBlanks || ''}
                                    onChange={(e) => updateClozeText(question._id, e.target.value)}
                                    placeholder="Enter your text with blanks marked by $$ (e.g., 'In programming, $$ is used for handling asynchronous operations while $$ provides more predictable error handling.')"
                                    rows={4}
                                  />
                                  <small className="cloze-hint">
                                    Use $$ to mark where blanks should appear. Each $$ will create a fill-in field.
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm add-blank"
                                  onClick={() => addClozeBlank(question._id)}
                                >
                                  <Plus size={14} />
                                  Add Blank
                                </button>
                              </div>

                              <div className="cloze-editor-section">
                                <h4>Blank Options & Correct Answers:</h4>
                                <div className="cloze-blanks-editor">
                                  {question.content?.blankOptions?.map((blankOptions: string[], blankIndex: number) => (
                                    <div key={blankIndex} className="cloze-blank-editor">
                                      <div className="blank-header">
                                        <strong>Blank {blankIndex + 1}:</strong>
                                        <button
                                          type="button"
                                          className="btn btn-ghost btn-sm remove-blank"
                                          onClick={() => removeClozeBlank(question._id, blankIndex)}
                                          disabled={question.content.blankOptions.length <= 1}
                                          title="Remove blank"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                      
                                      <div className="blank-options">
                                        <label>Available Options:</label>
                                        <div className="options-list">
                                          {blankOptions.map((option: string, optionIndex: number) => (
                                            <div key={optionIndex} className="option-input-group">
                                              <input
                                                type="text"
                                                className="input-field option-input"
                                                value={option}
                                                onChange={(e) => updateClozeBlankOption(question._id, blankIndex, optionIndex, e.target.value)}
                                                placeholder={`Option ${optionIndex + 1}`}
                                              />
                                              <button
                                                type="button"
                                                className="btn btn-ghost btn-sm remove-option"
                                                onClick={() => removeClozeBlankOption(question._id, blankIndex, optionIndex)}
                                                disabled={blankOptions.length <= 1}
                                                title="Remove option"
                                              >
                                                <Trash2 size={14} />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                        <button
                                          type="button"
                                          className="btn btn-outline btn-sm add-option"
                                          onClick={() => addClozeBlankOption(question._id, blankIndex)}
                                        >
                                          <Plus size={14} />
                                          Add Option
                                        </button>
                                      </div>

                                      <div className="correct-answer">
                                        <label>Correct Answer:</label>
                                        <input
                                          type="text"
                                          className="input-field correct-answer-input"
                                          value={question.content?.correctAnswers?.[blankIndex] || ''}
                                          onChange={(e) => updateClozeCorrectAnswer(question._id, blankIndex, e.target.value)}
                                          placeholder="Enter the correct answer for this blank"
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="cloze-editor-section">
                                <h4>Preview:</h4>
                                <div className="cloze-preview">
                                  <div className="preview-text">
                                    {question.content?.textWithBlanks?.split('$$').map((part: string, partIndex: number) => (
                                      <span key={partIndex}>
                                        {part}
                                        {partIndex < (question.content?.textWithBlanks?.match(/\$\$/g) || []).length && (
                                          <input
                                            type="text"
                                            className="preview-blank"
                                            placeholder={`Blank ${partIndex + 1}`}
                                            disabled
                                          />
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : question.type === 'ordering' ? (
                          <div className="edit-field">
                            <label>Ordering Items:</label>
                            <div className="ordering-editor">
                              <div className="ordering-editor-section">
                                <h4>Items to Order:</h4>
                                <div className="ordering-items-list">
                                  {question.content?.items?.map((item: string, index: number) => (
                                    <div key={index} className="ordering-item-editor">
                                      <div className="item-input-group">
                                        <div className="order-number-display">
                                          {index + 1}
                                        </div>
                                        <textarea
                                          className="ordering-item-input"
                                          value={item}
                                          onChange={(e) => updateOrderingItem(question._id, index, e.target.value)}
                                          placeholder={`Item ${index + 1}`}
                                          rows={2}
                                        />
                                        <div className="item-actions">
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm move-up"
                                            onClick={() => moveOrderingItem(question._id, index, Math.max(0, index - 1))}
                                            disabled={index === 0}
                                            title="Move up"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm move-down"
                                            onClick={() => moveOrderingItem(question._id, index, Math.min((question.content?.items?.length || 1) - 1, index + 1))}
                                            disabled={index === (question.content?.items?.length || 1) - 1}
                                            title="Move down"
                                          >
                                            ↓
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-ghost btn-sm remove-item"
                                            onClick={() => removeOrderingItem(question._id, index)}
                                            disabled={question.content.items.length <= 2}
                                            title="Remove item"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm add-item"
                                  onClick={() => addOrderingItem(question._id)}
                                  disabled={question.content?.items?.length >= 8}
                                >
                                  <Plus size={14} />
                                  Add Item
                                </button>
                              </div>
                              
                              <div className="ordering-editor-section">
                                <h4>Correct Order Preview:</h4>
                                <div className="correct-order-preview">
                                  <ol>
                                    {question.content?.correctOrder?.map((item: string, index: number) => (
                                      <li key={index}>{item}</li>
                                    ))}
                                  </ol>
                                </div>
                                <small className="order-hint">
                                  The correct order is automatically updated when you reorder items above.
                                </small>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="edit-field">
                            <label>Correct Answer:</label>
                            <textarea
                                className="textarea"
                                value={typeof question.correctAnswer === 'string' ? question.correctAnswer : JSON.stringify(question.correctAnswer)}
                                onChange={(e) => updateQuestion(question._id, 'correctAnswer', e.target.value)}
                                rows={2}
                            />
                          </div>
                        )}

                        <div className="edit-field">
                          <label>Explanation (optional):</label>
                          <textarea
                              className="textarea"
                              value={question.explanation || ''}
                              onChange={(e) => updateQuestion(question._id, 'explanation', e.target.value)}
                              rows={2}
                          />
                        </div>

                        <div className="edit-actions">
                          <button
                              className="btn btn-primary btn-sm"
                              onClick={() => saveQuestion(question._id)}
                          >
                            <Save size={14} />
                            Save
                          </button>
                          <button
                              className="btn btn-outline btn-sm"
                              onClick={() => toggleEdit(question._id)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                  ) : question.type === 'summary' ? (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="summary-keypoints-display">
                          {question.content?.keyPoints && question.content.keyPoints.length > 0 ? (
                            <div className="keypoints-list">
                              <strong>Knowledge Points:</strong>
                              {question.content.keyPoints.map((keyPoint: any, index: number) => (
                                <div key={index} className="keypoint-display">
                                  <div className="keypoint-title">
                                    <strong>{index + 1}. {keyPoint.title}</strong>
                                  </div>
                                  <div className="keypoint-explanation">
                                    {keyPoint.explanation}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="question-answer">
                              <strong>Answer:</strong> {
                                typeof question.correctAnswer === 'string' 
                                  ? question.correctAnswer 
                                  : JSON.stringify(question.correctAnswer)
                              }
                            </div>
                          )}
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  ) : question.type === 'matching' ? (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="matching-display">
                          <div className="matching-items-display">
                            <div className="matching-left-display">
                              <strong>Items to Match:</strong>
                              <ul>
                                {question.content?.leftItems?.map((item: string, index: number) => (
                                  <li key={index}>{item}</li>
                                ))}
                              </ul>
                            </div>
                            <div className="matching-right-display">
                              <strong>Answer Options:</strong>
                              <ul>
                                {question.content?.rightItems?.map((item: string, index: number) => (
                                  <li key={index}>{item}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div className="matching-pairs-display">
                            <strong>Correct Matches:</strong>
                            <ul>
                              {question.content?.matchingPairs?.map((pair: string[], index: number) => (
                                <li key={index}>
                                  <strong>{pair[0]}</strong> → {pair[1]}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  ) : question.type === 'cloze' ? (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="cloze-display">
                          <div className="cloze-text-display">
                            <strong>Question Text:</strong>
                            <div className="cloze-text-content">
                              {question.content?.textWithBlanks?.split('$$').map((part: string, partIndex: number) => (
                                <span key={partIndex}>
                                  {part}
                                  {partIndex < (question.content?.blankOptions?.length || 0) && (
                                    <span className="blank-placeholder">[Blank {partIndex + 1}]</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="cloze-answers-display">
                            <strong>Correct Answers:</strong>
                            <ul>
                              {question.content?.correctAnswers?.map((answer: string, index: number) => (
                                <li key={index}>
                                  <strong>Blank {index + 1}:</strong> {answer}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div className="cloze-options-display">
                            <strong>Available Options:</strong>
                            {question.content?.blankOptions?.map((blankOptions: string[], blankIndex: number) => (
                              <div key={blankIndex} className="blank-options-display">
                                <strong>Blank {blankIndex + 1}:</strong> {blankOptions.filter(opt => opt.trim()).join(', ')}
                              </div>
                            ))}
                          </div>
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  ) : question.type === 'ordering' ? (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="ordering-display">
                          <div className="ordering-items-display">
                            <strong>Items to Order:</strong>
                            <ul>
                              {question.content?.items?.map((item: string, index: number) => (
                                <li key={index}>{item}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="correct-order-display">
                            <strong>Correct Order:</strong>
                            <ol>
                              {question.content?.correctOrder?.map((item: string, index: number) => (
                                <li key={index}>{item}</li>
                              ))}
                            </ol>
                          </div>
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  ) : (
                      <div className="question-display">
                        <div className="question-text">{question.questionText}</div>
                        <div className="question-answer">
                          <strong>Answer:</strong> {
                            typeof question.correctAnswer === 'string' 
                              ? question.correctAnswer 
                              : JSON.stringify(question.correctAnswer)
                          }
                        </div>
                        {question.explanation && (
                          <div className="question-explanation">
                            <strong>Explanation:</strong> {question.explanation}
                          </div>
                        )}
                      </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Export Section */}
          {filteredQuestions.length > 0 && (
            <div className="export-section">
              <div className="export-header">
                <h4>Export Quiz</h4>
                <p>Export your completed quiz for use in other platforms</p>
              </div>
              <div className="export-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleH5PExport}
                  disabled={exportLoading}
                >
                  <Download size={16} />
                  {exportLoading ? 'Exporting...' : 'Export to H5P'}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => showNotification('info', 'Export Coming Soon', 'PDF export functionality will be available soon!')}
                >
                  <Download size={16} />
                  Export to PDF
                </button>
              </div>
            </div>
          )}

          {showManualAdd && (
              <div className="manual-add-modal">
                <div className="modal-overlay" onClick={() => setShowManualAdd(false)}></div>
                <div className="modal-content">
                  <div className="modal-header">
                    <h4>Add New Question</h4>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowManualAdd(false)}
                    >
                      ×
                    </button>
                  </div>

                  <div className="manual-add-form">
                    <div className="form-row">
                      <div className="form-field">
                        <label>Question Type:</label>
                        <select
                            className="select-input"
                            value={newQuestion.type}
                            onChange={(e) => setNewQuestion({...newQuestion, type: e.target.value})}
                        >
                          {questionTypes.map(type => (
                              <option key={type.id} value={type.id}>{type.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Difficulty:</label>
                        <select
                            className="select-input"
                            value={newQuestion.difficulty}
                            onChange={(e) => setNewQuestion({...newQuestion, difficulty: e.target.value})}
                        >
                          <option value="easy">Easy</option>
                          <option value="moderate">Moderate</option>
                          <option value="hard">Hard</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Learning Objective:</label>
                        <select
                            className="select-input"
                            value={newQuestion.loIndex}
                            onChange={(e) => setNewQuestion({...newQuestion, loIndex: parseInt(e.target.value)})}
                        >
                          {learningObjectives.map((obj, index) => (
                              <option key={index} value={index}>
                                LO {index + 1}: {obj.substring(0, 30)}...
                              </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-field">
                      <label>Question:</label>
                      <textarea
                          className="textarea"
                          placeholder="Enter your question here..."
                          value={newQuestion.question}
                          onChange={(e) => setNewQuestion({...newQuestion, question: e.target.value})}
                          rows={3}
                      />
                    </div>

                    <div className="form-field">
                      <label>Answer:</label>
                      <textarea
                          className="textarea"
                          placeholder="Enter the answer or options (one per line for multiple choice)..."
                          value={newQuestion.answer}
                          onChange={(e) => setNewQuestion({...newQuestion, answer: e.target.value})}
                          rows={3}
                      />
                    </div>

                    <div className="modal-actions">
                      <button
                          className="btn btn-primary"
                          onClick={addManualQuestion}
                          disabled={!newQuestion.question.trim()}
                      >
                        <Plus size={16} />
                        Add Question
                      </button>
                      <button
                          className="btn btn-outline"
                          onClick={() => setShowManualAdd(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
          )}
        </div>
      </div>
  );
};

export default ReviewEdit;