// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import appSlice from './slices/appSlice';
import { pubsubMiddleware, setupPubSubListeners } from './middleware/pubsubMiddleware';

export const store = configureStore({
  reducer: {
    app: appSlice,
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

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;