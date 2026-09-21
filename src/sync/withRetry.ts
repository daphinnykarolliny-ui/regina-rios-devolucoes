export interface RetryOptions {
  retries: number;
  delayMs: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = { retries: 3, delayMs: 1000 },
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < options.retries) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
