/**
 * PDF Export Service
 * Handles PDF generation for quiz exports.
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { normalizeOptionLabels } from './exportUtils.js';

const PDF_FONTS = {
  'Export-Regular': fileURLToPath(new URL('../assets/fonts/DejaVuSans.ttf', import.meta.url)),
  'Export-Bold': fileURLToPath(new URL('../assets/fonts/DejaVuSans-Bold.ttf', import.meta.url)),
  'Export-Italic': fileURLToPath(new URL('../assets/fonts/DejaVuSans-Oblique.ttf', import.meta.url))
};

function registerExportFonts(doc) {
  for (const [name, filename] of Object.entries(PDF_FONTS)) doc.registerFont(name, filename);
}

function getMultipleChoiceMode(question) {
  if (question.content?.selectionMode === 'multiple') {
    return 'multiple';
  }

  const correctCount = (question.content?.options || []).filter(option => option.isCorrect).length;
  return correctCount > 1 ? 'multiple' : 'single';
}

function addIndentedLines(doc, lines, indent = 20, fontSize = 9) {
  lines.filter(Boolean).forEach((line) => {
    doc.fontSize(fontSize).font('Export-Regular').text(line, { indent });
    doc.moveDown(0.2);
  });
}

function replaceBlankMarkers(text = '') {
  return String(text).replace(/\$\$/g, '________');
}

function removeMarkTheWordsAnswerMarkers(text = '') {
  return String(text).replace(/\*([^*]+)\*/g, '$1');
}

function markedWords(text = '') {
  return [...String(text).matchAll(/\*([^*]+)\*/g)]
    .map(match => match[1]?.trim())
    .filter(Boolean);
}

function documentationPageTitle(page, index) {
  if (page?.title) return page.title;
  if (page?.type === 'intro') return 'Introduction';
  if (page?.type === 'goals') return 'Goals';
  if (page?.type === 'assessment') return 'Goals Assessment';
  if (page?.type === 'export') return 'Document Export';
  return `Page ${index + 1}`;
}

/**
 * Create a PDF export of quiz questions.
 * @param {Object} quiz - Quiz document with populated questions
 * @param {string} outputPath - File path to save PDF
 * @param {string} type - Export type: 'questions', 'answers', or 'combined'
 */
// Measurement and output share the same renderer so pagination also accounts
// for optional hints, answer feedback, and instructor-authored long text.
function renderQuestion(doc, question, questionNumber, type) {
  // Question header
  doc.fontSize(12).font('Export-Bold').text(`Question ${questionNumber}`, { continued: false });
  doc.moveDown(0.5);

  // Question text
  doc.fontSize(11).font('Export-Regular').text(replaceBlankMarkers(question.questionText), {
    align: 'left',
    width: 500
  });
  doc.moveDown(0.5);

  // Question type
  doc.fontSize(9).font('Export-Italic').text(`Type: ${question.type}`, { align: 'left' });
  doc.moveDown(0.5);

  // Add question-specific content
  if (type === 'questions' || type === 'combined') {
    addQuestionContent(doc, question);
  }

  // Add answers if needed
  if (type === 'answers' || type === 'combined') {
    doc.moveDown(0.5);
    doc.fontSize(10).font('Export-Bold').fillColor('#2563eb').text('Answer:', { continued: false });
    doc.font('Export-Regular').fillColor('#000000');
    addAnswerContent(doc, question);
  }

  doc.moveDown(1.5);

}

export async function createPDFExport(quiz, outputPath, type) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'LETTER',
        bufferPages: true
      });

      registerExportFonts(doc);
      // A tall scratch page measures full blocks with the exact fonts and widths.
      const measure = new PDFDocument({ margin: 50, size: [612, 1000000], autoFirstPage: true });
      registerExportFonts(measure);
      measure.resume();
      const stream = createWriteStream(outputPath);
      doc.pipe(stream);

      // Title
      doc.fontSize(24).font('Export-Bold').text(quiz.name, { align: 'center' });
      doc.moveDown();

      // Type label
      const typeLabels = {
        questions: 'Questions Only',
        answers: 'Answer Key',
        combined: 'Questions and Answers'
      };
      doc.fontSize(14).font('Export-Regular').text(typeLabels[type], { align: 'center' });
      doc.moveDown(2);

      // Add questions based on type
      quiz.questions.forEach((question, index) => {
        const questionNumber = index + 1;

        measure.x = 50;
        measure.y = 50;
        renderQuestion(measure, question, questionNumber, type);
        const blockHeight = measure.y - 50;
        const usableHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
        const remainingHeight = doc.page.height - doc.page.margins.bottom - doc.y;
        // Keep a normal question together; start oversized questions on a fresh
        // page and let PDFKit continue them naturally without clipping text.
        if (doc.y > doc.page.margins.top && remainingHeight < Math.min(blockHeight, usableHeight)) {
          doc.addPage();
        }

        renderQuestion(doc, question, questionNumber, type);

        // Add separator line between questions
        if (questionNumber < quiz.questions.length) {
          doc.strokeColor('#cccccc').moveTo(50, doc.y).lineTo(550, doc.y).stroke();
          doc.moveDown(1);
        }
      });

      measure.end();

      // Add page numbers to all pages
      const range = doc.bufferedPageRange();

      for (let pageIndex = range.start; pageIndex < (range.start + range.count); pageIndex++) {
        doc.switchToPage(pageIndex);

        const pageNumber = pageIndex - range.start + 1;
        const originalY = doc.y;
        const originalBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        doc.fontSize(8)
          .font('Export-Regular')
          .fillColor('#666666')
          .text(
            `Generated by TLEF CREATE - Page ${pageNumber} of ${range.count}`,
            50,
            doc.page.height - 35,
            {
              align: 'center',
              lineBreak: false,
              width: doc.page.width - 100
            }
          );

        doc.y = originalY;
        doc.page.margins.bottom = originalBottomMargin;
        doc.fillColor('#000000');
      }

      doc.end();

      stream.on('finish', () => {
        console.log(`PDF created: ${outputPath}`);
        resolve();
      });

      stream.on('error', (error) => {
        console.error('PDF creation error:', error);
        reject(error);
      });

    } catch (error) {
      console.error('PDF creation error:', error);
      reject(error);
    }
  });
}

/**
 * Add question-specific content to PDF.
 */
export function addQuestionContent(doc, question) {
  if (question.type === 'multiple-choice') {
    const options = question.content?.options || [];
    const optionTexts = normalizeOptionLabels(options.map(option => option.text));
    doc.fontSize(10).font('Export-Regular').text('Options:', { underline: true });
    doc.moveDown(0.3);

    options.forEach((option, idx) => {
      const letter = String.fromCharCode(65 + idx);
      doc.fontSize(10).font('Export-Regular').text(`${letter}. ${optionTexts[idx]}`, { indent: 20 });
      doc.moveDown(0.2);
    });

    const tips = options
      .map((option, idx) => option.tip ? `${String.fromCharCode(65 + idx)}. ${option.tip}` : null)
      .filter(Boolean);

    if (tips.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(9).font('Export-Bold').text('Tips:', { indent: 20 });
      doc.moveDown(0.2);
      addIndentedLines(doc, tips, 30, 9);
    }
  } else if (question.type === 'true-false') {
    doc.fontSize(10).font('Export-Regular').text('Options:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text('A. True', { indent: 20 });
    doc.moveDown(0.2);
    doc.fontSize(10).text('B. False', { indent: 20 });
  } else if (question.type === 'cloze') {
    const textWithBlanks = question.content?.textWithBlanks || question.questionText;
    doc.fontSize(10).font('Export-Regular').text('Fill in the blanks:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(replaceBlankMarkers(textWithBlanks), { indent: 20 });

    const blankOptions = question.content?.blankOptions || [];
    if (blankOptions.length > 0) {
      doc.moveDown(0.5);
      doc.fontSize(9).font('Export-Italic').text('Available options:', { indent: 20 });
      blankOptions.forEach((options, index) => {
        if (options && options.length > 0) {
          doc.fontSize(9).text(`Blank ${index + 1}: ${options.join(', ')}`, { indent: 30 });
        }
      });
    }
  } else if (question.type === 'ordering') {
    const items = question.content?.items || [];
    doc.fontSize(10).font('Export-Regular').text('Items to order:', { underline: true });
    doc.moveDown(0.3);
    items.forEach((item, idx) => {
      doc.fontSize(10).text(`${idx + 1}. ${item}`, { indent: 20 });
      doc.moveDown(0.2);
    });
  } else if (question.type === 'matching') {
    const leftItems = question.content?.leftItems || [];
    const rightItems = question.content?.rightItems || [];
    doc.fontSize(10).font('Export-Regular').text('Match the following:', { underline: true });
    doc.moveDown(0.3);

    doc.fontSize(9).font('Export-Bold').text('Column A:', { indent: 20 });
    leftItems.forEach((item, idx) => {
      doc.fontSize(9).font('Export-Regular').text(`${idx + 1}. ${item}`, { indent: 30 });
    });

    doc.moveDown(0.3);
    doc.fontSize(9).font('Export-Bold').text('Column B:', { indent: 20 });
    rightItems.forEach((item, idx) => {
      const letter = String.fromCharCode(65 + idx);
      doc.fontSize(9).font('Export-Regular').text(`${letter}. ${item}`, { indent: 30 });
    });
  } else if (question.type === 'flashcard') {
    const front = question.content?.front || question.questionText;
    doc.fontSize(10).font('Export-Regular').text('Front:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(front, { indent: 20 });
  } else if (question.type === 'guess-the-answer') {
    doc.fontSize(10).font('Export-Regular').text('Self-check prompt:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(question.questionText, { indent: 20 });
  } else if (question.type === 'mark-the-words') {
    const statement = question.content?.text || question.text || '';
    doc.fontSize(10).font('Export-Regular').text('Statement:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(removeMarkTheWordsAnswerMarkers(statement), { indent: 20 });
  } else if (question.type === 'single-choice-set') {
    const questions = question.content?.questions || [];
    doc.fontSize(10).font('Export-Regular').text('Question set:', { underline: true });
    doc.moveDown(0.3);
    questions.forEach((subQuestion, questionIndex) => {
      doc.fontSize(10).font('Export-Bold').text(`${questionIndex + 1}. ${subQuestion.question || ''}`, { indent: 20 });
      const answerTexts = normalizeOptionLabels((subQuestion.answers || []).map(answer => typeof answer === 'string' ? answer : answer?.text || ''));
      answerTexts.forEach((answerText, answerIndex) => {
        const letter = String.fromCharCode(65 + answerIndex);
        doc.fontSize(9).font('Export-Regular').text(`${letter}. ${answerText}`, { indent: 35 });
      });
      doc.moveDown(0.25);
    });
  } else if (question.type === 'documentation-tool') {
    const title = question.content?.title || question.questionText || 'Documentation Tool';
    const pages = question.content?.pages || [];
    doc.fontSize(10).font('Export-Bold').text(title, { indent: 20 });
    doc.moveDown(0.3);
    pages.forEach((page, pageIndex) => {
      doc.fontSize(9).font('Export-Bold').text(`${pageIndex + 1}. ${documentationPageTitle(page, pageIndex)}`, { indent: 25 });
      if (page.introText) {
        doc.fontSize(9).font('Export-Regular').text(page.introText, { indent: 35 });
      }
      (page.fields || []).forEach(field => {
        doc.fontSize(9).font('Export-Regular').text(`• ${field.label || 'Response'}: ______________________________`, { indent: 35 });
      });
      doc.moveDown(0.2);
    });
  } else if (question.type === 'summary') {
    const keyPoints = question.content?.keyPoints || [];
    doc.fontSize(10).font('Export-Regular').text('Knowledge points:', { underline: true });
    doc.moveDown(0.3);
    if (keyPoints.length > 0) {
      keyPoints.forEach((keyPoint, index) => {
        const title = keyPoint?.title || `Knowledge point ${index + 1}`;
        const explanation = keyPoint?.explanation ? ` — ${keyPoint.explanation}` : '';
        doc.fontSize(9).font('Export-Regular').text(`${index + 1}. ${title}${explanation}`, { indent: 20 });
        doc.moveDown(0.2);
      });
    } else {
      doc.fontSize(9).font('Export-Regular').text(question.content?.summary || question.explanation || 'No knowledge points provided.', { indent: 20 });
    }
  } else if (question.type === 'essay') {
    const taskDescription = question.content?.taskDescription || question.taskDescription || '';
    doc.fontSize(10).font('Export-Regular').text('Essay topic:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(taskDescription || question.questionText || 'No essay topic provided.', { indent: 20 });
  }
}

/**
 * Add answer content to PDF.
 */
export function addAnswerContent(doc, question) {
  if (question.type === 'multiple-choice') {
    const options = question.content?.options || [];
    const optionTexts = normalizeOptionLabels(options.map(option => option.text));
    const correctOptions = options.filter(opt => opt.isCorrect);
    if (correctOptions.length > 0) {
      const answerMode = getMultipleChoiceMode(question);
      if (answerMode === 'multiple') {
        correctOptions.forEach((correctOption) => {
          const correctIndex = options.indexOf(correctOption);
          const letter = String.fromCharCode(65 + correctIndex);
          doc.fontSize(10).text(`${letter}. ${optionTexts[correctIndex]}`, { indent: 20 });
        });
      } else {
        const correctOption = correctOptions[0];
        const correctIndex = options.indexOf(correctOption);
        const letter = String.fromCharCode(65 + correctIndex);
        doc.fontSize(10).text(`${letter}. ${optionTexts[correctIndex]}`, { indent: 20 });
      }
    } else {
      doc.fontSize(10).text(question.correctAnswer || 'N/A', { indent: 20 });
    }

    const feedbackLines = options.flatMap((option, idx) => {
      const letter = String.fromCharCode(65 + idx);
      return [
        option.chosenFeedback ? `${letter}. If selected: ${option.chosenFeedback}` : null,
        option.notChosenFeedback ? `${letter}. If not selected: ${option.notChosenFeedback}` : null
      ].filter(Boolean);
    });

    if (feedbackLines.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(9).font('Export-Bold').text('Option Feedback:', { indent: 20 });
      doc.moveDown(0.2);
      addIndentedLines(doc, feedbackLines, 30, 9);
    }
  } else if (question.type === 'true-false') {
    const answer = String(question.correctAnswer).toLowerCase() === 'true' ? 'True' : 'False';
    doc.fontSize(10).text(answer, { indent: 20 });
  } else if (question.type === 'cloze') {
    const correctAnswers = question.content?.correctAnswers || [];
    if (correctAnswers.length > 0) {
      correctAnswers.forEach((answer, idx) => {
        doc.fontSize(10).text(`Blank ${idx + 1}: ${answer}`, { indent: 20 });
      });
    } else {
      doc.fontSize(10).text(question.correctAnswer || 'N/A', { indent: 20 });
    }
  } else if (question.type === 'ordering') {
    const correctOrder = question.content?.correctOrder || [];
    doc.fontSize(10).text('Correct order:', { indent: 20 });
    correctOrder.forEach((item, idx) => {
      doc.fontSize(10).text(`${idx + 1}. ${item}`, { indent: 30 });
    });
  } else if (question.type === 'matching') {
    const matchingPairs = question.content?.matchingPairs || [];
    doc.fontSize(10).text('Correct matches:', { indent: 20 });
    matchingPairs.forEach((pair, idx) => {
      doc.fontSize(10).text(`${idx + 1}. ${pair[0]} → ${pair[1]}`, { indent: 30 });
    });
  } else if (question.type === 'flashcard') {
    const back = question.content?.back || question.correctAnswer;
    doc.fontSize(10).text('Back:', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).text(back, { indent: 20 });
  } else if (question.type === 'guess-the-answer') {
    const solution = question.content?.solutionText || question.correctAnswer;
    doc.fontSize(10).text(solution || 'N/A', { indent: 20 });
  } else if (question.type === 'mark-the-words') {
    const answers = question.correctAnswer
      || markedWords(question.content?.text || question.text || '').join(', ');
    doc.fontSize(10).text(answers || 'N/A', { indent: 20 });
  } else if (question.type === 'single-choice-set') {
    const questions = question.content?.questions || [];
    if (questions.length > 0) {
      questions.forEach((subQuestion, index) => {
        const firstAnswer = subQuestion.answers?.[0];
        const answerText = typeof firstAnswer === 'string' ? firstAnswer : firstAnswer?.text || 'N/A';
        doc.fontSize(10).text(`${index + 1}. ${answerText}`, { indent: 20 });
      });
    } else {
      doc.fontSize(10).text(question.correctAnswer || 'N/A', { indent: 20 });
    }
  } else if (question.type === 'documentation-tool') {
    doc.fontSize(10).text('Instructor-reviewed documentation activity; responses will vary.', { indent: 20 });
  } else if (question.type === 'summary') {
    const keyPoints = question.content?.keyPoints || [];
    if (keyPoints.length > 0) {
      keyPoints.forEach((keyPoint, index) => {
        const title = keyPoint?.title || `Knowledge point ${index + 1}`;
        const explanation = keyPoint?.explanation ? ` — ${keyPoint.explanation}` : '';
        doc.fontSize(9).text(`${index + 1}. ${title}${explanation}`, { indent: 20 });
      });
    } else {
      doc.fontSize(10).text(question.content?.summary || question.correctAnswer || question.explanation || 'N/A', { indent: 20 });
    }
  } else if (question.type === 'essay') {
    const sampleAnswer = question.content?.sampleAnswer || question.correctAnswer || question.explanation;
    doc.fontSize(10).text(sampleAnswer || 'Instructor-reviewed response; answers will vary.', { indent: 20 });

    const keywords = question.content?.keywords || [];
    if (keywords.length > 0) {
      doc.moveDown(0.3);
      doc.fontSize(9).font('Export-Bold').text('Suggested criteria:', { indent: 20 });
      addIndentedLines(doc, keywords.map(keyword => {
        if (typeof keyword === 'string') return keyword;
        return `${keyword.keyword || 'Criterion'}${keyword.points ? ` (${keyword.points} point${keyword.points === 1 ? '' : 's'})` : ''}`;
      }), 30, 9);
    }
  } else {
    doc.fontSize(10).text(question.correctAnswer || question.explanation || 'N/A', { indent: 20 });
  }

  if (question.explanation) {
    doc.moveDown(0.3);
    doc.fontSize(9).font('Export-Bold').text('Explanation:', { indent: 20 });
    doc.moveDown(0.2);
    doc.fontSize(9).font('Export-Regular').text(question.explanation, { indent: 30, width: 470 });
  }
}
