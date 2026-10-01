import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { CareApi } from './api/careApi';
import { BrowserTokenStore } from './api/tokens';
import { TrackingSocket } from './api/trackingSocket';
import { App } from './App';
import { createMessagingStore } from './messaging/react';
import { ConfirmProvider, FeedbackProvider } from './components/feedback';
import { ServicesProvider } from './state/context';
import { CareStore } from './state/careStore';
import './styles.css';

// One token store, one HTTP client, one socket for the whole app: one client
// owns refresh, and a second socket would be a second handshake presenting the
// same token.
const tokens = new BrowserTokenStore();
const api = new CareApi(tokens);
const tracking = new TrackingSocket(tokens);
const store = new CareStore(api);
const messaging = createMessagingStore(api);

const root = createRoot(document.getElementById('root')!);

// The stored session is restored *before* the first render, so the guard never
// sees a returning user as signed out and flashes the sign-in screen past them.
root.render(
  <div className="splash" role="progressbar" aria-label="Loading CareBridge">
    <div className="spinner" />
  </div>,
);

void store.restoreSession().then(() => {
  root.render(
    <StrictMode>
      <ServicesProvider services={{ store, api, tracking }}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <FeedbackProvider>
            <ConfirmProvider>
              <div className="app-frame">
                <App messaging={messaging} />
              </div>
            </ConfirmProvider>
          </FeedbackProvider>
        </BrowserRouter>
      </ServicesProvider>
    </StrictMode>,
  );
});
