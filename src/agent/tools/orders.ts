import { tool } from 'ai';
import { z } from 'zod';
import { storeClient } from '../client';
import type { Order } from '../../types';

interface OrderListResponse {
  data: Order[];
  pagination: { totalItems: number; page: number; totalPages: number };
}

export const VALID_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'on_hold',
  'shipped',
  'partially_shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
  'partially_refunded',
] as const;

export type OrderStatus = (typeof VALID_ORDER_STATUSES)[number];

// ─── Standalone execute functions (exported for unit testing) ─────────────────

export async function executeGetOrderByNumber(orderNumber: string) {
  try {
    const order = await storeClient.get<Order>(`/api/orders/number/${orderNumber}`);
    return {
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        customerEmail: order.customerEmail,
        grandTotal: order.grandTotal,
        lineItemCount: order.lineItems.length,
        createdAt: order.createdAt,
      },
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      error:
        e.code === 'ORDER_NOT_FOUND'
          ? `Order "${orderNumber}" was not found.`
          : `Failed to retrieve order: ${e.message ?? 'unknown error'}`,
    };
  }
}

/** Resolves an order number to its internal UUID, returns null with an error string on failure. */
async function resolveOrderId(
  orderNumber: string,
): Promise<{ id: string } | { error: string }> {
  try {
    const order = await storeClient.get<Order>(`/api/orders/number/${orderNumber}`);
    return { id: order.id };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      error:
        e.code === 'ORDER_NOT_FOUND'
          ? `Order "${orderNumber}" was not found.`
          : `Could not look up order "${orderNumber}": ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeUpdateOrderStatus(orderNumber: string, status: string) {
  if (!VALID_ORDER_STATUSES.includes(status as OrderStatus)) {
    return {
      success: false,
      error: `"${status}" is not a valid status. Choose from: ${VALID_ORDER_STATUSES.join(', ')}`,
    };
  }

  const resolved = await resolveOrderId(orderNumber);
  if ('error' in resolved) return { success: false, error: resolved.error };

  try {
    const updated = await storeClient.post<Order>(`/api/orders/${resolved.id}/status`, { status });
    return {
      success: true,
      message: `Order ${updated.orderNumber} status updated to "${status}".`,
      order: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        status: updated.status,
      },
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      error:
        e.code === 'ORDER_ALREADY_CANCELLED'
          ? 'This order has already been cancelled.'
          : e.code === 'INVALID_ORDER_STATUS'
            ? `Cannot transition order "${orderNumber}" to "${status}".`
            : `Failed to update order status: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeCancelOrder(orderNumber: string, reason?: string) {
  const resolved = await resolveOrderId(orderNumber);
  if ('error' in resolved) return { success: false, error: resolved.error };

  try {
    const updated = await storeClient.post<Order>(`/api/orders/${resolved.id}/cancel`, {
      reason: reason || 'Cancelled by admin',
    });
    return {
      success: true,
      message: `Order ${updated.orderNumber} has been successfully cancelled.`,
      order: {
        id: updated.id,
        orderNumber: updated.orderNumber,
        status: updated.status,
      },
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      error:
        e.code === 'ORDER_ALREADY_CANCELLED'
          ? 'This order has already been cancelled.'
          : e.code === 'INVALID_ORDER_STATUS'
            ? 'Cannot cancel a completed or refunded order.'
            : `Failed to cancel order: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeListOrders(options: {
  status?: string;
  customerEmail?: string;
  limit?: number;
}) {
  const { status, customerEmail, limit = 20 } = options;

  if (status && !VALID_ORDER_STATUSES.includes(status as OrderStatus)) {
    return {
      success: false,
      error: `"${status}" is not a valid status. Choose from: ${VALID_ORDER_STATUSES.join(', ')}`,
    };
  }

  const params = new URLSearchParams({
    limit: String(limit),
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });
  if (status) params.set('status', status);
  if (customerEmail) params.set('customerEmail', customerEmail);

  try {
    const result = await storeClient.get<OrderListResponse>(`/api/orders?${params.toString()}`);
    const orders = result.data ?? [];

    if (orders.length === 0) {
      const filterDesc = status ? ` with status "${status}"` : customerEmail ? ` for ${customerEmail}` : '';
      return {
        success: true,
        orders: [],
        message: `No orders found${filterDesc}.`,
        total: 0,
      };
    }

    return {
      success: true,
      orders: orders.map((o) => ({
        orderNumber: o.orderNumber,
        id: o.id,
        status: o.status,
        paymentStatus: o.paymentStatus,
        customerEmail: o.customerEmail,
        grandTotal: o.grandTotal,
        lineItemCount: o.lineItems.length,
        createdAt: o.createdAt,
      })),
      total: result.pagination.totalItems,
      showing: orders.length,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false,
      error: `Failed to retrieve orders: ${e.message ?? 'unknown error'}`,
    };
  }
}

// ─── ADK-style tool definitions (Vercel AI SDK FunctionTool equivalent) ──────

export const getOrderByNumber = tool({
  description:
    'Look up an order by its order number (e.g. ORD-1043). ' +
    'Always call this first before updating or cancelling an order to get its internal ID.',
  parameters: z.object({
    orderNumber: z.string().describe('The order number, e.g. ORD-1043'),
  }),
  execute: ({ orderNumber }) => executeGetOrderByNumber(orderNumber),
});

export const updateOrderStatus = tool({
  description:
    `Update the fulfillment/lifecycle status of an order using its order number (e.g. ORD-1010). ` +
    `Valid statuses: ${VALID_ORDER_STATUSES.join(', ')}`,
  parameters: z.object({
    orderNumber: z
      .string()
      .describe('The order number, e.g. ORD-1010'),
    status: z
      .enum(VALID_ORDER_STATUSES)
      .describe('The new status to apply to the order'),
  }),
  execute: ({ orderNumber, status }) => executeUpdateOrderStatus(orderNumber, status),
});

export const cancelOrder = tool({
  description:
    'Cancel an order using its order number (e.g. ORD-1010). ' +
    'This cannot be undone. Cannot cancel orders that are already cancelled, completed, or refunded.',
  parameters: z.object({
    orderNumber: z
      .string()
      .describe('The order number, e.g. ORD-1010'),
    reason: z
      .string()
      .optional()
      .describe('Optional reason for cancellation'),
  }),
  execute: ({ orderNumber, reason }) => executeCancelOrder(orderNumber, reason),
});

export const listOrders = tool({
  description:
    'List recent orders, optionally filtered by status or customer email. ' +
    'Use this when the user asks to "show all orders", "list orders", "recent orders", ' +
    '"show pending orders", "orders for a customer", or any similar listing request. ' +
    'Do NOT require an order number for this tool — it lists orders without one.',
  parameters: z.object({
    status: z
      .enum(VALID_ORDER_STATUSES)
      .optional()
      .describe('Filter by order status (optional). Omit to show orders of all statuses.'),
    customerEmail: z
      .string()
      .optional()
      .describe('Filter by customer email address (optional).'),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Number of orders to return (default: 20, max: 50).'),
  }),
  execute: ({ status, customerEmail, limit }) =>
    executeListOrders({ status, customerEmail, limit }),
});

// ─── Order stats ──────────────────────────────────────────────────────────────

interface OrderStats {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  ordersByStatus: Record<string, number>;
  ordersByPaymentStatus: Record<string, number>;
  ordersByFulfillmentStatus: Record<string, number>;
}

export async function executeGetOrderStats(startDate?: string, endDate?: string) {
  try {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const query = params.toString();
    const stats = await storeClient.get<OrderStats>(
      `/api/orders/stats${query ? `?${query}` : ''}`,
    );

    return {
      success: true as const,
      totalOrders: stats.totalOrders,
      totalRevenue: Number(stats.totalRevenue.toFixed(2)),
      averageOrderValue: Number(stats.averageOrderValue.toFixed(2)),
      ordersByStatus: stats.ordersByStatus,
      ordersByPaymentStatus: stats.ordersByPaymentStatus,
      ordersByFulfillmentStatus: stats.ordersByFulfillmentStatus,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false as const,
      error: `Failed to retrieve order statistics: ${e.message ?? 'unknown error'}`,
    };
  }
}

export const getOrderStats = tool({
  description:
    'Get order statistics: total orders, revenue, average order value, breakdown by status. ' +
    'Use for "how many orders", "total revenue", "order stats", "sales summary", ' +
    '"how is the store performing", "how many pending/cancelled orders".',
  parameters: z.object({
    startDate: z
      .string()
      .optional()
      .describe('ISO date string to filter from (e.g. 2024-01-01). Omit for all time.'),
    endDate: z
      .string()
      .optional()
      .describe('ISO date string to filter to (e.g. 2024-12-31). Omit for all time.'),
  }),
  execute: ({ startDate, endDate }) => executeGetOrderStats(startDate, endDate),
});

// ─── Order notes ──────────────────────────────────────────────────────────────

export async function executeAddOrderNote(
  orderNumber: string,
  content: string,
  isPrivate = true,
) {
  const resolved = await resolveOrderId(orderNumber);
  if ('error' in resolved) return { success: false as const, error: resolved.error };

  try {
    const note = await storeClient.post<{ id: string; content: string; createdAt: string }>(
      `/api/orders/${resolved.id}/notes`,
      { content, isPrivate, createdBy: 'admin-agent' },
    );

    return {
      success: true as const,
      orderNumber,
      noteId: note.id,
      message: `Note added to order ${orderNumber}: "${content}"`,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false as const,
      error: `Failed to add note to order ${orderNumber}: ${e.message ?? 'unknown error'}`,
    };
  }
}

export const addOrderNote = tool({
  description:
    'Add a note to an order. ' +
    'Use for "add note to ORD-xxx", "leave a comment on order ORD-xxx", ' +
    '"record a message on ORD-xxx".',
  parameters: z.object({
    orderNumber: z.string().describe('The order number, e.g. ORD-1010'),
    content: z.string().describe('The note text to add'),
    isPrivate: z
      .boolean()
      .optional()
      .describe('Whether the note is internal/private (default: true)'),
  }),
  execute: ({ orderNumber, content, isPrivate }) =>
    executeAddOrderNote(orderNumber, content, isPrivate ?? true),
});

// ─── Order refunds ────────────────────────────────────────────────────────────

export async function executeRefundOrder(
  orderNumber: string,
  reason: string,
  note?: string,
) {
  const resolved = await resolveOrderId(orderNumber);
  if ('error' in resolved) return { success: false as const, error: resolved.error };

  try {
    const refund = await storeClient.post<{
      id: string;
      totalRefund: number;
      reason: string;
      processedAt: string;
    }>(`/api/orders/${resolved.id}/refunds`, {
      reason,
      note,
    });

    return {
      success: true as const,
      orderNumber,
      refundId: refund.id,
      totalRefund: refund.totalRefund,
      reason: refund.reason,
      message:
        refund.totalRefund > 0
          ? `Refund of $${refund.totalRefund.toFixed(2)} issued for order ${orderNumber}.`
          : `Refund recorded for order ${orderNumber} (reason: ${reason}).`,
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false as const,
      error:
        e.code === 'INVALID_PAYMENT_STATUS'
          ? `Cannot refund order ${orderNumber} — it has not been paid yet.`
          : e.code === 'REFUND_EXCEEDS_ORDER'
            ? `Refund amount exceeds the order total for ${orderNumber}.`
            : `Failed to refund order ${orderNumber}: ${e.message ?? 'unknown error'}`,
    };
  }
}

export const refundOrder = tool({
  description:
    'Issue a refund for an order. ' +
    'Use for "refund order ORD-xxx", "issue a refund for ORD-xxx", ' +
    '"process refund on ORD-xxx". Cannot refund unpaid orders.',
  parameters: z.object({
    orderNumber: z.string().describe('The order number to refund, e.g. ORD-1010'),
    reason: z
      .string()
      .describe('Reason for the refund, e.g. "customer request", "damaged item", "wrong item"'),
    note: z.string().optional().describe('Optional additional notes about the refund'),
  }),
  execute: ({ orderNumber, reason, note }) => executeRefundOrder(orderNumber, reason, note),
});
