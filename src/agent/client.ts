const BASE_URL = process.env.STORE_API_BASE_URL || 'http://localhost:3000';

export interface StoreApiError extends Error {
  code?: string;
  statusCode?: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  } catch (err) {
    const error = new Error(
      `Network error calling store API at ${path}: ${(err as Error).message}`
    ) as StoreApiError;
    error.code = 'NETWORK_ERROR';
    throw error;
  }

  let json: ApiResponse<T>;
  try {
    json = (await response.json()) as ApiResponse<T>;
  } catch {
    const error = new Error(`Invalid JSON response from store API at ${path}`) as StoreApiError;
    error.code = 'INVALID_RESPONSE';
    error.statusCode = response.status;
    throw error;
  }

  if (!response.ok || !json.success) {
    const error = new Error(
      json.error?.message || `Store API error: HTTP ${response.status}`
    ) as StoreApiError;
    error.code = json.error?.code;
    error.statusCode = response.status;
    throw error;
  }

  return json.data as T;
}

export const storeClient = {
  get: <T>(path: string): Promise<T> => request<T>(path),

  post: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  put: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
