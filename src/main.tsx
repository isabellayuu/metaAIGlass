import {StrictMode} from 'react';
import {App} from '@wearables-ui-toolkit/mrbd';
import {createRoot} from 'react-dom/client';
import {MathPage} from './MathPage';
import './app.css';

function Root() {
  return (
    <App>
      <MathPage />
    </App>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
