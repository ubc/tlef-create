import { useCallback, useEffect, useState } from 'react';
import {
  completeOnboardingStep,
  ONBOARDING_CHANGED_EVENT,
  OnboardingStep,
  readOnboardingState,
  skipOnboarding
} from '../utils/onboarding';

export const useFeatureOnboarding = (step: OnboardingStep, enabled = true) => {
  const [state, setState] = useState(readOnboardingState);

  useEffect(() => {
    const refresh = () => setState(readOnboardingState());
    window.addEventListener(ONBOARDING_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);

    return () => {
      window.removeEventListener(ONBOARDING_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const complete = useCallback(() => completeOnboardingStep(step), [step]);
  const skipAll = useCallback(() => skipOnboarding(), []);
  const isCompleted = state.completed.includes(step);

  return {
    isActive: enabled && !state.skipped && !isCompleted,
    isCompleted,
    complete,
    skipAll
  };
};

