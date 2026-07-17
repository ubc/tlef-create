export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STORAGE_KEY = 'create-feature-onboarding';
export const ONBOARDING_CHANGED_EVENT = 'create:onboarding-changed';

export type OnboardingStep =
  | 'course-materials'
  | 'quiz-materials'
  | 'learning-objectives'
  | 'delivery-format'
  | 'ai-blueprint'
  | 'question-evidence'
  | 'export';

interface OnboardingState {
  version: number;
  completed: OnboardingStep[];
  skipped: boolean;
}

const defaultState = (): OnboardingState => ({
  version: ONBOARDING_VERSION,
  completed: [],
  skipped: false
});

export const readOnboardingState = (): OnboardingState => {
  if (typeof window === 'undefined') return defaultState();

  try {
    const stored = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!stored) return defaultState();

    const parsed = JSON.parse(stored) as Partial<OnboardingState>;
    if (parsed.version !== ONBOARDING_VERSION) return defaultState();

    return {
      version: ONBOARDING_VERSION,
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      skipped: parsed.skipped === true
    };
  } catch {
    return defaultState();
  }
};

const writeOnboardingState = (state: OnboardingState) => {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGED_EVENT));
};

export const completeOnboardingStep = (step: OnboardingStep) => {
  const state = readOnboardingState();
  if (state.completed.includes(step)) return;

  writeOnboardingState({
    ...state,
    completed: [...state.completed, step]
  });
};

export const skipOnboarding = () => {
  writeOnboardingState({
    ...readOnboardingState(),
    skipped: true
  });
};

export const restartOnboarding = () => {
  writeOnboardingState(defaultState());
};
