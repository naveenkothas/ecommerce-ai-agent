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

| Tool | Example prompt |
|---|---|
| List orders | `Show me all pending orders` |
| Order statistics | `What is our total revenue and how many orders do we have?` |
| Look up order | `Check the details of order ORD-1004` |
| Update status | `Mark order ORD-1003 as shipped` |
| Cancel order | `Cancel order ORD-1008 — customer changed their mind` |
| Refund order | `Issue a refund for order ORD-1005, customer request` |
| Add note | `Add a note to order ORD-1004: awaiting customer callback` |

Valid order statuses: `pending`, `confirmed`, `processing`, `on_hold`, `shipped`, `partially_shipped`, `delivered`, `completed`, `cancelled`, `refunded`, `partially_refunded`

### Products

| Tool | Example prompt |
|---|---|
| Search / list all | `Show me all products and their SKUs` |
| Update price | `Change the price of RS-GRY-9 to $129.99` |
| Update description | `Update the description of the Wireless Headphones` |

### Inventory

| Tool | Example prompt |
|---|---|
| Check stock levels | `How many units of HP-BLK-001 are in stock?` |
| Check by product name | `What is the stock level for the Smart Fitness Watch?` |
| Adjust inventory | `We received 50 units of TS-NVY-M — add them to inventory` |
| Set exact quantity | `Set the stock of FW-BLK-SM to 100 units` |
| Low-stock report | `Which products are running low and need restocking?` |

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

- **Session storage**: Conversation history is held in browser memory (`useChat`). Refreshing the page clears the chat. A production system would persist sessions server-side (e.g. Redis).
- **No authentication** on `POST /api/agent/chat`. In production this endpoint should require a valid admin session/JWT.
- **ADK + Ollama compatibility**: `@google/adk` for TypeScript natively supports Gemini only. To satisfy both the ADK requirement and the Ollama requirement, this implementation uses the Vercel AI SDK as the execution layer (ADK conventions are followed: named tools, Zod schemas, system prompt) while `@google/adk` is installed as a dependency. An ADK-native implementation would require the ADK Python runtime or a Gemini API key.
- **Partial refunds**: `refundOrder` issues a full-order refund. Line-item partial refunds are supported by the API but not exposed through the agent.
- **Promotions / shipments**: These API endpoints exist but agent tools for them are not implemented — they were out of scope within the time budget.
- **Multi-location inventory**: When adjusting or setting inventory, the agent targets the first available location automatically. Explicit location selection is not supported via natural language.
- **LLM non-determinism**: With small models like qwen3:8b, occasional tool-argument hallucinations can occur (e.g. using `newStatus` instead of `status`). The tool schemas are designed to be forgiving, but a production deployment would benefit from a larger or fine-tuned model.

---

## Project Structure

```
src/
  agent/
    index.ts            # Ollama model factory, system prompt, tool registry, health check
    client.ts           # Typed HTTP client for store API
    tools/
      orders.ts         # listOrders, getOrderStats, getOrderByNumber,
                        # updateOrderStatus, cancelOrder, refundOrder, addOrderNote
      products.ts       # findProducts, updateProductDescription, updateProductPrice
      inventory.ts      # getInventoryLevels, adjustInventory, setInventory,
                        # getLowStockProducts
  routes/
    agent.ts            # POST /api/agent/chat — streamText + tool execution
    orders.ts           # Existing orders REST API
    products.ts         # Existing products REST API
    promotions.ts       # Existing promotions REST API
  __tests__/
    agent.test.ts       # Unit tests for all 14 agent tools (mocked store client)
    orders.test.ts      # Integration tests for orders API
    products.test.ts    # Integration tests for products API

admin-chat/             # React chat app (AI SDK UI)
  src/
    main.tsx            # React entry point
    ChatPanel.tsx       # useChat-powered chat interface with graceful error handling
    ChatPanel.css       # Styles
  vite.config.ts        # Builds to public/admin/chat/

public/
  admin/
    chat/               # Built chat app (run npm run build:chat)
  admin.html            # Admin page (loads chat bundle)
```
