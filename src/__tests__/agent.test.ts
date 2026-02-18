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
  executeCancelOrder,
  executeGetOrderByNumber,
  executeUpdateOrderStatus,
} from '../agent/tools/orders';
import {
  executeFindProducts,
  executeUpdateProductDescription,
  executeUpdateProductPrice,
} from '../agent/tools/products';

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

describe('executeUpdateOrderStatus', () => {
  it('updates status successfully', async () => {
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'shipped',
    });

    const result = await executeUpdateOrderStatus('uuid-123', 'shipped');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('shipped');
      expect(result.order.status).toBe('shipped');
    }
    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/status', { status: 'shipped' });
  });

  it('rejects an invalid status without calling the API', async () => {
    const result = await executeUpdateOrderStatus('uuid-123', 'invalid_status');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('"invalid_status" is not a valid status');
    }
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('handles ORDER_ALREADY_CANCELLED error', async () => {
    const err: NodeJS.ErrnoException = new Error('Already cancelled') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_ALREADY_CANCELLED';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeUpdateOrderStatus('uuid-123', 'cancelled');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('already been cancelled');
    }
  });
});

describe('executeCancelOrder', () => {
  it('cancels an order successfully', async () => {
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'cancelled',
    });

    const result = await executeCancelOrder('uuid-123', 'Customer request');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.message).toContain('cancelled');
    }
    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/cancel', {
      reason: 'Customer request',
    });
  });

  it('uses a default reason when none is provided', async () => {
    mockPost.mockResolvedValueOnce({
      id: 'uuid-123',
      orderNumber: 'ORD-1001',
      status: 'cancelled',
    });

    await executeCancelOrder('uuid-123');

    expect(mockPost).toHaveBeenCalledWith('/api/orders/uuid-123/cancel', {
      reason: 'Cancelled by admin',
    });
  });

  it('handles ORDER_ALREADY_CANCELLED error', async () => {
    const err: NodeJS.ErrnoException = new Error('Already cancelled') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'ORDER_ALREADY_CANCELLED';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeCancelOrder('uuid-123');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('already been cancelled');
    }
  });

  it('handles INVALID_ORDER_STATUS for completed orders', async () => {
    const err: NodeJS.ErrnoException = new Error('Invalid status') as NodeJS.ErrnoException;
    (err as unknown as Record<string, unknown>).code = 'INVALID_ORDER_STATUS';
    mockPost.mockRejectedValueOnce(err);

    const result = await executeCancelOrder('uuid-123');

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
