import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SystemDialogProvider, useSystemDialog } from './SystemDialogProvider';

function DialogHarness() {
  const { showAlert, showConfirm } = useSystemDialog();
  const [result, setResult] = useState('');

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void showConfirm({
            title: 'Delete this item?',
            description: 'This item will be permanently deleted.',
            confirmLabel: 'Delete item',
            cancelLabel: 'Keep item',
            tone: 'danger'
          }).then(confirmed => setResult(String(confirmed)));
        }}
      >
        Open confirmation
      </button>
      <button
        type="button"
        onClick={() => {
          void showAlert({
            title: 'Saved',
            description: 'Your changes were saved.',
            confirmLabel: 'Done',
            tone: 'success'
          }).then(() => setResult('closed'));
        }}
      >
        Open alert
      </button>
      <output aria-label="dialog result">{result}</output>
    </>
  );
}

describe('SystemDialogProvider', () => {
  it('resolves a destructive confirmation when the action is accepted', async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));

    expect(screen.getByRole('alertdialog', { name: 'Delete this item?' })).toBeInTheDocument();
    expect(screen.getByText('This item will be permanently deleted.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));

    await waitFor(() => {
      expect(screen.getByLabelText('dialog result')).toHaveTextContent('true');
    });
  });

  it('resolves a confirmation as false when it is cancelled', async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep item' }));

    await waitFor(() => {
      expect(screen.getByLabelText('dialog result')).toHaveTextContent('false');
    });
  });

  it('shows success alerts and catches legacy browser alerts', async () => {
    const nativeAlert = window.alert;

    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>
    );

    expect(window.alert).not.toBe(nativeAlert);
    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
    expect(screen.getByRole('alertdialog', { name: 'Saved' })).toHaveClass('system-dialog-success');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.getByLabelText('dialog result')).toHaveTextContent('closed');
    });

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog', { name: 'Saved' })).not.toBeInTheDocument();
    });
    act(() => window.alert('Embedded editor warning'));
    expect(await screen.findByRole('alertdialog', { name: 'Notice' })).toBeInTheDocument();
    expect(screen.getByText('Embedded editor warning')).toBeInTheDocument();
  });

  it('queues dialogs so simultaneous notices are not lost', async () => {
    render(
      <SystemDialogProvider>
        <DialogHarness />
      </SystemDialogProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
    act(() => window.alert('Second notice'));

    expect(screen.getByRole('alertdialog', { name: 'Saved' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByRole('alertdialog', { name: 'Notice' })).toBeInTheDocument();
    expect(screen.getByText('Second notice')).toBeInTheDocument();
  });
});
