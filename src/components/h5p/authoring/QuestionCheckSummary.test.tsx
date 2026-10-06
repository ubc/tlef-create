import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import QuestionCheckSummary from './QuestionCheckSummary';

describe('recorded question checks', () => {
  it('does not infer a check for an older question without a record', () => {
    const { container } = render(<QuestionCheckSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows only recorded verdicts and the actual arithmetic count', () => {
    render(<QuestionCheckSummary summary={{ kind: 'semantic', policyVersion: 'v1',
      checks: { answerIsCorrect: true, evidenceIsSufficient: false }, arithmeticChecks: 2, mediaInspection: 'not-performed' }} />);
    expect(screen.getByText('Answer: passed')).toBeInTheDocument();
    expect(screen.getByText('Supporting evidence: needs review')).toBeInTheDocument();
    expect(screen.queryByText('Assessment criteria: passed')).not.toBeInTheDocument();
    expect(screen.getByText('2 declared arithmetic calculations verified.')).toBeInTheDocument();
  });
});
