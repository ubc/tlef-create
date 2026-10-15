import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FeatureCoachmark from './FeatureCoachmark';

const renderCoachmark = () => render(
  <FeatureCoachmark
    isOpen
    title="Tutorial title"
    description="Tutorial description"
    onPrimary={vi.fn()}
    onDismiss={vi.fn()}
    onSkip={vi.fn()}
  >
    <button>Anchor</button>
  </FeatureCoachmark>
);

describe('FeatureCoachmark', () => {
  it('shows the tutorial when no modal is open', () => {
    renderCoachmark();
    expect(screen.getByRole('dialog', { name: 'Tutorial title' })).toBeInTheDocument();
  });

  it('hides the tutorial while a modal is open and restores it after', async () => {
    renderCoachmark();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    await act(async () => { document.body.appendChild(overlay); });
    expect(screen.queryByRole('dialog', { name: 'Tutorial title' })).not.toBeInTheDocument();

    await act(async () => { overlay.remove(); });
    expect(screen.getByRole('dialog', { name: 'Tutorial title' })).toBeInTheDocument();
  });

  it('does not show the tutorial when it opens over an existing modal', () => {
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    renderCoachmark();
    expect(screen.queryByRole('dialog', { name: 'Tutorial title' })).not.toBeInTheDocument();
    modal.remove();
  });
});
