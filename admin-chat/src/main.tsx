import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ChatPanel from './ChatPanel';
import './ChatPanel.css';

const container = document.getElementById('chat-root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <ChatPanel />
    </StrictMode>
  );
}
