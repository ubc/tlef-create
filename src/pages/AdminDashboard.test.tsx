import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard';
import appReducer, { setUser, type UserInfo } from '../store/slices/appSlice';

const api = vi.hoisted(() => ({ getStats: vi.fn(), getReports: vi.fn(), getUsers: vi.fn() }));
vi.mock('../services/api', () => ({ adminApi: api }));
vi.mock('../components/system-dialog/SystemDialogProvider', () => ({
  useSystemDialog: () => ({ showAlert: vi.fn(), showConfirm: vi.fn() })
}));
vi.mock('../components/admin/AdminActivityPanel', () => ({ default: () => null }));
vi.mock('../components/admin/AdminGuideInsightsPanel', () => ({ default: () => null }));
vi.mock('../components/admin/AdminUserExplorer', () => ({ default: () => null }));

const profile = (isAdmin: boolean): UserInfo => ({
  id: 'u1', cwlId: 'qa-user', displayName: 'QA', isAdmin,
  stats: { coursesCreated: 0, quizzesGenerated: 0, questionsCreated: 0, totalUsageTime: 0 }
});
function renderAdmin() {
  const store = configureStore({ reducer: { app: appReducer } });
  render(<Provider store={store}><MemoryRouter initialEntries={['/admin']}><Routes>
    <Route path="/admin" element={<AdminDashboard />} />
    <Route path="/account" element={<p>Account destination</p>} />
  </Routes></MemoryRouter></Provider>);
  return store;
}

describe('admin profile hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getStats.mockResolvedValue({ data: { platform: {}, users: [] } });
    api.getReports.mockResolvedValue({ data: { reports: [] } });
    api.getUsers.mockResolvedValue({ data: { users: [] } });
  });

  it('stays on the page until the authenticated admin profile is ready', async () => {
    const store = renderAdmin();
    expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
    expect(api.getStats).not.toHaveBeenCalled();
    act(() => store.dispatch(setUser(profile(true))));
    await waitFor(() => expect(api.getStats).toHaveBeenCalledOnce());
    expect(await screen.findByText('Current saved content per user. Deleted items are excluded.')).toBeInTheDocument();
    expect(screen.queryByText('Account destination')).not.toBeInTheDocument();
  });

  it('shows released names and email while retaining login IDs and missing-attribute fallbacks', async () => {
    const named = { _id: 'p1', cwlId: 'PUID-123', cwlUsername: 'ada-cwl', displayName: 'Professor Ada', email: 'ada@example.test' };
    const unnamed = { _id: 'p2', cwlId: 'PUID-456', displayName: null, email: null };
    api.getStats.mockResolvedValue({ data: { platform: {}, users: [named, unnamed].map(identity => ({ ...identity, coursesCreated: 2, quizzesGenerated: 1, questionsCreated: 4 })) } });
    api.getUsers.mockResolvedValue({ data: { users: [named, unnamed].map(identity => ({ ...identity, canUseEnvKey: false })) } });
    api.getReports.mockResolvedValue({ data: { reports: [{ _id: 'report1', reporter: named, type: 'bug', status: 'open', description: 'Example issue', createdAt: '2026-09-30T12:00:00Z' }] } });
    const store = renderAdmin();
    act(() => store.dispatch(setUser(profile(true))));
    const name = await screen.findByText('Professor Ada');
    const row = within(name.closest('tr')!);
    expect(row.getByText('ada@example.test')).toBeInTheDocument();
    expect(row.getByText('Login ID: PUID-123')).toBeInTheDocument();
    expect(row.getByText('CWL: ada-cwl')).toBeInTheDocument();
    expect(screen.getByText('Login ID: PUID-456')).toBeInTheDocument();
    expect(screen.getByText('Email unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'API Keys' }));
    expect(screen.getByText('Professor Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
    expect(screen.getByText('Login ID: PUID-123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Bug Reports/ }));
    expect(screen.getByText('Professor Ada')).toBeInTheDocument();
    expect(screen.getByText('ada@example.test')).toBeInTheDocument();
  });

  it('redirects a resolved non-admin without requesting administrative data', async () => {
    const store = renderAdmin();
    act(() => store.dispatch(setUser(profile(false))));
    expect(await screen.findByText('Account destination')).toBeInTheDocument();
    expect(api.getStats).not.toHaveBeenCalled();
  });
});
