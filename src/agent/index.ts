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
- Look up orders by order number (e.g. "ORD-1043")
- Update order status (pending → confirmed → processing → shipped → delivered → completed)
- Cancel orders
- Search for products by name or SKU
- Update product descriptions
- Update product prices by SKU

WORKFLOW:
1. When an order action is requested, ALWAYS call getOrderByNumber first to retrieve the order's internal ID.
2. Then use that ID to call updateOrderStatus or cancelOrder.
3. For price updates, use the SKU directly with updateProductPrice.
4. For description updates, call findProducts first to get the product ID.

RESPONSE STYLE:
- Be concise and professional.
- After a successful action, clearly confirm what was done.
- If an action fails, explain why in plain English and suggest what the user can do.
- Never expose internal UUIDs or technical error codes to the user.
- Format prices as "$X.XX".`;

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
