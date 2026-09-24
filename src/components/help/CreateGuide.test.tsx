import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ONBOARDING_STORAGE_KEY, readOnboardingState } from '../../utils/onboarding';
import CreateGuide from './CreateGuide';

describe('CREATE Guide tutorial', () => {
  beforeEach(() => {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    window.sessionStorage.clear();
  });

  it('introduces the launcher and opens the guide from the tutorial', () => {
    render(
      <MemoryRouter initialEntries={['/course/course-1']}>
        <CreateGuide />
      </MemoryRouter>
    );

    expect(screen.getByRole('dialog', { name: 'Meet your CREATE Guide' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try CREATE Guide' }));

    expect(screen.getByRole('dialog', { name: 'CREATE Guide' })).toBeInTheDocument();
    expect(readOnboardingState().completed).toContain('create-guide');
  });

  it('completes the tutorial when the launcher itself is selected', () => {
    render(
      <MemoryRouter>
        <CreateGuide />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open CREATE Guide' }));

    expect(screen.queryByRole('dialog', { name: 'Meet your CREATE Guide' })).not.toBeInTheDocument();
    expect(readOnboardingState().completed).toContain('create-guide');
  });

  it('keeps every citation navigable when a combined answer has more than three sources', () => {
    const sections = ['Question type catalogue', 'PDF and Markdown export', 'H5P export', 'Canvas export'];
    window.sessionStorage.setItem('tlef-create-guide-messages', JSON.stringify([{
      id: 'combined-answer', role: 'assistant', content: 'Types [1], handouts [2], H5P [3], Canvas [4].',
      sources: sections.map((section, index) => ({
        id: `source-${index}`, citationIndex: index + 1, title: 'Product help', section,
        documentId: 'review-and-export', sectionId: `section-${index}`,
        navigationPath: `/help?doc=review-and-export&section=section-${index}`
      }))
    }]));
    render(<MemoryRouter><CreateGuide /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Open CREATE Guide' }));
    expect(screen.getAllByRole('link', { name: /Open Product help/ })).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Open Product help, Canvas export in the Help Center' }))
      .toHaveAttribute('href', '/help?doc=review-and-export&section=section-3');
  });
});
