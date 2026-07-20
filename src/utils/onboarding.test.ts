// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  completeOnboardingStep,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  readOnboardingState,
  restartOnboarding,
  skipOnboarding
} from './onboarding';

describe('feature onboarding state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with the current version and no completed steps', () => {
    expect(readOnboardingState()).toEqual({
      version: ONBOARDING_VERSION,
      completed: [],
      skipped: false
    });
  });

  it('records each completed step only once', () => {
    completeOnboardingStep('question-evidence');
    completeOnboardingStep('question-evidence');

    expect(readOnboardingState().completed).toEqual(['question-evidence']);
  });

  it('tracks the CREATE Guide tutorial independently', () => {
    completeOnboardingStep('create-guide');

    expect(readOnboardingState().completed).toEqual(['create-guide']);
  });

  it('tracks the objective enrichment tutorial independently', () => {
    completeOnboardingStep('objective-enrichment');

    expect(readOnboardingState().completed).toEqual(['objective-enrichment']);
  });

  it('can skip and restart the tutorial sequence', () => {
    completeOnboardingStep('course-materials');
    skipOnboarding();
    expect(readOnboardingState().skipped).toBe(true);

    restartOnboarding();
    expect(readOnboardingState()).toEqual({
      version: ONBOARDING_VERSION,
      completed: [],
      skipped: false
    });
  });

  it('resets stale tutorial state after a version change', () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      version: ONBOARDING_VERSION - 1,
      completed: ['export'],
      skipped: true
    }));

    expect(readOnboardingState()).toEqual({
      version: ONBOARDING_VERSION,
      completed: [],
      skipped: false
    });
  });
});
