import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { DriverApi } from './api/driverApi';
import { BrowserTokenStore } from './api/tokens';
import { App } from './App';
import { createMessagingStore } from './messaging/react';
import { ConfirmProvider, FeedbackProvider } from './components/feedback';
import { LocationService } from './services/locationService';
import {
  BrowserBatterySource,
  BrowserPositionSource,
  BrowserScreenKeeper,
} from './services/positionSource';
import { StoreProvider } from './state/context';
import { DriverStore } from './state/driverStore';
import './styles.css';

// One token store, one client (one client owns refresh), one location service.
const tokens = new BrowserTokenStore();
const api = new DriverApi(tokens);
const location = new LocationService({
  api,
  positions: new BrowserPositionSource(),
  battery: new BrowserBatterySource(),
  screen: new BrowserScreenKeeper(),
});
const store = new DriverStore(api, location);
const messaging = createMessagingStore(api);

const root = createRoot(document.getElementById('root')!);

root.render(
  <div className="splash" role="progressbar" aria-label="Loading CareBridge">
    <div className="spinner" />
  </div>,
);

// Restored before the first render, so a returning driver never sees sign-in
// flash past them.
void store.restoreSession().then(() => {
  root.render(
    <StrictMode>
      <StoreProvider store={store}>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <FeedbackProvider>
            <ConfirmProvider>
              <App messaging={messaging} />
            </ConfirmProvider>
          </FeedbackProvider>
        </BrowserRouter>
      </StoreProvider>
    </StrictMode>,
  );
});
