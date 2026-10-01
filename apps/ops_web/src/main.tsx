import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { OpsApi } from './api/opsApi';
import { BrowserTokenStore } from './api/tokens';
import { App } from './App';
import { createMessagingStore } from './messaging/react';
import { ConfirmProvider, FeedbackProvider } from './components/feedback';
import { StoreProvider } from './state/context';
import { OpsStore } from './state/opsStore';
import './styles.css';

// One token store and one client, because one client owns refresh.
const api = new OpsApi(new BrowserTokenStore());
const store = new OpsStore(api);
const messaging = createMessagingStore(api);

// Restored before the first render, so a returning dispatcher never sees
// sign-in flash past them.
store.restoreSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <FeedbackProvider>
          <ConfirmProvider>
            <App messaging={messaging} />
          </ConfirmProvider>
        </FeedbackProvider>
      </BrowserRouter>
    </StoreProvider>
  </StrictMode>,
);
