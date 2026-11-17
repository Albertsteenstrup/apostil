// The start of the web pages: one root, and the page of the address.

import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
