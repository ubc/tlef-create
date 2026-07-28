import { expect, test } from '@playwright/test';

const apiBaseUrl = 'http://localhost:8051/api/create';

test('deleting a learning objective removes linked questions and refreshes every count', async ({ page, request }) => {
  test.setTimeout(60_000);
  let createdCourseId = '';

  try {
    const courseResponse = await request.post(`${apiBaseUrl}/folders`, {
      data: {
        name: `E2E Objective Delete ${Date.now()}`,
        quizCount: 1
      }
    });
    expect(courseResponse.status()).toBe(201);

    const courseBody = await courseResponse.json();
    createdCourseId = courseBody.data?.folder?._id || '';
    const quizId = courseBody.data?.folder?.quizzes?.[0]?._id || '';
    expect(createdCourseId).not.toBe('');
    expect(quizId).not.toBe('');

    const materialResponse = await request.post(`${apiBaseUrl}/materials/text`, {
      data: {
        folderId: createdCourseId,
        name: 'Cascade delete prerequisite',
        content: `Material assigned only to unlock the E2E workflow ${Date.now()}`
      }
    });
    expect(materialResponse.status()).toBe(201);
    const materialBody = await materialResponse.json();
    const materialId = materialBody.data?.material?._id || '';
    expect(materialId).not.toBe('');

    const assignmentResponse = await request.put(`${apiBaseUrl}/quizzes/${quizId}/materials`, {
      data: { materialIds: [materialId] }
    });
    expect(assignmentResponse.ok()).toBeTruthy();

    const objectivesResponse = await request.post(`${apiBaseUrl}/objectives?mode=append`, {
      data: [
        { quizId, text: 'Analyze the first test case', order: 0 },
        { quizId, text: 'Evaluate the second test case', order: 1 }
      ]
    });
    expect(objectivesResponse.ok()).toBeTruthy();

    const objectivesBody = await objectivesResponse.json();
    const deletedObjectiveId = objectivesBody.data?.objectives?.[0]?._id || '';
    const remainingObjectiveId = objectivesBody.data?.objectives?.[1]?._id || '';
    expect(deletedObjectiveId).not.toBe('');
    expect(remainingObjectiveId).not.toBe('');

    for (const [index, learningObjectiveId] of [
      deletedObjectiveId,
      remainingObjectiveId
    ].entries()) {
      const questionResponse = await request.post(`${apiBaseUrl}/questions`, {
        data: {
          quizId,
          learningObjectiveId,
          type: 'true-false',
          difficulty: 'moderate',
          questionText: `Cascade delete test question ${index + 1}`,
          content: {
            options: [
              { text: 'True', isCorrect: true },
              { text: 'False', isCorrect: false }
            ]
          },
          correctAnswer: true
        }
      });
      expect(questionResponse.status()).toBe(201);
    }

    await page.goto(`/course/${createdCourseId}/quiz/${quizId}?tab=objectives`);
    await expect(page.getByText('Course • 2 questions', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Delete learning objective 1' }).click();
    await expect(page.getByRole('heading', { name: 'Delete Learning Objective?' })).toBeVisible();
    await expect(page.getByText('This Learning Objective has 1 question(s) associated with it.')).toBeVisible();

    const deleteResponsePromise = page.waitForResponse(response => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/api/create/objectives/${deletedObjectiveId}?confirmed=true`)
    ));
    await page.getByRole('button', {
      name: 'Delete Learning Objective and 1 Question(s)'
    }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.ok()).toBeTruthy();

    await expect(page.getByText('Course • 1 questions', { exact: true })).toBeVisible();
    await expect(
      page.locator('.quiz-item.active').getByText('1 questions', { exact: true })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Review & Edit' }).click();
    await expect(page.getByText('1 questions total', { exact: true })).toBeVisible();

    const objectiveFilter = page.getByRole('combobox');
    await expect(objectiveFilter).toHaveCount(1);
    await expect(objectiveFilter.locator('option')).toHaveCount(2);
    await expect(objectiveFilter.locator('option').filter({ hasText: 'Unknown' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Generate Questions' }).click();
    await expect(page.getByRole('heading', { name: 'Questions Generated' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to AI Plan Configuration' }).click();
    await expect(page.locator('.plan-editor-row')).toHaveCount(1);
    await expect(page.locator('.plan-editor-row .count-input')).toHaveValue('1');

    await page.getByRole('button', { name: 'Coverage Map' }).click();
    await expect(page.locator('.knowledge-explorer-canvas')).toBeVisible();
    await expect(page.locator('.knowledge-explorer-canvas .react-flow__node').first()).toBeVisible();
    await expect.poll(async () => page.evaluate(() => {
      const canvas = document.querySelector('.knowledge-explorer-canvas');
      if (!canvas) return false;

      const canvasBounds = canvas.getBoundingClientRect();
      const visibleNodes = [...canvas.querySelectorAll<HTMLElement>('.react-flow__node')]
        .map(node => node.getBoundingClientRect())
        .filter(bounds => bounds.width > 0 && bounds.height > 0);

      return visibleNodes.length > 0 && visibleNodes.every(bounds => (
        bounds.left >= canvasBounds.left
        && bounds.top >= canvasBounds.top
        && bounds.right <= canvasBounds.right
        && bounds.bottom <= canvasBounds.bottom
      ));
    })).toBe(true);

    const questionsResponse = await request.get(`${apiBaseUrl}/questions/quiz/${quizId}`);
    expect(questionsResponse.ok()).toBeTruthy();
    const questionsBody = await questionsResponse.json();
    expect(questionsBody.data?.questions).toHaveLength(1);
    expect(questionsBody.data?.questions?.[0]?.learningObjective?._id).toBe(remainingObjectiveId);
  } finally {
    if (createdCourseId) {
      await request.delete(`${apiBaseUrl}/folders/${createdCourseId}`);
    }
  }
});
