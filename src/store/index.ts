// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import appSlice from './slices/appSlice';
import quizSlice from './slices/quizSlice';
import materialSlice from './slices/materialSlice';
import learningObjectiveSlice from './slices/learningObjectiveSlice';
import planSlice from './slices/planSlice';
import { pubsubMiddleware, setupPubSubListeners } from './middleware/pubsubMiddleware';

export const store = configureStore({
  reducer: {
    app: appSlice,
    quiz: quizSlice,
    material: materialSlice,
    learningObjective: learningObjectiveSlice,
    plan: planSlice,
  },
  middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          // Ignore PubSub actions that might contain non-serializable data
          ignoredActions: ['PUBSUB_EVENT'],
        },
      }).concat(pubsubMiddleware),
});

// Setup PubSub listeners after store creation
setupPubSubListeners(store.dispatch);

// Expose store to window for debugging (development only)
if (import.meta.env.DEV) {
  (window as any).store = store;
  (window as any).getReduxState = () => store.getState();
  console.log('🔧 Redux store exposed to window.store for debugging');
}

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;