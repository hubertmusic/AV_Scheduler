import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './fonts.js';
import './styles.css';
import './theme.css'; // team colours, fonts and headers on top of the base styles

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
