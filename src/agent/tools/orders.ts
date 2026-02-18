import { tool } from 'ai';
import { z } from 'zod';
import { storeClient } from '../client';
import type { Order } from '../../types';

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

export async function executeUpdateOrderStatus(orderId: string, status: string) {
  if (!VALID_ORDER_STATUSES.includes(status as OrderStatus)) {
    return {
      success: false,
      error: `"${status}" is not a valid status. Choose from: ${VALID_ORDER_STATUSES.join(', ')}`,
    };
  }

  try {
    const updated = await storeClient.post<Order>(`/api/orders/${orderId}/status`, { status });
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
            ? `Cannot transition this order to "${status}".`
            : `Failed to update order status: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeCancelOrder(orderId: string, reason?: string) {
  try {
    const updated = await storeClient.post<Order>(`/api/orders/${orderId}/cancel`, {
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
  description: `Update the fulfillment/lifecycle status of an order. Valid statuses: ${VALID_ORDER_STATUSES.join(', ')}`,
  parameters: z.object({
    orderId: z.string().describe('The internal UUID of the order (obtained from getOrderByNumber)'),
    status: z
      .enum(VALID_ORDER_STATUSES)
      .describe('The new status to apply to the order'),
  }),
  execute: ({ orderId, status }) => executeUpdateOrderStatus(orderId, status),
});

export const cancelOrder = tool({
  description:
    'Cancel an order. This cannot be undone. ' +
    'Cannot cancel orders that are already cancelled, completed, or refunded.',
  parameters: z.object({
    orderId: z.string().describe('The internal UUID of the order (obtained from getOrderByNumber)'),
    reason: z
      .string()
      .optional()
      .describe('Optional reason for cancellation'),
  }),
  execute: ({ orderId, reason }) => executeCancelOrder(orderId, reason),
});
