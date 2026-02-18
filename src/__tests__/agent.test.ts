/**
 * Unit tests for agent tools.
 *
 * External dependencies (storeClient) are mocked so tests are
 * deterministic and run without a live server or Ollama instance.
 */

import { clearTestData } from './setup';

// ── Mock the store API client ─────────────────────────────────────────────────
jest.mock('../agent/client', () => ({
  storeClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

import { storeClient } from '../agent/client';
import {
  executeAddOrderNote,
  executeCancelOrder,
  executeGetOrderByNumber,
  executeGetOrderStats,
  executeListOrders,
  executeRefundOrder,
  executeUpdateOrderStatus,
} from '../agent/tools/orders';
import {
  executeFindProducts,
  executeUpdateProductDescription,
  executeUpdateProductPrice,
} from '../agent/tools/products';
import {
  executeAdjustInventory,
  executeGetInventoryLevels,
  executeGetLowStockProducts,
  executeSetInventory,
} from '../agent/tools/inventory';

const mockGet = storeClient.get as jest.Mock;
const mockPost = storeClient.post as jest.Mock;
const mockPut = storeClient.put as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  clearTestData();
});

// ─────────────────────────────────────────────────────────────────────────────
// Order tools
// ─────────────────────────────────────────────────────────────────────────────

describe('executeListOrders', () => {
  it('lists recent orders with no filters', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'uuid-1',
          orderNumber: 'ORD-1001',
          status: 'pending',
          paymentStatus: 'paid',
          customerEmail: 'a@test.com',
          grandTotal: 50,
          lineItems: [{}],
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'uuid-2',
          orderNumber: 'ORD-1002',
          status: 'shipped',
          paymentStatus: 'paid',
          customerEmail: 'b@test.com',
          grandTotal: 99,
          lineItems: [{}, {}],
          createdAt: '2024-01-02T00:00:00Z',
        },
      ],
      pagination: { totalItems: 2, page: 1, totalPages: 1 },
    });

    const result = await executeListOrders({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.orders).toHaveLength(2);
      expect(result.orders[0].orderNumber).toBe('ORD-1001');
      expect(result.total).toBe(2);
    }
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/orders?')
    );
  });

  it('filters by status', async () => {
    mockGet.mockResolvedValueOnce({
      data: [],
      pagination: { totalItems: 0, page: 1, totalPages: 0 },
    });

    const result = await executeListOrders({ status: 'pending' });

    expect(result.success).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('status=pending'));
  });

  it('rejects invalid status without calling the API', async () => {
    const result = await executeListOrders({ status: 'bad_status' as never });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('"bad_status" is not a valid status');
    }
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns empty list message when no orders found', async () => {
    mockGet.mockResolvedValueOnce({
      data: [],
      pagination: { totalItems: 0, page: 1, totalPages: 0 },
    });

    const result = await executeListOrders({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.orders).toHaveLength(0);
      expect(result.message).toContain('No orders found');
    }
  });
});

describe('executeGetOrderByNumber', () => {
  it('returns order details when found', async () => {
    mockGet.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'pending',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      customerEmail: 'test@example.com',
      grandTotal: 99.99,
      lineItems: [{ id: 'li-1' }],
      createdAt: '2024-01-01T00:00:00Z',
    });

    const result = await executeGetOrderByNumber('ORD-1001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.order.orderNumber).toBe('ORD-1001');
      expect(result.order.status).toBe('pending');
      expect(result.order.lineItemCount).toBe(1);
    }
  });

  it('returns a friendly error when order not found', async () => {
    const err: NodeJS.ErrnoException = new Error('Order not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_NOT_FOUND';
    mockGet.mockRejectedValueOnce(err);

    const result = await executeGetOrderByNumber('ORD-9999');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('ORD-9999');
      expect(result.error).toContain('not found');
    }
  });

  it('returns a generic error on network failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await executeGetOrderByNumber('ORD-1001');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Connection refused');
    }
  });
});

const MOCK_ORDER_LOOKUP = {
  id: 'uuid-123',
  orderNumber: 'ORD-1001',
  status: 'pending',
  paymentStatus: 'paid',
  fulfillmentStatus: 'unfulfilled',
  customerEmail: 'test@example.com',
  grandTotal: 99.99,
  lineItems: [{ id: 'li-1' }],
  createdAt: '2024-01-01T00:00:00Z',
};

describe('executeUpdateOrderStatus', () => {
  it('updates status successfully', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'shipped',
    });

    const result = await executeUpdateOrderStatus('ORD-1001', 'shipped');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('shipped');
      expect(result.order.status).toBe('shipped');
    }
    expect(mockGet).toHaveBeenCalledWith('/api/orders/number/ORD-1001');
    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/status', { status: 'shipped' });
  });

  it('rejects an invalid status without calling the API', async () => {
    const result = await executeUpdateOrderStatus('ORD-1001', 'invalid_status');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('"invalid_status" is not a valid status');
    }
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('returns error when order number not found', async () => {
    const err: NodeJS.ErrnoException = new Error('Not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_NOT_FOUND';
    mockGet.mockRejectedValueOnce(err);

    const result = await executeUpdateOrderStatus('ORD-9999', 'shipped');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('ORD-9999');
    }
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handles ORDER_ALREADY_CANCELLED error from the status endpoint', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    const err: NodeJS.ErrnoException = new Error('Already cancelled') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_ALREADY_CANCELLED';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeUpdateOrderStatus('ORD-1001', 'cancelled');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('already been cancelled');
    }
  });
});

describe('executeCancelOrder', () => {
  it('cancels an order successfully', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'cancelled',
    });

    const result = await executeCancelOrder('ORD-1001', 'Customer request');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('cancelled');
    }
    expect(mockGet).toHaveBeenCalledWith('/api/orders/number/ORD-1001');
    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/cancel', {
      reason: 'Customer request',
    });
  });

  it('uses a default reason when none is provided', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'cancelled',
    });

    await executeCancelOrder('ORD-1001');

    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/cancel', {
      reason: 'Cancelled by admin',
    });
  });

  it('returns error when order number not found', async () => {
    const err: NodeJS.ErrnoException = new Error('Not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_NOT_FOUND';
    mockGet.mockRejectedValueOnce(err);

    const result = await executeCancelOrder('ORD-9999');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('ORD-9999');
    }
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handles ORDER_ALREADY_CANCELLED error from the cancel endpoint', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    const err: NodeJS.ErrnoException = new Error('Already cancelled') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_ALREADY_CANCELLED';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeCancelOrder('ORD-1001');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('already been cancelled');
    }
  });

  it('handles INVALID_ORDER_STATUS for completed orders', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    const err: NodeJS.ErrnoException = new Error('Invalid status') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'INVALID_ORDER_STATUS';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeCancelOrder('ORD-1001');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('completed or refunded');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Product tools
// ─────────────────────────────────────────────────────────────────────────────

describe('executeFindProducts', () => {
  it('returns matching products', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'prod-1',
          name: 'Wireless Headphones',
          status: 'active',
          variants: [{ id: 'var-1', sku: 'SKU-001', price: 49.99, isDefault: true }],
        },
      ],
      pagination: { totalItems: 1 },
    });

    const result = await executeFindProducts('headphones');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.products).toHaveLength(1);
      expect(result.products[0].name).toBe('Wireless Headphones');
      expect(result.products[0].sku).toBe('SKU-001');
    }
  });

  it('returns empty array with message when no products found', async () => {
    mockGet.mockResolvedValueOnce({ data: [], pagination: { totalItems: 0 } });

    const result = await executeFindProducts('xyz-nonexistent');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.products).toHaveLength(0);
      expect(result.message).toContain('No products found');
    }
  });
});

describe('executeUpdateProductDescription', () => {
  it('updates description successfully', async () => {
    mockPut.mockResolvedValueOnce({
      id: 'prod-1',
      name: 'Wireless Headphones',
      description: 'New description',
      shortDescription: 'Short desc',
    });

    const result = await executeUpdateProductDescription(
      'prod-1',
      'New description',
      'Short desc'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('Wireless Headphones');
      expect(result.message).toContain('updated successfully');
    }
    expect(mockPut).toHaveBeenCalledWith('/api/products/prod-1', {
      description: 'New description',
      shortDescription: 'Short desc',
    });
  });

  it('handles PRODUCT_NOT_FOUND error', async () => {
    const err: NodeJS.ErrnoException = new Error('Not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'PRODUCT_NOT_FOUND';
    mockPut.mockRejectedValueOnce(err);

    const result = await executeUpdateProductDescription('bad-id', 'desc');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Product not found');
    }
  });
});

describe('executeUpdateProductPrice', () => {
  it('updates price by SKU successfully', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'prod-1',
          name: 'Wireless Headphones',
          variants: [{ id: 'var-1', sku: 'SKU-001', price: 49.99, isDefault: true }],
        },
      ],
      pagination: { totalItems: 1 },
    });
    mockPut.mockResolvedValueOnce({ id: 'var-1', sku: 'SKU-001', price: 29.99 });

    const result = await executeUpdateProductPrice('SKU-001', 29.99);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('SKU-001');
      expect(result.message).toContain('$29.99');
    }
    expect(mockPut).toHaveBeenCalledWith('/api/products/prod-1/variants/var-1', { price: 29.99 });
  });

  it('rejects negative prices without calling the API', async () => {
    const result = await executeUpdateProductPrice('SKU-001', -5);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('non-negative');
    }
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns error when SKU not found in search results', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'prod-2',
          name: 'Other Product',
          variants: [{ id: 'var-2', sku: 'SKU-002', price: 10.0, isDefault: true }],
        },
      ],
      pagination: { totalItems: 1 },
    });

    const result = await executeUpdateProductPrice('SKU-999', 20.0);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('SKU-999');
    }
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('allows setting price to zero', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          id: 'prod-1',
          name: 'Free Product',
          variants: [{ id: 'var-1', sku: 'SKU-FREE', price: 9.99, isDefault: true }],
        },
      ],
      pagination: { totalItems: 1 },
    });
    mockPut.mockResolvedValueOnce({ id: 'var-1', sku: 'SKU-FREE', price: 0 });

    const result = await executeUpdateProductPrice('SKU-FREE', 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('$0.00');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New order tools
// ─────────────────────────────────────────────────────────────────────────────

describe('executeGetOrderStats', () => {
  it('returns store-wide order statistics', async () => {
    mockGet.mockResolvedValueOnce({
      totalOrders: 42,
      totalRevenue: 4200.5,
      averageOrderValue: 100.01,
      ordersByStatus: { pending: 5, confirmed: 3, shipped: 10, completed: 24 },
      ordersByPaymentStatus: { paid: 37, pending: 5 },
      ordersByFulfillmentStatus: { unfulfilled: 8, fulfilled: 34 },
    });

    const result = await executeGetOrderStats();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.totalOrders).toBe(42);
      expect(result.totalRevenue).toBe(4200.5);
    }
    expect(mockGet).toHaveBeenCalledWith('/api/orders/stats');
  });

  it('passes date range filters when provided', async () => {
    mockGet.mockResolvedValueOnce({
      totalOrders: 10,
      totalRevenue: 500,
      averageOrderValue: 50,
      ordersByStatus: {},
      ordersByPaymentStatus: {},
      ordersByFulfillmentStatus: {},
    });

    await executeGetOrderStats('2024-01-01', '2024-12-31');

    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('startDate=2024-01-01'),
    );
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('endDate=2024-12-31'),
    );
  });

  it('handles API errors gracefully', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const result = await executeGetOrderStats();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Network error');
    }
  });
});

describe('executeAddOrderNote', () => {
  it('adds a note to an order', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    mockPost.mockResolvedValueOnce({
      id: 'note-uuid-1',
      content: 'Customer called to confirm delivery.',
      createdAt: '2024-01-01T00:00:00Z',
    });

    const result = await executeAddOrderNote('ORD-1001', 'Customer called to confirm delivery.');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('ORD-1001');
      expect(result.noteId).toBe('note-uuid-1');
    }
    expect(mockGet).toHaveBeenCalledWith('/api/orders/number/ORD-1001');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/orders/uuid-123/notes',
      expect.objectContaining({ content: 'Customer called to confirm delivery.' }),
    );
  });

  it('returns error when order not found', async () => {
    const err = new Error('Not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_NOT_FOUND';
    mockGet.mockRejectedValueOnce(err);

    const result = await executeAddOrderNote('ORD-9999', 'some note');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('ORD-9999');
    }
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('executeRefundOrder', () => {
  it('issues a full refund for an order', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    mockPost.mockResolvedValueOnce({
      id: 'refund-uuid-1',
      totalRefund: 99.99,
      reason: 'customer request',
      processedAt: '2024-01-01T00:00:00Z',
    });

    const result = await executeRefundOrder('ORD-1001', 'customer request');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('$99.99');
      expect(result.message).toContain('ORD-1001');
    }
    expect(mockPost).toHaveBeenCalledWith(
      '/api/orders/uuid-123/refunds',
      expect.objectContaining({ reason: 'customer request' }),
    );
  });

  it('returns error for unpaid order', async () => {
    mockGet.mockResolvedValueOnce(MOCK_ORDER_LOOKUP);
    const err = new Error('Unpaid') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'INVALID_PAYMENT_STATUS';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeRefundOrder('ORD-1001', 'customer request');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not been paid');
    }
  });

  it('returns error when order not found', async () => {
    const err = new Error('Not found') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_NOT_FOUND';
    mockGet.mockRejectedValueOnce(err);

    const result = await executeRefundOrder('ORD-9999', 'reason');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('ORD-9999');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Inventory tools
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PRODUCT_SEARCH = {
  data: [
    {
      id: 'prod-1',
      name: 'Wireless Headphones',
      variants: [{ id: 'var-1', sku: 'SKU-001' }],
    },
  ],
};

const MOCK_INVENTORY_LEVELS = {
  levels: [
    {
      id: 'level-1',
      variantId: 'var-1',
      locationId: 'loc-1',
      available: 45,
      reserved: 5,
      committed: 0,
      onHand: 50,
      incoming: 0,
      reorderPoint: 10,
      location: { id: 'loc-1', name: 'Main Warehouse', code: 'WH-01' },
    },
  ],
  totals: { available: 45, reserved: 5, committed: 0, onHand: 50, incoming: 0 },
};

describe('executeGetInventoryLevels', () => {
  it('returns inventory levels for a valid SKU', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);

    const result = await executeGetInventoryLevels('SKU-001');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.sku).toBe('SKU-001');
      expect(result.totals.onHand).toBe(50);
      expect(result.locations).toHaveLength(1);
      expect(result.locations[0].locationName).toBe('Main Warehouse');
    }
  });

  it('returns error when SKU not found', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    const result = await executeGetInventoryLevels('SKU-999');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('SKU-999');
    }
  });
});

describe('executeAdjustInventory', () => {
  it('adds stock with reason "received"', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);
    mockPost.mockResolvedValueOnce({
      adjustment: { quantity: 20, reason: 'received' },
      inventoryLevel: { previousOnHand: 50, newOnHand: 70, available: 65 },
    });

    const result = await executeAdjustInventory('SKU-001', 20, 'received');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newOnHand).toBe(70);
      expect(result.adjustedBy).toBe(20);
    }
    expect(mockPost).toHaveBeenCalledWith(
      '/api/products/inventory/adjust',
      expect.objectContaining({
        variantId: 'var-1',
        locationId: 'loc-1',
        quantity: 20,
        reason: 'received',
      }),
    );
  });

  it('removes stock with reason "damaged"', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);
    mockPost.mockResolvedValueOnce({
      adjustment: { quantity: -5, reason: 'damaged' },
      inventoryLevel: { previousOnHand: 50, newOnHand: 45, available: 40 },
    });

    const result = await executeAdjustInventory('SKU-001', -5, 'damaged');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newOnHand).toBe(45);
    }
  });

  it('returns error when adjustment would go negative', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);
    const err = new Error('Negative inventory') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'INVALID_ADJUSTMENT';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeAdjustInventory('SKU-001', -999, 'correction');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('negative inventory');
    }
  });

  it('returns error when SKU not found', async () => {
    mockGet.mockResolvedValueOnce({ data: [] });

    const result = await executeAdjustInventory('SKU-999', 10, 'received');

    expect(result.success).toBe(false);
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('executeSetInventory', () => {
  it('sets inventory to an exact quantity', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);
    mockPost.mockResolvedValueOnce({
      inventoryLevel: { previousOnHand: 50, newOnHand: 100, available: 95 },
    });

    const result = await executeSetInventory('SKU-001', 100);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newOnHand).toBe(100);
      expect(result.message).toContain('100');
    }
    expect(mockPost).toHaveBeenCalledWith(
      '/api/products/inventory/set',
      expect.objectContaining({ variantId: 'var-1', quantity: 100 }),
    );
  });

  it('rejects negative quantities without calling the API', async () => {
    const result = await executeSetInventory('SKU-001', -10);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('cannot be negative');
    }
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('allows setting quantity to zero', async () => {
    mockGet.mockResolvedValueOnce(MOCK_PRODUCT_SEARCH);
    mockGet.mockResolvedValueOnce(MOCK_INVENTORY_LEVELS);
    mockPost.mockResolvedValueOnce({
      inventoryLevel: { previousOnHand: 50, newOnHand: 0, available: 0 },
    });

    const result = await executeSetInventory('SKU-001', 0);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newOnHand).toBe(0);
    }
  });
});

describe('executeGetLowStockProducts', () => {
  it('returns products below their reorder points', async () => {
    mockGet.mockResolvedValueOnce({
      data: [
        {
          variantId: 'var-1',
          locationId: 'loc-1',
          available: 3,
          onHand: 3,
          reorderPoint: 10,
          location: { id: 'loc-1', name: 'Main Warehouse', code: 'WH-01' },
          product: { id: 'prod-1', name: 'Wireless Headphones' },
          variant: { id: 'var-1', name: 'Default', sku: 'SKU-001' },
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    const result = await executeGetLowStockProducts();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0].sku).toBe('SKU-001');
      expect(result.items[0].available).toBe(3);
    }
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('lowStock=true'),
    );
  });

  it('returns empty list message when all products are in stock', async () => {
    mockGet.mockResolvedValueOnce({
      data: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });

    const result = await executeGetLowStockProducts();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.items).toHaveLength(0);
      expect(result.message).toContain('No low-stock');
    }
  });
});
