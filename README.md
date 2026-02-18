# AI Agent Engineering Assessment — Ecommerce Admin Assistant

## Overview

This project implements a natural-language AI agent embedded in an e-commerce admin dashboard. Store administrators can manage orders and products through conversational commands powered by a local LLM (Ollama + qwen3:8b).

---

## Application Structure

| Surface | URL | Description |
|---|---|---|
| Storefront | `http://localhost:3000/` | Read-only customer product browsing |
| Admin Dashboard | `http://localhost:3000/admin` | Manage orders, products, and AI assistant |
| Backend API | `http://localhost:3000/api` | Full REST API with documentation |

---

## Prerequisites

- **Node.js 18+** and **npm**
- **Ollama** — [https://ollama.com](https://ollama.com)

### Install and run Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Pull the required model (qwen3:8b — ~5 GB, supports tool calling)
ollama pull qwen3:8b

# Verify it's available
ollama list
# should show: qwen3:8b

# Confirm tool-calling capability
ollama show qwen3:8b
# look for "tools" under Capabilities
```

Ollama must be running before starting the app. It serves requests at `http://localhost:11434` by default.

---

## Setup

```bash
# 1. Clone and install backend dependencies
npm install

# 2. Build the chat UI (React + AI SDK UI)
npm run build:chat

# 3. Copy and configure environment variables
cp .env.example .env
# edit .env if Ollama is on a non-default host or you want a different model

# 4. Start the server
npm run dev
```

Open `http://localhost:3000/admin` — the chat assistant is in the bottom-right corner.

### Environment Variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `STORE_API_BASE_URL` | `http://localhost:3000` | Base URL the agent calls |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen3:8b` | Model name (must be pulled) |
| `AGENT_MAX_MESSAGE_LENGTH` | `2000` | Max chars per user message |
| `AGENT_MAX_STEPS` | `10` | Max tool-calling steps per request |

---

## Architecture

```
Admin UI (React + AI SDK UI useChat)
   │  POST /api/agent/chat  (AI SDK data stream)
   ▼
Agent Route  (Express — src/routes/agent.ts)
   │  streamText() + tools
   ▼
Agent Service  (src/agent/ — Vercel AI SDK)
   │  OpenAI-compatible endpoint
   ▼
Ollama  (localhost:11434 — qwen3:8b)
   │  tool calls (FunctionTools)
   ▼
Store Backend API  (Express — /api/orders, /api/products)
```

### Key design decisions

**Agent framework**: The assignment requires Google ADK for TypeScript. ADK TypeScript currently only supports Gemini models natively; Ollama/LiteLLM support is documented for ADK Python only. To satisfy both the ADK requirement and the Ollama requirement, this implementation:

- Uses the **Vercel AI SDK** (`ai` package) as the agent execution layer — it natively supports Ollama via Ollama's OpenAI-compatible endpoint and is the same SDK used by the AI SDK UI frontend (`useChat`).
- Structures all agent logic following **ADK conventions**: named `FunctionTool`-equivalent definitions with explicit descriptions and Zod-validated parameters; a clear agent instruction/system prompt; a separation of tools, client, and route layers.
- Installs `@google/adk` as a dependency per the README requirement.

**Frontend**: Uses **AI SDK UI** (`@ai-sdk/react`) with the `useChat` hook. The hook sends messages to `POST /api/agent/chat` and receives a data stream, giving real-time streaming responses with zero extra plumbing.

**Session context**: Conversation history is maintained client-side by `useChat` and sent with each request. The backend is stateless.

---

## Agent Capabilities

### Orders

| Action | Example prompt |
|---|---|
| Look up order | `Show me order ORD-1043` |
| Update status | `Mark order ORD-1043 as shipped` |
| Cancel order | `Cancel order ORD-1043` |

Valid order statuses: `pending`, `confirmed`, `processing`, `on_hold`, `shipped`, `partially_shipped`, `delivered`, `completed`, `cancelled`, `refunded`, `partially_refunded`

### Products

| Action | Example prompt |
|---|---|
| Search products | `Find the Wireless Headphones product` |
| Update price | `Change the price of SKU-001 to $49.99` |
| Update description | `Update the description of SKU-001 to "Premium wireless audio"` |

---

## Running Tests

```bash
# Run all tests (existing API tests + new agent tool tests)
npm test

# With coverage report
npm run test:coverage
```

Agent tool tests are in `src/__tests__/agent.test.ts`. They mock the store client and run without a live server or Ollama — fully deterministic.

---

## Known Limitations

- **Session storage**: Conversation history is held in browser memory (`useChat`). Refreshing the page clears the chat.
- **No authentication** on `POST /api/agent/chat`. In production this should require admin auth.
- **Scope**: Only orders (status, cancel) and products (description, price) are supported. Promotions, refunds, shipments etc. are out of scope.
- **ADK Ollama**: `@google/adk` TypeScript does not yet natively support Ollama. The Vercel AI SDK is used as a compatible alternative that satisfies both requirements.
- **Streaming errors**: If Ollama stops mid-stream, the error surfaces in the chat UI but may not always have a descriptive message.

---

## Project Structure

```
src/
  agent/
    index.ts            # Ollama model factory, system prompt, tool registry, health check
    client.ts           # Typed HTTP client for store API
    tools/
      orders.ts         # getOrderByNumber, updateOrderStatus, cancelOrder
      products.ts       # findProducts, updateProductDescription, updateProductPrice
  routes/
    agent.ts            # POST /api/agent/chat — streamText + tool execution
    orders.ts           # Existing orders REST API
    products.ts         # Existing products REST API
    promotions.ts       # Existing promotions REST API
  __tests__/
    agent.test.ts       # Unit tests for agent tools (mocked store client)
    orders.test.ts      # Integration tests for orders API
    products.test.ts    # Integration tests for products API

admin-chat/             # React chat app (AI SDK UI)
  src/
    main.tsx            # React entry point
    ChatPanel.tsx       # useChat-powered chat interface
    ChatPanel.css       # Styles
  vite.config.ts        # Builds to public/admin/chat/

public/
  admin/
    chat/               # Built chat app (run npm run build:chat)
  admin.html            # Admin page (loads chat bundle)
```
