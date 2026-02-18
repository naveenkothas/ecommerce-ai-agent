/**
 * Agent Service
 *
 * Implements the backend AI agent using the Vercel AI SDK with Ollama
 * (qwen3:8b) as the LLM provider. The agent is structured following
 * Google ADK conventions: named tools with explicit descriptions and
 * Zod-validated parameters.
 *
 * Note: Google ADK for TypeScript currently only supports Gemini models
 * natively. Since the assignment requires local Ollama (no API key),
 * we use the Vercel AI SDK — which drives both this agent and the
 * AI SDK UI (useChat) on the frontend — with Ollama's OpenAI-compatible
 * endpoint.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { CoreMessage, LanguageModel, Tool } from 'ai';

import { cancelOrder, getOrderByNumber, updateOrderStatus } from './tools/orders';
import { findProducts, updateProductDescription, updateProductPrice } from './tools/products';

// ─── LLM provider (Ollama via OpenAI-compatible endpoint) ────────────────────

export function createOllamaModel(): LanguageModel {
  const baseURL = `${process.env.OLLAMA_HOST || 'http://localhost:11434'}/v1`;
  const modelName = process.env.OLLAMA_MODEL || 'qwen3:8b';

  const provider = createOpenAI({
    name: 'ollama',
    baseURL,
    apiKey: 'ollama', // required by SDK, ignored by Ollama
  });

  return provider(modelName);
}

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a helpful AI assistant embedded in an e-commerce admin dashboard.
You help store administrators manage orders and products using natural language.

CAPABILITIES:
- List all products and their SKUs
- Look up orders by order number (e.g. "ORD-1043")
- Update order status (pending → confirmed → processing → shipped → delivered → completed)
- Cancel orders
- Search for products by name or SKU
- Update product descriptions
- Update product prices by SKU

INTENT MAPPING — always resolve these to the correct tool call:
- "list all SKUs" / "show all products" / "what products do we have" / "list available SKUs"
  → call findProducts with search="" (empty string) to retrieve the full catalog
- "find product X" / "search for SKU-001" / "look up headphones"
  → call findProducts with the relevant search term
- "cancel order ORD-xxx" → call getOrderByNumber first, then cancelOrder
- "ship / mark as shipped / update status of ORD-xxx"
  → call getOrderByNumber first, then updateOrderStatus
- "change price of SKU-001 to $X" → call updateProductPrice directly (no lookup needed)
- "update description of product X" → call findProducts first to get the product ID, then updateProductDescription

WORKFLOW:
1. For any order action: ALWAYS call getOrderByNumber first to get the order's internal ID.
2. For price updates: use updateProductPrice with the SKU directly.
3. For description updates: call findProducts first, then updateProductDescription with the product ID.
4. For listing/browsing: call findProducts with search="" to show all products.

RESPONSE STYLE:
- Be concise and professional.
- After a successful action, clearly confirm what was done (e.g. "Order ORD-1043 has been cancelled.").
- When listing SKUs/products, present them in a clean, readable list with name, SKU, and price.
- If an action fails, explain why in plain English and suggest what the user can do next.
- Never expose internal UUIDs or technical error codes to the user.
- Format prices as "$X.XX".
- Do NOT say you lack a tool when you can achieve the goal with the tools available.`;

// ─── Tool registry ────────────────────────────────────────────────────────────

export const agentTools: Record<string, Tool> = {
  getOrderByNumber,
  updateOrderStatus,
  cancelOrder,
  findProducts,
  updateProductDescription,
  updateProductPrice,
};

// ─── Ollama health check ──────────────────────────────────────────────────────

export async function checkOllamaHealth(): Promise<{ ok: boolean; error?: string }> {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  try {
    const response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { ok: false, error: `Ollama responded with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      ok: false,
      error: `Cannot reach Ollama at ${host}. Is it running? (ollama serve)`,
    };
  }
}

export type { CoreMessage };
