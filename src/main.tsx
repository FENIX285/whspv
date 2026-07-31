import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

try {
  let currentFetch = window.fetch;
  Object.defineProperty(window, 'fetch', {
    get() {
      return currentFetch;
    },
    set(v) {
      currentFetch = v;
    },
    configurable: true,
    enumerable: true,
  });
} catch (e) {
  // Ignored if property is already defined or non-configurable
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

