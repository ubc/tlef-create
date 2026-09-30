import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminUserExplorer from './AdminUserExplorer';

const api = vi.hoisted(() => ({ getUserCourses: vi.fn() }));
vi.mock('../../services/api', () => ({ adminApi: api }));

const users = [
  { _id: 'a', cwlId: 'PUID-A', cwlUsername: 'ada-login', displayName: 'Professor Ada', email: 'ada@example.test' },
  { _id: 'b', cwlId: 'PUID-B', displayName: null, email: null }
];

describe('administrator user explorer identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getUserCourses.mockResolvedValue({ data: { courses: [] } });
  });

  it.each(['Professor Ada', 'ada@example.test', 'PUID-A', 'ada-login'])('finds the same account by %s and keeps ownership lookup bound to its database ID', async query => {
    render(<AdminUserExplorer users={users} />);
    fireEvent.change(screen.getByPlaceholderText('Find a user'), { target: { value: query } });
    const userButton = screen.getByRole('button', { name: /Professor Ada/ });
    expect(within(userButton).getByText('ada@example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PUID-B/ })).not.toBeInTheDocument();
    fireEvent.click(userButton);
    expect(await screen.findByText('This user has no courses.')).toBeInTheDocument();
    expect(api.getUserCourses).toHaveBeenCalledWith('a');
    expect(screen.getByRole('heading', { name: 'Professor Ada' })).toBeInTheDocument();
  });

  it('keeps an account with no released name or email identifiable', () => {
    render(<AdminUserExplorer users={[users[1]]} />);
    expect(screen.getByRole('button', { name: /Login ID: PUID-B Email unavailable/ })).toBeInTheDocument();
  });
});
