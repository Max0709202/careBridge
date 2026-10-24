import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { OpsApi } from './api/opsApi';
import { BrowserTokenStore } from './api/tokens';
import { TrackingSocket } from './api/trackingSocket';
import { App } from './App';
import { createMessagingStore } from './messaging/react';
import { ConfirmProvider, FeedbackProvider } from './components/feedback';
import { StoreProvider } from './state/context';
import { OpsStore } from './state/opsStore';
import { TrackingProvider } from './state/tracking';
import './styles.css';

// One token store and one client, because one client owns refresh.
const api = new OpsApi(new BrowserTokenStore());
const store = new OpsStore(api);
const messaging = createMessagingStore(api);
// Shares the client's token store, so a refreshed token is the one presented.
const tracking = new TrackingSocket(api.tokens);

// Restored before the first render, so a returning dispatcher never sees
// sign-in flash past them.
store.restoreSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <TrackingProvider socket={tracking}>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <FeedbackProvider>
            <ConfirmProvider>
              <App messaging={messaging} />
            </ConfirmProvider>
          </FeedbackProvider>
        </BrowserRouter>
      </TrackingProvider>
    </StoreProvider>
  </StrictMode>,
);
