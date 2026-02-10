import { ExtendedQuestion } from './reviewTypes';

export function useQuestionEditHandlers(
  questions: ExtendedQuestion[],
  setQuestions: React.Dispatch<React.SetStateAction<ExtendedQuestion[]>>
) {
  const updateQuestion = (questionId: string, field: keyof ExtendedQuestion, value: ExtendedQuestion[keyof ExtendedQuestion]) => {
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
        const updatedOptions = q.content.options.map((option: { text: string; isCorrect: boolean; order?: number }, index: number) => ({
          ...option,
          isCorrect: index === correctIndex
        }));
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
        const updatedOptions = q.content.options.filter((_: { text: string; isCorrect: boolean; order?: number }, index: number) => index !== optionIndex);
        if (optionToRemove.isCorrect && updatedOptions.length > 0) {
          updatedOptions[0].isCorrect = true;
        }
        updatedOptions.forEach((option: { text: string; isCorrect: boolean; order?: number }, index: number) => {
          option.order = index;
        });
        const correctOption = updatedOptions.find((opt: { text: string; isCorrect: boolean; order?: number }) => opt.isCorrect);
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
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'true-false') {
        return { ...q, correctAnswer: answer };
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
        const updatedMatchingPairs = q.content.matchingPairs?.map((pair: string[]) =>
          pair[0] === q.content.leftItems[itemIndex] ? [newText, pair[1]] : pair
        ) || [];
        return {
          ...q,
          content: { ...q.content, leftItems: updatedLeftItems, matchingPairs: updatedMatchingPairs }
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
        const updatedMatchingPairs = q.content.matchingPairs?.map((pair: string[]) =>
          pair[1] === q.content.rightItems[itemIndex] ? [pair[0], newText] : pair
        ) || [];
        return {
          ...q,
          content: { ...q.content, rightItems: updatedRightItems, matchingPairs: updatedMatchingPairs }
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
          content: { ...q.content, leftItems: [...q.content.leftItems, newItem] }
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
          content: { ...q.content, rightItems: [...q.content.rightItems, newItem] }
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
        const updatedMatchingPairs = q.content.matchingPairs?.filter((pair: string[]) => pair[0] !== itemToRemove) || [];
        return {
          ...q,
          content: { ...q.content, leftItems: updatedLeftItems, matchingPairs: updatedMatchingPairs }
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
        const updatedMatchingPairs = q.content.matchingPairs?.filter((pair: string[]) => pair[1] !== itemToRemove) || [];
        return {
          ...q,
          content: { ...q.content, rightItems: updatedRightItems, matchingPairs: updatedMatchingPairs }
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
          content: { ...q.content, matchingPairs: updatedPairs }
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
          content: { ...q.content, matchingPairs: [...q.content.matchingPairs, newPair] }
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
          content: { ...q.content, matchingPairs: updatedPairs }
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
        const updatedCorrectOrder = q.content.correctOrder?.map((item: string) =>
          item === q.content.items[itemIndex] ? newText : item
        ) || [...updatedItems];
        return {
          ...q,
          content: { ...q.content, items: updatedItems, correctOrder: updatedCorrectOrder }
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
          content: { ...q.content, items: updatedItems, correctOrder: updatedCorrectOrder }
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
          content: { ...q.content, items: updatedItems, correctOrder: updatedCorrectOrder }
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
        const updatedCorrectOrder = [...updatedItems];
        return {
          ...q,
          content: { ...q.content, items: updatedItems, correctOrder: updatedCorrectOrder }
        };
      }
      return q;
    }));
  };

  // Cloze question specific editing functions
  const updateClozeText = (questionId: string, newText: string) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId) {
        const blankCount = (newText.match(/\$\$/g) || []).length;
        const currentBlankOptions = q.content?.blankOptions || [];
        const currentCorrectAnswers = q.content?.correctAnswers || [];
        let newBlankOptions = [...currentBlankOptions];
        let newCorrectAnswers = [...currentCorrectAnswers];
        while (newBlankOptions.length < blankCount) {
          newBlankOptions.push(['']);
          newCorrectAnswers.push('');
        }
        if (newBlankOptions.length > blankCount) {
          newBlankOptions = newBlankOptions.slice(0, blankCount);
          newCorrectAnswers = newCorrectAnswers.slice(0, blankCount);
        }
        return {
          ...q,
          content: { ...q.content, textWithBlanks: newText, blankOptions: newBlankOptions, correctAnswers: newCorrectAnswers }
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
          content: { ...q.content, textWithBlanks: newText, blankOptions: newBlankOptions, correctAnswers: newCorrectAnswers }
        };
      }
      return q;
    }));
  };

  const removeClozeBlank = (questionId: string, blankIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.content?.blankOptions && q.content.blankOptions.length > 1) {
        const textParts = q.content.textWithBlanks?.split('$$') || [];
        if (blankIndex < textParts.length - 1) {
          const newTextParts = [...textParts];
          newTextParts[blankIndex] = newTextParts[blankIndex] + newTextParts[blankIndex + 1];
          newTextParts.splice(blankIndex + 1, 1);
          const newText = newTextParts.join('$$');
          const newBlankOptions = q.content.blankOptions.filter((_: string[], index: number) => index !== blankIndex);
          const newCorrectAnswers = q.content.correctAnswers?.filter((_: string, index: number) => index !== blankIndex) || [];
          return {
            ...q,
            content: { ...q.content, textWithBlanks: newText, blankOptions: newBlankOptions, correctAnswers: newCorrectAnswers }
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
          content: { ...q.content, blankOptions: updatedBlankOptions }
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
          content: { ...q.content, blankOptions: updatedBlankOptions }
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
          content: { ...q.content, blankOptions: updatedBlankOptions }
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
          content: { ...q.content, correctAnswers: updatedCorrectAnswers }
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
        updatedKeyPoints[keyPointIndex] = { ...updatedKeyPoints[keyPointIndex], [field]: value };
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
        const newKeyPoint = { title: '', explanation: '' };
        const existingKeyPoints = q.content?.keyPoints || [];
        return {
          ...q,
          content: { ...q.content, keyPoints: [...existingKeyPoints, newKeyPoint] }
        };
      }
      return q;
    }));
  };

  const removeKeyPoint = (questionId: string, keyPointIndex: number) => {
    setQuestions(questions.map(q => {
      if (q._id === questionId && q.type === 'summary' && q.content?.keyPoints) {
        const updatedKeyPoints = q.content.keyPoints.filter((_: { title: string; explanation: string }, index: number) => index !== keyPointIndex);
        return {
          ...q,
          content: { ...q.content, keyPoints: updatedKeyPoints }
        };
      }
      return q;
    }));
  };

  return {
    updateQuestion,
    updateMultipleChoiceOption,
    updateMultipleChoiceCorrect,
    addMultipleChoiceOption,
    removeMultipleChoiceOption,
    updateTrueFalseAnswer,
    updateMatchingLeftItem,
    updateMatchingRightItem,
    addMatchingLeftItem,
    addMatchingRightItem,
    removeMatchingLeftItem,
    removeMatchingRightItem,
    updateMatchingPair,
    addMatchingPair,
    removeMatchingPair,
    updateOrderingItem,
    addOrderingItem,
    removeOrderingItem,
    moveOrderingItem,
    updateClozeText,
    addClozeBlank,
    removeClozeBlank,
    updateClozeBlankOption,
    addClozeBlankOption,
    removeClozeBlankOption,
    updateClozeCorrectAnswer,
    updateKeyPoint,
    addKeyPoint,
    removeKeyPoint,
  };
}
