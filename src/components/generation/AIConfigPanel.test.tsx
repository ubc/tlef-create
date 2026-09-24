import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AIConfigPanel from './AIConfigPanel';
import type { AIConfig } from './generationTypes';

function Form({ onGenerate }: { onGenerate: (count: number) => void }) {
  const [config, setConfig] = useState<AIConfig>({
    totalQuestions: 30, autoRecommendTotalQuestions: false, approach: 'support'
  });
  return <AIConfigPanel aiConfig={config} onConfigChange={setConfig}
    onGeneratePlan={() => onGenerate(config.totalQuestions)} isGenerating={false}
    learningObjectives={[0, 1, 2].map(index => ({ _id: String(index), text: 'Objective', order: index }))} />;
}

describe('fixed question count', () => {
  it.each(['2', '', '101', '3.5', '3xyz'])('blocks invalid visible input %s without generating the stale count', value => {
    const generate = vi.fn();
    render(<Form onGenerate={generate} />);
    fireEvent.change(screen.getByLabelText('How many questions do you want to generate?'), { target: { value } });
    fireEvent.blur(screen.getByLabelText('How many questions do you want to generate?'));
    expect(screen.getByRole('button', { name: 'Generate Plan' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('between 3 and 100');
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses the corrected visible number and allows automatic recommendation', () => {
    const generate = vi.fn();
    render(<Form onGenerate={generate} />);
    const count = screen.getByLabelText('How many questions do you want to generate?');
    fireEvent.change(count, { target: { value: '2' } });
    fireEvent.change(count, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Plan' }));
    expect(generate).toHaveBeenCalledWith(4);
    fireEvent.change(count, { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Generate Plan' })).toBeEnabled();
  });
});
