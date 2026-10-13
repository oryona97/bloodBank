import React from 'react';
import ReactDOM from 'react-dom/client';
import { BecsApp as App } from './BecsApp.js';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
