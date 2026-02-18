// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import appSlice from './slices/appSlice';
import quizSlice from './slices/quizSlice';
import materialSlice from './slices/materialSlice';
import learningObjectiveSlice from './slices/learningObjectiveSlice';
import planSlice from './slices/planSlice';
import questionSlice from './slices/questionSlice';
import uploadSlice from './slices/uploadSlice';
import { pubsubMiddleware } from './middleware/pubsubMiddleware';

export const store = configureStore({
  reducer: {
    app: appSlice,
    quiz: quizSlice,
    material: materialSlice,
    learningObjective: learningObjectiveSlice,
    plan: planSlice,
    question: questionSlice,
    upload: uploadSlice,
  },
  middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Ignore PubSub actions that might contain non-serializable data
          ignoredActions: [
            'PUBSUB_EVENT',
            'upload/addMaterialsToQueue', // Contains File objects
          ],
          // Ignore File objects in upload state
          ignoredPaths: ['upload.uploadQueues'],
          // Ignore File objects in action payloads
          ignoredActionPaths: ['payload.materials', 'meta.arg'],
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