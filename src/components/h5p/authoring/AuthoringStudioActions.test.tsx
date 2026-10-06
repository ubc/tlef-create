import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AuthoringStudioActions from './AuthoringStudioActions';

function mount({ disabled = false, importing = false } = {}) {
  const callbacks = { import: vi.fn(), blank: vi.fn(), advanced: vi.fn(), course: vi.fn() };
  render(<>
    <button>Before actions</button>
    <AuthoringStudioActions disabled={disabled} importing={importing}
      onImport={callbacks.import} onNewBlank={callbacks.blank}
      onAdvanced={callbacks.advanced} onReturnCoursePlan={callbacks.course} />
    <button>After actions</button>
  </>);
  return { callbacks, user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'More Studio actions' }) };
}

const panel = () => screen.getByRole('group', { name: 'Other Studio actions' });

describe('AuthoringStudioActions', () => {
  it('supports Tab through its actions and closes when focus leaves without moving focus back', async () => {
    const { user, trigger } = mount();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Before actions' })).toHaveFocus();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).toHaveAttribute('id', trigger.getAttribute('aria-controls'));

    for (const name of ['Import .h5p', 'New blank activity', 'Advanced types', 'Return to course plan']) {
      await user.tab();
      expect(within(panel()).getByRole('button', { name })).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    }
    await user.tab();
    expect(screen.getByRole('button', { name: 'After actions' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger without invoking an action', async () => {
    const { callbacks, user, trigger } = mount();
    await user.click(trigger);
    await user.tab();
    expect(within(panel()).getByRole('button', { name: 'Import .h5p' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('closes on an outside click while leaving focus on the outside target', async () => {
    const { callbacks, user, trigger } = mount();
    await user.click(trigger);
    await user.tab();
    const outside = screen.getByRole('button', { name: 'After actions' });
    await user.click(outside);
    expect(outside).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it.each([
    ['Import .h5p', 'import'],
    ['New blank activity', 'blank'],
    ['Advanced types', 'advanced'],
    ['Return to course plan', 'course'],
  ] as const)('runs %s exactly once and closes its disclosure', async (name, action) => {
    const { callbacks, user, trigger } = mount();
    await user.click(trigger);
    await user.click(within(panel()).getByRole('button', { name }));
    expect(callbacks[action]).toHaveBeenCalledTimes(1);
    for (const [key, callback] of Object.entries(callbacks)) {
      if (key !== action) expect(callback).not.toHaveBeenCalled();
    }
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
  });

  it('activates an action with Space after keyboard navigation', async () => {
    const { callbacks, user, trigger } = mount();
    await user.tab();
    await user.tab();
    await user.keyboard(' ');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    await user.tab();
    expect(within(panel()).getByRole('button', { name: 'New blank activity' })).toHaveFocus();
    await user.keyboard(' ');
    expect(callbacks.blank).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('group', { name: 'Other Studio actions' })).not.toBeInTheDocument();
  });

  it('disables every action while busy and skips them in the Tab order', async () => {
    const { callbacks, user, trigger } = mount({ disabled: true });
    await user.click(trigger);
    for (const button of within(panel()).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'After actions' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Import .h5p', 'New blank activity', 'Advanced types', 'Return to course plan']) {
      if (trigger.getAttribute('aria-expanded') !== 'true') await user.click(trigger);
      await user.click(within(panel()).getByRole('button', { name }));
    }
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  });

  it('disables import while importing and keeps the remaining actions keyboard accessible', async () => {
    const { callbacks, user, trigger } = mount({ importing: true });
    await user.click(trigger);
    const importing = within(panel()).getByRole('button', { name: 'Importing…' });
    expect(importing).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: 'New blank activity' })).toBeEnabled();
    expect(within(panel()).getByRole('button', { name: 'Advanced types' })).toBeEnabled();
    await user.tab();
    expect(within(panel()).getByRole('button', { name: 'New blank activity' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(callbacks.blank).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    await user.click(within(panel()).getByRole('button', { name: 'Importing…' }));
    expect(callbacks.import).not.toHaveBeenCalled();
    expect(callbacks.blank).toHaveBeenCalledTimes(1);
  });
});
