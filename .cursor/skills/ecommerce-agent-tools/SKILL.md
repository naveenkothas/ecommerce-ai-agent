---
name: ecommerce-agent-tools
description: Add, fix, or debug agent tools in the ecommerce-ai-agent project. Use when adding a new tool, fixing a tool argument mismatch, updating the system prompt intent mapping, or writing tests for agent tools. Covers the execute-function pattern, internal ID resolution, tool registration, and system prompt conventions used in this codebase.
---

# Ecommerce Agent Tools

## Tool file locations

| File | Tools |
|---|---|
| `src/agent/tools/orders.ts` | listOrders, getOrderStats, getOrderByNumber, updateOrderStatus, cancelOrder, refundOrder, addOrderNote |
| `src/agent/tools/products.ts` | findProducts, updateProductDescription, updateProductPrice |
| `src/agent/tools/inventory.ts` | getInventoryLevels, adjustInventory, setInventory, getLowStockProducts |
| `src/agent/index.ts` | Tool registry (`agentTools`), `SYSTEM_PROMPT`, Ollama model factory |
| `src/routes/agent.ts` | `POST /api/agent/chat` — streams `streamText` with all tools |

---

## Adding a new tool — checklist

- [ ] Write `executeXxx` function (exported, used in unit tests)
- [ ] Write `tool({ description, parameters, execute })` export
- [ ] Import and add to `agentTools` in `src/agent/index.ts`
- [ ] Add intent mapping lines to `SYSTEM_PROMPT` under the right section
- [ ] Add unit tests in `src/__tests__/agent.test.ts`

---

## Tool anatomy pattern

Every tool follows this two-part pattern:

```ts
// 1. Standalone execute function — exported for unit testing
export async function executeDoThing(param: string) {
  // validate early, return { success: false, error: '...' } on bad input
  // call storeClient.get / .post / .put
  // return { success: true, ...data } on success
  // catch errors, return { success: false, error: friendly message }
}

// 2. Vercel AI SDK tool wrapper
export const doThing = tool({
  description: 'What it does and exactly when the LLM should call it.',
  parameters: z.object({
    param: z.string().describe('What this param is'),
  }),
  execute: ({ param }) => executeDoThing(param),
});
```

**Key rule:** Tool parameters must use the names the LLM naturally sends.
- Use `orderNumber` (not `orderId`) for order tools — the LLM always uses the human-readable number.
- Use `sku` (not `variantId`) for inventory tools — internal IDs are resolved inside the execute function.

---

## Internal ID resolution

Never expose internal UUIDs to the LLM. Resolve them inside execute functions:

```ts
// orders — resolveOrderId is a private helper in orders.ts
const resolved = await resolveOrderId(orderNumber);
if ('error' in resolved) return { success: false, error: resolved.error };
// use resolved.id for API calls

// inventory — resolveVariantBySku is a private helper in inventory.ts
const resolved = await resolveVariantBySku(sku);
if ('error' in resolved) return { success: false, error: resolved.error };
// use resolved.variantId for API calls
```

---

## Registering a tool

In `src/agent/index.ts`:

```ts
// 1. Import
import { myNewTool } from './tools/my-file';

// 2. Add to registry (grouped by domain)
export const agentTools: Record<string, Tool> = {
  // Orders
  listOrders,
  myNewTool,   // ← add here
  ...
};
```

---

## System prompt — adding intent mapping

In `src/agent/index.ts`, find the relevant section in `SYSTEM_PROMPT` and add:

```
- "user phrase A" / "user phrase B" / "user phrase C"
  → toolName(param1, param2)
```

Rules:
- Cover 3–5 natural-language variants per tool
- Spell out the exact tool name and parameter values where they matter
- Add to WORKFLOW section if the tool is single-step (no pre-lookup)
- Never leave "I don't have a tool for that" as a valid LLM response

---

## Writing tests

Tests live in `src/__tests__/agent.test.ts`. `storeClient` is fully mocked.

```ts
describe('executeMyTool', () => {
  it('happy path', async () => {
    mockGet.mockResolvedValueOnce({ /* API response shape */ });
    const result = await executeMyTool('arg');
    expect(result.success).toBe(true);
    expect(mockGet).toHaveBeenCalledWith('/api/expected/path');
  });

  it('returns error when not found', async () => {
    mockGet.mockResolvedValueOnce({ data: [] }); // empty = not found
    const result = await executeMyTool('bad-arg');
    expect(result.success).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
```

Available mocks: `mockGet`, `mockPost`, `mockPut` — reset automatically in `beforeEach`.
Shared fixtures: `MOCK_ORDER_LOOKUP`, `MOCK_PRODUCT_SEARCH`, `MOCK_INVENTORY_LEVELS`.

---

## Common error — InvalidToolArgumentsError

**Symptom:** `[Agent] Streaming error: InvalidToolArgumentsError` — LLM sent `{ newStatus, orderId }` but schema expects `{ status, orderNumber }`.

**Fix:** Rename the Zod parameters to match what the LLM naturally produces, then do internal ID resolution inside the execute function. Never change the LLM prompt to match a bad schema — fix the schema.

---

## API base URLs

| Domain | Endpoint pattern |
|---|---|
| Orders | `/api/orders`, `/api/orders/number/:orderNumber`, `/api/orders/:id/status` |
| Products | `/api/products?search=&limit=`, `/api/products/:id/variants/:variantId` |
| Inventory | `/api/products/inventory/levels/:variantId`, `/api/products/inventory/adjust`, `/api/products/inventory/set` |

Use `storeClient.get<T>`, `.post<T>`, `.put<T>` — base URL comes from `STORE_API_BASE_URL` env var.
