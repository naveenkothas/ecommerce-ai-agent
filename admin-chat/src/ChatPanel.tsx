import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';

const BOT_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="7" r="4" />
    <line x1="9" y1="21" x2="9" y2="17" />
    <line x1="15" y1="21" x2="15" y2="17" />
  </svg>
);

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const CLEAR_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 .49-3.85" />
  </svg>
);

const CHAT_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
  </svg>
);

const CLOSE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const EXAMPLE_PROMPTS = [
  'Show me all pending orders',
  'What is our total revenue and how many orders?',
  'How many units of HP-BLK-001 are in stock?',
  'Which products are running low on stock?',
  'Mark order ORD-1003 as shipped',
  'Check the details of order ORD-1004',
  'Change the price of RS-GRY-9 to $129.99',
  'We received 50 units of TS-NVY-M — add them to inventory',
  'Cancel order ORD-1008, customer changed their mind',
  'What is the stock level for the Smart Fitness Watch?',
];

function TypingIndicator() {
  return (
    <div className="ac-message ac-message--assistant">
      <div className="ac-avatar ac-avatar--bot">{BOT_ICON}</div>
      <div className="ac-bubble ac-bubble--assistant">
        <div className="ac-typing">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

function friendlyError(err: Error): string {
  const msg = err?.message ?? '';
  if (
    msg.includes('503') ||
    msg.includes('AGENT_UNAVAILABLE') ||
    msg.toLowerCase().includes('ollama') ||
    msg.toLowerCase().includes('unavailable')
  ) {
    return 'The assistant is currently offline. Please ensure Ollama is running and try again.';
  }
  if (msg.toLowerCase().includes('too long')) {
    return 'Your message is too long. Please shorten it and try again.';
  }
  if (msg.toLowerCase().includes('rate limit') || msg.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearError = () => {
    setErrorMsg(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setErrorMsg(null), 8000);
  };

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
    setInput,
  } = useChat({
    api: '/api/agent/chat',
    onError: (err) => {
      console.error('[Chat] Error:', err);
      showError(friendlyError(err));
    },
    onFinish: () => {
      if (!isOpen) setHasUnread(true);
    },
  });

  const wrappedHandleSubmit = (e: React.FormEvent) => {
    clearError();
    handleSubmit(e);
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleClear = () => {
    setMessages([]);
  };

  const handleExampleClick = (prompt: string) => {
    setInput(prompt);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        wrappedHandleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const userMessageCount = messages.filter((m) => m.role === 'user').length;

  return (
    <>
      {/* Floating toggle button */}
      <button
        className={`ac-toggle ${isOpen ? 'ac-toggle--open' : ''}`}
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? 'Close assistant' : 'Open AI assistant'}
      >
        {isOpen ? CLOSE_ICON : CHAT_ICON}
        {hasUnread && !isOpen && <span className="ac-badge" />}
      </button>

      {/* Chat panel */}
      <div className={`ac-panel ${isOpen ? 'ac-panel--open' : ''}`} role="dialog" aria-label="AI Assistant">
        {/* Header */}
        <div className="ac-header">
          <div className="ac-header__info">
            <div className="ac-header__avatar">{BOT_ICON}</div>
            <div>
              <div className="ac-header__title">Store Assistant</div>
              <div className="ac-header__subtitle">
                <span className="ac-status-dot" />
                Powered by qwen3:8b
              </div>
            </div>
          </div>
          <div className="ac-header__actions">
            {messages.length > 0 && (
              <button
                className="ac-icon-btn"
                onClick={handleClear}
                title="Clear conversation"
                aria-label="Clear conversation"
              >
                {CLEAR_ICON}
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="ac-messages">
          {messages.length === 0 ? (
            <div className="ac-welcome">
              <div className="ac-welcome__icon">{BOT_ICON}</div>
              <h3>Hi! I'm your store assistant.</h3>
              <p>I can help you manage orders, products, and inventory. Try asking:</p>
              <div className="ac-examples">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    className="ac-example-btn"
                    onClick={() => handleExampleClick(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              // useChat always provides string content; cast defensively
              const content: string = typeof msg.content === 'string' ? msg.content : '';

              if (!content && msg.role === 'assistant') return null;

              const lines = content.split('\n');

              return (
                <div
                  key={msg.id}
                  className={`ac-message ${isUser ? 'ac-message--user' : 'ac-message--assistant'}`}
                >
                  {!isUser && (
                    <div className="ac-avatar ac-avatar--bot">{BOT_ICON}</div>
                  )}
                  <div
                    className={`ac-bubble ${isUser ? 'ac-bubble--user' : 'ac-bubble--assistant'}`}
                  >
                    {lines.map((line: string, i: number) => (
                      <span key={i}>
                        {line}
                        {i < lines.length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                  {isUser && (
                    <div className="ac-avatar ac-avatar--user">
                      {msg.role[0].toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {isLoading && <TypingIndicator />}

          {errorMsg && (
            <div className="ac-notice">
              <span className="ac-notice__icon">⚠</span>
              <span className="ac-notice__text">{errorMsg}</span>
              <button
                className="ac-notice__dismiss"
                onClick={clearError}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <form className="ac-input-area" onSubmit={wrappedHandleSubmit}>
          <input
            ref={inputRef}
            className="ac-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoading
                ? 'Assistant is thinking…'
                : userMessageCount === 0
                  ? 'Ask me anything about orders or products…'
                  : 'Ask a follow-up…'
            }
            disabled={isLoading}
            autoComplete="off"
          />
          <button
            type="submit"
            className="ac-send-btn"
            disabled={!input.trim() || isLoading}
            aria-label="Send"
          >
            {SEND_ICON}
          </button>
        </form>
      </div>
    </>
  );
}
