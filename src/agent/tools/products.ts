import { tool } from 'ai';
import { z } from 'zod';
import { storeClient } from '../client';
import type { Product, ProductVariant } from '../../types';

interface ProductListResponse {
  data: Product[];
  pagination: { totalItems: number };
}

// ─── Standalone execute functions (exported for unit testing) ─────────────────

export async function executeFindProducts(search: string) {
  // Treat blank / list-all requests with a high limit and no search filter
  const isListAll = !search.trim();
  const url = isListAll
    ? `/api/products?limit=50&sortBy=name&sortOrder=asc`
    : `/api/products?search=${encodeURIComponent(search.trim())}&limit=20&sortBy=name&sortOrder=asc`;

  try {
    const result = await storeClient.get<ProductListResponse>(url);
    const products = result.data ?? [];

    if (products.length === 0) {
      return {
        success: true,
        products: [],
        message: isListAll
          ? 'No products found in the catalog.'
          : `No products found matching "${search}".`,
      };
    }

    return {
      success: true,
      products: products.map((p) => {
        const defaultVariant = p.variants.find((v) => v.isDefault) ?? p.variants[0];
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          price: defaultVariant?.price,
          sku: defaultVariant?.sku,
          variantId: defaultVariant?.id,
          variantCount: p.variants.length,
        };
      }),
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false,
      error: `Failed to search products: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeUpdateProductDescription(
  productId: string,
  description: string,
  shortDescription?: string
) {
  try {
    const body: Record<string, string> = { description };
    if (shortDescription !== undefined) body.shortDescription = shortDescription;

    const updated = await storeClient.put<Product>(`/api/products/${productId}`, body);
    return {
      success: true,
      message: `Product "${updated.name}" description updated successfully.`,
      product: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        shortDescription: updated.shortDescription,
      },
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      error:
        e.code === 'PRODUCT_NOT_FOUND'
          ? 'Product not found.'
          : `Failed to update description: ${e.message ?? 'unknown error'}`,
    };
  }
}

export async function executeUpdateProductPrice(sku: string, price: number) {
  if (price < 0) {
    return {
      success: false,
      error: 'Price must be a non-negative number.',
    };
  }

  // First find the product by SKU
  let product: Product | undefined;
  let targetVariant: ProductVariant | undefined;

  try {
    const result = await storeClient.get<ProductListResponse>(
      `/api/products?search=${encodeURIComponent(sku)}&limit=20`
    );
    const products = result.data ?? [];

    for (const p of products) {
      const variant = p.variants.find(
        (v) => v.sku.toLowerCase() === sku.toLowerCase()
      );
      if (variant) {
        product = p;
        targetVariant = variant;
        break;
      }
    }
  } catch (err: unknown) {
    const e = err as { message?: string };
    return {
      success: false,
      error: `Failed to find product with SKU "${sku}": ${e.message ?? 'unknown error'}`,
    };
  }

  if (!product || !targetVariant) {
    return {
      success: false,
      error: `No product variant found with SKU "${sku}".`,
    };
  }

  try {
    const updated = await storeClient.put<ProductVariant>(
      `/api/products/${product.id}/variants/${targetVariant.id}`,
      { price }
    );
    return {
      success: true,
      message: `Price for SKU "${sku}" (${product.name}) updated to $${price.toFixed(2)}.`,
      variant: {
        id: updated.id,
        sku: updated.sku,
        price: updated.price,
        productName: product.name,
      },
    };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      success: false,
      error:
        e.code === 'VARIANT_NOT_FOUND'
          ? `Variant with SKU "${sku}" not found.`
          : `Failed to update price: ${e.message ?? 'unknown error'}`,
    };
  }
}

// ─── ADK-style tool definitions (Vercel AI SDK FunctionTool equivalent) ──────

export const findProducts = tool({
  description:
    'Search for products by name, description, or SKU. ' +
    'Pass an empty string ("") to list ALL products in the catalog. ' +
    'Use this whenever the user asks to list products, show all SKUs, find a product, or look up a SKU before updating.',
  parameters: z.object({
    search: z
      .string()
      .describe(
        'Search term (product name, description, or SKU). Pass empty string "" to list all products.'
      ),
  }),
  execute: ({ search }) => executeFindProducts(search),
});

export const updateProductDescription = tool({
  description: 'Update the description (and optionally the short description) of a product.',
  parameters: z.object({
    productId: z.string().describe('The internal UUID of the product (from findProducts)'),
    description: z.string().describe('The new full description for the product'),
    shortDescription: z
      .string()
      .optional()
      .describe('Optional short description / tagline'),
  }),
  execute: ({ productId, description, shortDescription }) =>
    executeUpdateProductDescription(productId, description, shortDescription),
});

export const updateProductPrice = tool({
  description:
    'Update the price of a product variant identified by its SKU. ' +
    'Price must be a non-negative number.',
  parameters: z.object({
    sku: z.string().describe('The SKU of the product variant, e.g. SKU-001'),
    price: z.number().min(0).describe('The new price in dollars (must be ≥ 0)'),
  }),
  execute: ({ sku, price }) => executeUpdateProductPrice(sku, price),
});
