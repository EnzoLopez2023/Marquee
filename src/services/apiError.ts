export function apiErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== 'object') return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code.replaceAll('_', ' ');
  }
  return fallback;
}
