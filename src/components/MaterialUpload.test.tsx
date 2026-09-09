import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MaterialUpload from './MaterialUpload';

const mocks = vi.hoisted(() => ({
  getAllowedDomains: vi.fn(),
  reprocessMaterial: vi.fn(),
  showNotification: vi.fn()
}));

vi.mock('../services/api', () => ({
  materialsApi: {
    getAllowedDomains: mocks.getAllowedDomains,
    reprocessMaterial: mocks.reprocessMaterial
  }
}));

vi.mock('../hooks/usePubSub', () => ({
  usePubSub: () => ({ showNotification: mocks.showNotification })
}));

vi.mock('../hooks/useFeatureOnboarding', () => ({
  useFeatureOnboarding: () => ({
    isActive: false,
    complete: vi.fn(),
    skipAll: vi.fn()
  })
}));

vi.mock('./onboarding/FeatureCoachmark', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock('./SourceReferencePreviewModal', () => ({
  default: ({ mode, reference }: { mode: string; reference: { materialId: string; materialName: string } }) => (
    <div data-testid="material-preview-modal" data-mode={mode}>
      {reference.materialId}:{reference.materialName}
    </div>
  )
}));

describe('MaterialUpload preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllowedDomains.mockResolvedValue({ domains: null });
    mocks.reprocessMaterial.mockResolvedValue({ material: {} });
  });

  it('routes the eye action through the shared material preview', () => {
    render(
      <MaterialUpload
        materials={[{
          id: '64b7f1d4e5a6b7c8d9e0f123',
          name: 'week-3-notes',
          type: 'pdf',
          uploadDate: '2026/7/20',
          processingStatus: 'completed'
        }]}
        onAddMaterial={vi.fn()}
        onRemoveMaterial={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTitle('Preview content'));

    const preview = screen.getByTestId('material-preview-modal');
    expect(preview).toHaveAttribute('data-mode', 'material');
    expect(preview).toHaveTextContent('64b7f1d4e5a6b7c8d9e0f123:week-3-notes');
  });

  it('shows the processing failure and lets the instructor retry', async () => {
    const onMaterialReprocessed = vi.fn();
    render(
      <MaterialUpload
        materials={[{
          id: '64b7f1d4e5a6b7c8d9e0f123',
          name: 'week-3-notes',
          type: 'pdf',
          uploadDate: '2026/9/3',
          processingStatus: 'failed',
          processingError: 'Failed to embed any chunks'
        }]}
        onAddMaterial={vi.fn()}
        onRemoveMaterial={vi.fn()}
        onMaterialReprocessed={onMaterialReprocessed}
      />
    );

    expect(screen.getByText('Processing failed')).toBeInTheDocument();
    expect(screen.getByText('Failed to embed any chunks')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => expect(mocks.reprocessMaterial).toHaveBeenCalledWith('64b7f1d4e5a6b7c8d9e0f123'));
    await vi.waitFor(() => expect(onMaterialReprocessed).toHaveBeenCalled());
  });
});
