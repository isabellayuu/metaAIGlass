import {StrictMode} from 'react';
import {App} from '@wearables-ui-toolkit/mrbd';
import {createRoot} from 'react-dom/client';
import {LensApp} from './LensApp';
import './app.css';

function Root() {
  return (
    <App>
      <LensApp />
    </App>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
