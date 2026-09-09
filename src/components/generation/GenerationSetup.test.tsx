import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GenerationSetup from './GenerationSetup';
import type { DeliveryTarget, PedagogicalApproach, TargetFormat } from '../../constants/questionTypeCapabilities';

function Setup({ disabled = false }: { disabled?: boolean }) {
  const [approach, setApproach] = useState<PedagogicalApproach>('support');
  const [target, setTarget] = useState<DeliveryTarget>('h5p-package');
  const [format, setFormat] = useState<TargetFormat>('column');
  return <GenerationSetup approach={approach} onApproachChange={setApproach} deliveryTarget={target} targetFormat={format} onDeliveryTargetChange={value => { setTarget(value); setFormat(value === 'canvas-lti' ? 'mixed-activity' : 'column'); }} onTargetFormatChange={setFormat} disabled={disabled} />;
}

describe('Teaching purpose and layout preview', () => {
  it('presents the streams first, then all four ordered H5P layouts without changing the current selection', () => {
    const { container } = render(<Setup />);
    const groups = screen.getAllByRole('group');
    expect(within(groups[0]).getAllByRole('radio').map(input => input.getAttribute('aria-label'))).toEqual(['ASSESS', 'SUPPORT', 'GAMIFY']);
    const layouts = screen.getByRole('group', { name: 'H5P package layout' });
    expect(within(layouts).getAllByRole('radio').map(input => input.getAttribute('aria-label'))).toEqual(['Question Set', 'Interactive Book', 'Column', 'Standalone']);
    expect(screen.getByRole('radio', { name: 'Column', exact: true })).toBeChecked();
    expect(container.querySelectorAll('svg.generation-layout-preview')).toHaveLength(4);
    expect(screen.getByText('Chapters and pages')).toBeInTheDocument();
    expect(screen.getByText('One scrolling page')).toBeInTheDocument();
  });

  it('lets teachers select purpose and layout independently with accessible radio inputs', () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole('radio', { name: 'ASSESS' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Interactive Book', exact: true }));
    expect(screen.getByRole('radio', { name: 'ASSESS' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Interactive Book', exact: true })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'SUPPORT' })).not.toBeChecked();
  });

  it('keeps Canvas LTI separate from the four H5P package layouts', () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole('radio', { name: 'Canvas LTI', exact: true }));
    expect(screen.getByRole('radio', { name: 'Mixed Activity' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Question Set', exact: true })).not.toBeInTheDocument();
  });

  it('locks every choice while a generation or format change is in progress', () => {
    const onChange = vi.fn();
    render(<GenerationSetup approach="support" deliveryTarget="h5p-package" targetFormat="column" onApproachChange={onChange} onDeliveryTargetChange={onChange} onTargetFormatChange={onChange} disabled />);
    screen.getAllByRole('radio').forEach(input => expect(input).toBeDisabled());
  });
});
