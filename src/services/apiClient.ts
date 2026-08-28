export type ApiError = Error & { status: number; body?: unknown };
export type TokenProvider = () => Promise<string | undefined>;

let tokenProvider: TokenProvider | undefined;
export function setAccessTokenProvider(provider?: TokenProvider) {
  tokenProvider = provider;
}

async function authorizedHeaders(headers?: HeadersInit) {
  const next = new Headers(headers);
  const token = await tokenProvider?.();
  if (token) next.set('Authorization', `Bearer ${token}`);
  return next;
}

async function request(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, { ...init, headers: await authorizedHeaders(init.headers) });
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status})`) as ApiError;
    error.status = response.status;
    try { error.body = await response.json(); } catch { /* Response did not contain JSON. */ }
    throw error;
  }
  return response.json() as Promise<T>;
}

export const apiClient = {
  fetch: request,
  get: <T>(url: string, init?: RequestInit) => request(url, init).then(unwrap<T>),
  post: async <TResponse, TBody>(url: string, body: TBody, init?: RequestInit) => {
    const headers = await authorizedHeaders(init?.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return unwrap<TResponse>(await fetch(url, { ...init, method: 'POST', headers, body: JSON.stringify(body) }));
  },
  stream: async (url: string, init?: RequestInit): Promise<ReadableStream<Uint8Array>> => {
    const headers = await authorizedHeaders(init?.headers);
    headers.set('Accept', 'text/event-stream');
    const response = await fetch(url, { ...init, headers });
    if (!response.ok || !response.body) throw await responseError(response);
    return response.body;
  },
};

async function responseError(response: Response): Promise<ApiError> {
  const error = new Error(`Request failed (${response.status})`) as ApiError;
  error.status = response.status;
  try { error.body = await response.json(); } catch { /* Response did not contain JSON. */ }
  return error;
}
