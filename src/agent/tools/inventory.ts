import { tool } from 'ai';
import { z } from 'zod';
import { storeClient } from '../client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InventoryLevel {
  id: string;
  variantId: string;
  locationId: string;
  available: number;
  reserved: number;
  committed: number;
  onHand: number;
  incoming: number;
  reorderPoint: number;
  location: { id: string; name: string; code: string } | null;
}

interface InventoryLevelsResponse {
  levels: InventoryLevel[];
  totals: {
    available: number;
    reserved: number;
    committed: number;
    onHand: number;
    incoming: number;
  };
}

interface EnrichedInventoryLevel extends InventoryLevel {
  product: { id: string; name: string } | null;
  variant: { id: string; name: string; sku: string } | null;
}

interface PaginatedInventoryResponse {
  data: EnrichedInventoryLevel[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface ProductSearchResult {
  data: Array<{
    id: string;
    name: string;
    variants: Array<{ id: string; sku: string }>;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_ADJUSTMENT_REASONS = [
  'received',
  'correction',
  'damaged',
  'theft',
  'loss',
  'recount',
  'returned',
  'reserved',
  'unreserved',
  'sold',
  'transfer_in',
  'transfer_out',
] as const;

export type AdjustmentReason = (typeof VALID_ADJUSTMENT_REASONS)[number];

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function resolveVariantBySku(
  sku: string,
): Promise<{ variantId: string; productName: string } | { error: string }> {
  try {
    const result = await storeClient.get<ProductSearchResult>(
      `/api/products?search=${encodeURIComponent(sku)}&limit=10`,
    );
    for (const product of result.data ?? []) {
      const variant = product.variants.find(
        (v) => v.sku.toLowerCase() === sku.toLowerCase(),
      );
      if (variant) {
        return { variantId: variant.id, productName: product.name };
      }
    }
    return { error: `No product with SKU "${sku}" was found.` };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { error: `Failed to look up SKU "${sku}": ${e.message ?? 'unknown error'}` };
  }
}

async function fetchVariantLevels(
  variantId: string,
): Promise<InventoryLevelsResponse | { error: string }> {
  try {
    return await storeClient.get<InventoryLevelsResponse>(
      `/api/products/inventory/levels/${variantId}`,
    );
  } catch (err: unknown) {
    const e = err as { message?: string };
    return { error: `Failed to fetch inventory levels: ${e.message ?? 'unknown error'}` };
  }
}

// ─── Execute functions (exported for unit testing) ────────────────────────────

export async function executeGetInventoryLevels(sku: string) {
  const resolved = await resolveVariantBySku(sku);
  if ('error' in resolved) return { success: false as const, error: resolved.error };

  const result = await fetchVariantLevels(resolved.variantId);
  if ('error' in result) return { success: false as const, error: result.error };

  if (result.levels.length === 0) {
    return {
      success: true as const,
      sku,
      product: resolved.productName,
      locations: [],
      totals: result.totals,
      message: `No inventory records found for SKU "${sku}".`,
    };
  }

  return {
    success: true as const,
    sku,
    product: resolved.productName,
    totals: result.totals,
    locations: result.levels.map((l) => ({
      locationId: l.locationId,
      locationName: l.location?.name ?? l.locationId,
      available: l.available,
      onHand: l.onHand,
      reserved: l.reserved,
      committed: l.committed,
      incoming: l.incoming,
      reorderPoint: l.reorderPoint,
    })),
  };
}

export async function executeAdjustInventory(
  sku: string,
  quantity: number,
  reason: AdjustmentReason,
  notes?: string,
  locationId?: string,
) {
  const resolved = await resolveVariantBySku(sku);
  if ('error' in resolved) return { success: false as const, error: resolved.error };

  let resolvedLocationId = locationId;
  if (!resolvedLocationId) {
    const levels = await fetchVariantLevels(resolved.variantId);
    if ('error' in levels) return { success: false as const, error: levels.error };
    if (levels.levels.length === 0) {
      return {
        success: false as const,
        error: `No inventory locations found for SKU "${sku}". Cannot adjust stock.`,
      };
    }
    resolvedLocationId = levels.levels[0].locationId;
  }

  try {
    const result = await storeClient.post<{
      adjustment: { quantity: number; reason: string };
      inventoryLevel: { previousOnHand: number; newOnHand: number; available: number };
    }>('/api/products/inventory/adjust', {
      variantId: resolved.variantId,
      locationId: resolvedLocationId,
      quantity,
      reason,
      notes: notes ?? 'Adjusted by admin agent',
    });

    return {
      success: true as const,
      sku,
      product: resolved.productName,
      adjustedBy: quantity,
      reason,
      previousOnHand: result.inventoryLevel.previousOnHand,
      newOnHand: result.inventoryLevel.newOnHand,
      available: result.inventoryLevel.available,
      message:
        `Inventory for SKU "${sku}" adjusted by ${quantity > 0 ? '+' : ''}${quantity}. ` +
        `On-hand: ${result.inventoryLevel.newOnHand}, available: ${result.inventoryLevel.available}.`,
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false as const,
      error:
        e.code === 'INVALID_ADJUSTMENT'
          ? `Adjustment of ${quantity} would result in negative inventory for SKU "${sku}".`
          : `Failed to adjust inventory: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeSetInventory(
  sku: string,
  quantity: number,
  notes?: string,
  locationId?: string,
) {
  if (quantity < 0) {
    return { success: false as const, error: 'Quantity cannot be negative.' };
  }

  const resolved = await resolveVariantBySku(sku);
  if ('error' in resolved) return { success: false as const, error: resolved.error };

  let resolvedLocationId = locationId;
  if (!resolvedLocationId) {
    const levels = await fetchVariantLevels(resolved.variantId);
    if ('error' in levels) return { success: false as const, error: levels.error };
    if (levels.levels.length === 0) {
      return {
        success: false as const,
        error: `No inventory locations found for SKU "${sku}". Cannot set stock.`,
      };
    }
    resolvedLocationId = levels.levels[0].locationId;
  }

  try {
    const result = await storeClient.post<{
      inventoryLevel: { previousOnHand: number; newOnHand: number; available: number };
    }>('/api/products/inventory/set', {
      variantId: resolved.variantId,
      locationId: resolvedLocationId,
      quantity,
      notes: notes ?? 'Set by admin agent',
    });

    return {
      success: true as const,
      sku,
      product: resolved.productName,
      previousOnHand: result.inventoryLevel.previousOnHand,
      newOnHand: result.inventoryLevel.newOnHand,
      available: result.inventoryLevel.available,
      message:
        `Inventory for SKU "${sku}" set to ${quantity}. ` +
        `Available: ${result.inventoryLevel.available}.`,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false as const,
      error: `Failed to set inventory: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeGetLowStockProducts() {
  try {
    const result = await storeClient.get<PaginatedInventoryResponse>(
      '/api/products/inventory/levels?lowStock=true&limit=50',
    );

    const items = result.data ?? [];

    if (items.length === 0) {
      return {
        success: true as const,
        items: [],
        total: 0,
        message: 'No low-stock products found. All SKUs are above their reorder points.',
      };
    }

    return {
      success: true as const,
      total: result.pagination.total,
      showing: items.length,
      items: items.map((l) => ({
        sku: l.variant?.sku ?? 'N/A',
        productName: l.product?.name ?? 'N/A',
        locationName: l.location?.name ?? l.locationId,
        available: l.available,
        onHand: l.onHand,
        reorderPoint: l.reorderPoint,
      })),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false as const,
      error: `Failed to fetch low-stock products: ${e.message ?? 'unknown error'}`,
    };
  }
}

// ─── ADK-style tool definitions ───────────────────────────────────────────────

export const getInventoryLevels = tool({
  description:
    'Check inventory/stock levels for a product by its SKU. ' +
    'Use when asked "how many in stock", "inventory for SKU-001", "stock levels", ' +
    '"available quantity", "how much stock do we have".',
  parameters: z.object({
    sku: z.string().describe('The product SKU to check inventory for, e.g. SKU-001'),
  }),
  execute: ({ sku }) => executeGetInventoryLevels(sku),
});

export const adjustInventory = tool({
  description:
    'Adjust inventory quantity for a SKU by a delta (positive or negative). ' +
    'Use for "add 50 units to SKU-001", "received 100 units of SKU-002", ' +
    '"remove 10 damaged items from SKU-003", "reduce stock by 5". ' +
    'Pass positive quantity to add, negative to remove.',
  parameters: z.object({
    sku: z.string().describe('The product SKU to adjust, e.g. SKU-001'),
    quantity: z
      .number()
      .describe('Amount to adjust by. Positive = add stock, negative = remove stock.'),
    reason: z
      .enum(VALID_ADJUSTMENT_REASONS)
      .describe(
        'Reason: received (new stock arriving), correction (data fix), damaged, theft, ' +
          'loss, recount, returned (customer return), sold, transfer_in, transfer_out',
      ),
    notes: z.string().optional().describe('Optional notes about this adjustment'),
  }),
  execute: ({ sku, quantity, reason, notes }) =>
    executeAdjustInventory(sku, quantity, reason, notes),
});

export const setInventory = tool({
  description:
    'Set the inventory quantity for a SKU to an exact number. ' +
    'Use for "set stock of SKU-001 to 100", "inventory for SKU-002 is now 50", ' +
    '"update stock count to 200", "correct inventory to 75 units".',
  parameters: z.object({
    sku: z.string().describe('The product SKU to update, e.g. SKU-001'),
    quantity: z
      .number()
      .min(0)
      .describe('The new exact quantity (must be 0 or greater)'),
    notes: z.string().optional().describe('Optional notes about why the count was set'),
  }),
  execute: ({ sku, quantity, notes }) => executeSetInventory(sku, quantity, notes),
});

export const getLowStockProducts = tool({
  description:
    'Get a list of products at or below their reorder point (low stock / out of stock). ' +
    'Use for "what products are running low", "low stock alerts", ' +
    '"which SKUs need restocking", "out of stock items", "reorder report".',
  parameters: z.object({}),
  execute: () => executeGetLowStockProducts(),
});
