type ApiHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => Promise<Response> | Response;

const SOURCE_HEADER_CANDIDATES = [
  'x-data-source',
  'x-vessel-source',
  'x-gate-source',
  'x-truck-source',
  'x-vessel-alert-source',
  'x-gate-alert-source',
  'x-truck-alert-source',
];

function compactSource(headers: Headers): string | null {
  const collected: string[] = [];
  for (const key of SOURCE_HEADER_CANDIDATES) {
    const value = headers.get(key);
    if (value) collected.push(`${key}=${value}`);
  }
  if (collected.length === 0) return null;
  return collected.join('; ');
}

function isLiveFromSource(sourceText: string | null): boolean | null {
  if (!sourceText) return null;
  if (/\bLIVE\b/i.test(sourceText)) return true;
  if (/\bSIMULATION\b/i.test(sourceText)) return false;
  return null;
}

export function withApiLogging<TArgs extends unknown[]>(
  method: string,
  routePath: string,
  handler: ApiHandler<TArgs>
) {
  return async (...args: TArgs) => {
    const start = Date.now();
    console.log(`[API][HIT] ${method.toUpperCase()} ${routePath}`);

    try {
      const response = await handler(...args);
      const status = response.status;
      const elapsedMs = Date.now() - start;
      const source = compactSource(response.headers);
      const inferredLive = isLiveFromSource(source);
      const serviceUp = status < 500;

      const healthText = serviceUp ? 'WORKING' : 'ERROR';
      const liveText =
        inferredLive == null
          ? serviceUp
            ? 'LIVE=YES'
            : 'LIVE=NO'
          : inferredLive
            ? 'LIVE=YES'
            : 'LIVE=NO';
      const sourceText = source ? ` | source: ${source}` : '';

      const logger = serviceUp ? console.log : console.error;
      logger(
        `[API][${healthText}] ${method.toUpperCase()} ${routePath} -> ${status} (${elapsedMs}ms) | ${liveText}${sourceText}`
      );

      return response;
    } catch (error) {
      const elapsedMs = Date.now() - start;
      console.error(
        `[API][ERROR] ${method.toUpperCase()} ${routePath} threw after ${elapsedMs}ms`,
        error
      );
      throw error;
    }
  };
}
