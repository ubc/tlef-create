import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminActivityPanel from './AdminActivityPanel';
import { adminApi } from '../../services/api';

vi.mock('../../services/api', () => ({
  adminApi: {
    getActivity: vi.fn()
  }
}));

describe('AdminActivityPanel', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getActivity).mockResolvedValue({
      data: {
        actions: ['plan.generate_ai'],
        events: [{
          _id: 'event-1',
          actor: { _id: 'user-1', cwlId: 'faculty-user' },
          action: 'plan.generate_ai',
          resourceType: 'plan',
          status: 'failed',
          route: '/plans/generate-ai',
          method: 'POST',
          statusCode: 502,
          requestId: 'request-123',
          metadata: {
            errorCode: 'AI_OUTPUT_INCOMPLETE',
            errorStage: 'llm',
            provider: 'openai',
            model: 'gpt-5.4-nano',
            attempt: 2,
            durationMs: 2345
          },
          createdAt: '2026-07-22T20:00:00.000Z'
        }]
      }
    });
  });

  it('reveals privacy-safe failure diagnostics when an event is expanded', async () => {
    render(<AdminActivityPanel />);

    const eventButton = await screen.findByRole('button', { name: /plan\.generate_ai/i });
    expect(eventButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(eventButton);

    expect(eventButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('/plans/generate-ai')).toBeInTheDocument();
    expect(screen.getByText('AI_OUTPUT_INCOMPLETE')).toBeInTheDocument();
    expect(screen.getByText('openai / gpt-5.4-nano')).toBeInTheDocument();
    expect(screen.getByText('request-123')).toBeInTheDocument();
  });
});
