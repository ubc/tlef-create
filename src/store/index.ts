// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import appSlice from './slices/appSlice';
import quizSlice from './slices/quizSlice';
import materialSlice from './slices/materialSlice';
import learningObjectiveSlice from './slices/learningObjectiveSlice';
import planSlice from './slices/planSlice';
import questionSlice from './slices/questionSlice';
import { pubsubMiddleware } from './middleware/pubsubMiddleware';

export const store = configureStore({
  reducer: {
    app: appSlice,
    quiz: quizSlice,
    material: materialSlice,
    learningObjective: learningObjectiveSlice,
    plan: planSlice,
    question: questionSlice,
  },
  middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Ignore PubSub actions that might contain non-serializable data
          ignoredActions: ['PUBSUB_EVENT'],
        },
      }).concat(pubsubMiddleware),
});

// Expose store to window for debugging (development only)
if (import.meta.env.DEV) {
  (window as any).store = store;
  (window as any).getReduxState = () => store.getState();
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;