type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface CachedResponse {
  response: Response;
  etag: string | null;
  expiresAt: number;
}

export class RdfFetchCache {
  private static readonly CACHE_TTL_MS = 1000;

  private readonly cachedResponses: Map<string, CachedResponse>;
  private readonly inFlightResponses: Map<string, Promise<Response>>;

  constructor() {
    this.cachedResponses = new Map<string, CachedResponse>();
    this.inFlightResponses = new Map<string, Promise<Response>>();
  }

  public fetch(fetchFn: FetchFn, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method || "GET").toUpperCase();
    if (method === "HEAD") {
      return fetchFn(input, init);
    }
    if (method !== "GET") {
      this.clear();
      return fetchFn(input, init).finally(() => this.clear());
    }

    const cacheKey = this.buildCacheKey(method, input, init);
    const cachedResponse = this.cachedResponses.get(cacheKey);
    if (cachedResponse && cachedResponse.expiresAt > Date.now()) {
      return Promise.resolve(cachedResponse.response.clone());
    }

    const inFlightResponse = this.inFlightResponses.get(cacheKey);
    if (inFlightResponse) {
      return inFlightResponse.then(response => response.clone());
    }

    const responsePromise = this.fetchAndCache(fetchFn, input, init, cacheKey, cachedResponse).finally(() => {
      this.inFlightResponses.delete(cacheKey);
    });

    this.inFlightResponses.set(cacheKey, responsePromise);
    return responsePromise.then(response => response.clone());
  }

  public clear(): void {
    this.cachedResponses.clear();
    this.inFlightResponses.clear();
  }

  private async fetchAndCache(
    fetchFn: FetchFn,
    input: RequestInfo | URL,
    init: RequestInit,
    cacheKey: string,
    cachedResponse?: CachedResponse
  ): Promise<Response> {
    const response = await fetchFn(input, this.withRevalidationHeaders(init, cachedResponse));
    if (cachedResponse && response.status === 304) {
      cachedResponse.expiresAt = this.nextExpiry();
      return cachedResponse.response;
    }

    if (response.ok) {
      const etag = response.headers.get("etag");
      if (cachedResponse && cachedResponse.etag && etag === cachedResponse.etag) {
        cachedResponse.expiresAt = this.nextExpiry();
        return cachedResponse.response;
      }

      this.cachedResponses.set(cacheKey, {
        response: response.clone(),
        etag,
        expiresAt: this.nextExpiry()
      });
    }

    return response;
  }

  private withRevalidationHeaders(init: RequestInit, cachedResponse?: CachedResponse): RequestInit {
    if (!cachedResponse?.etag) {
      return init;
    }

    const headers = new Headers(init.headers || {});
    if (!headers.has("if-none-match")) {
      headers.set("if-none-match", cachedResponse.etag);
    }
    return { ...init, headers };
  }

  private nextExpiry(): number {
    return Date.now() + RdfFetchCache.CACHE_TTL_MS;
  }

  private buildCacheKey(method: string, input: RequestInfo | URL, init: RequestInit): string {
    return [method, this.resolveRequestTarget(input), this.headersKey(init.headers)].join(" ");
  }

  private resolveRequestTarget(input: RequestInfo | URL): string {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    return input.url;
  }

  private headersKey(headersInit: HeadersInit | undefined): string {
    if (!headersInit) {
      return "";
    }

    const entries: [string, string][] = [];
    new Headers(headersInit).forEach((value, key) => {
      entries.push([key, value]);
    });
    return entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
  }
}

export const activityRdfFetchCache = new RdfFetchCache();
