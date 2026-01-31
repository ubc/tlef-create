import { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore, PreloadedState } from '@reduxjs/toolkit';
import { RootState, AppStore } from '../store';
import appReducer from '../store/slices/appSlice';
import learningObjectiveReducer from '../store/slices/learningObjectiveSlice';
import materialReducer from '../store/slices/materialSlice';
import planReducer from '../store/slices/planSlice';
import quizReducer from '../store/slices/quizSlice';

interface ExtendedRenderOptions extends Omit<RenderOptions, 'queries'> {
  preloadedState?: PreloadedState<RootState>;
  store?: AppStore;
}

export function renderWithProviders(
  ui: ReactElement,
  {
    preloadedState = {},
    store = configureStore({
      reducer: {
        app: appReducer,
        learningObjective: learningObjectiveReducer,
        material: materialReducer,
        plan: planReducer,
        quiz: quizReducer,
      },
      preloadedState,
    }),
    ...renderOptions
  }: ExtendedRenderOptions = {}
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  }

  return { store, ...render(ui, { wrapper: Wrapper, ...renderOptions }) };
}

export * from '@testing-library/react';
export { renderWithProviders as render };
