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
});
