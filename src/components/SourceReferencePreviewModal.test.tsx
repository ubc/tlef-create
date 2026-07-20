import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SourceReferencePreviewModal from './SourceReferencePreviewModal';

const mocks = vi.hoisted(() => ({
  getReference: vi.fn(),
  getSourceFile: vi.fn()
}));

vi.mock('../services/api', () => ({
  materialsApi: mocks
}));

vi.mock('./PdfPagePreview', () => ({
  default: ({ initialPage, excerpt }: { initialPage: number; excerpt: string }) => (
    <div data-testid="pdf-preview" data-page={initialPage} data-excerpt={excerpt} />
  )
}));

describe('SourceReferencePreviewModal material previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the complete extracted URL text without citation-only UI', async () => {
    mocks.getReference.mockResolvedValue({
      materialId: 'material-1',
      materialName: 'Course webpage',
      materialType: 'url',
      chunkIndex: 0,
      excerpt: '',
      pageContext: 'Course heading\n\nA cleaned first paragraph.\n\nA cleaned second paragraph.',
      hasSourceFile: false,
      sourceUrl: 'https://example.com/course',
      previewKind: 'url'
    });

    render(
      <SourceReferencePreviewModal
        mode="material"
        reference={{ materialId: 'material-1', materialName: 'Course webpage' }}
        onClose={vi.fn()}
      />
    );

    expect(await screen.findByText('A cleaned first paragraph.', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open original webpage/i })).toHaveAttribute(
      'href',
      'https://example.com/course'
    );
    expect(screen.queryByText('Cited passage')).not.toBeInTheDocument();
    expect(mocks.getReference).toHaveBeenCalledWith(expect.objectContaining({
      materialId: 'material-1',
      previewMode: 'material'
    }));
  });

  it('opens an uploaded PDF in the shared PDF viewer from page one', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:course-pdf');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    mocks.getReference.mockResolvedValue({
      materialId: 'material-2',
      materialName: 'Lecture notes',
      materialType: 'pdf',
      chunkIndex: 0,
      pageCount: 8,
      excerpt: '',
      pageContext: 'Extracted first page.',
      hasSourceFile: true,
      mimeType: 'application/pdf',
      previewKind: 'pdf'
    });
    mocks.getSourceFile.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));

    const { unmount } = render(
      <SourceReferencePreviewModal
        mode="material"
        reference={{ materialId: 'material-2', materialName: 'Lecture notes' }}
        onClose={vi.fn()}
      />
    );

    const preview = await screen.findByTestId('pdf-preview');
    expect(preview).toHaveAttribute('data-page', '1');
    expect(preview).toHaveAttribute('data-excerpt', '');
    expect(screen.getByRole('link', { name: /open full pdf/i })).toHaveAttribute('href', 'blob:course-pdf#page=1');

    unmount();
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:course-pdf'));
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
  });
});
