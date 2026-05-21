import { RdfFetchCache } from "./rdf-fetch-cache";

describe("RdfFetchCache", () => {
  let cache: RdfFetchCache;
  let now: number;

  beforeEach(() => {
    cache = new RdfFetchCache();
    now = 1000000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should always fetch HEAD requests", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await cache.fetch(fetchFn, "http://example.org/activity", { method: "HEAD" });
    await cache.fetch(fetchFn, "http://example.org/activity", { method: "HEAD" });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("should reuse a cached GET response while the ttl is valid", async () => {
    const fetchFn = jest.fn().mockResolvedValue(new Response("first", { status: 200, headers: { etag: '"v1"' } }));

    const first = await cache.fetch(fetchFn, "http://example.org/activity");
    now += 999;
    const second = await cache.fetch(fetchFn, "http://example.org/activity");

    expect(await first.text()).toBe("first");
    expect(await second.text()).toBe("first");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("should revalidate a stale GET response with the cached etag", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response("first", { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    await cache.fetch(fetchFn, "http://example.org/activity");
    now += 1001;
    const revalidated = await cache.fetch(fetchFn, "http://example.org/activity");

    expect(await revalidated.text()).toBe("first");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchFn.mock.calls[1][1]?.headers).get("if-none-match")).toBe('"v1"');
  });

  it("should keep the cached response when a stale GET returns the same etag", async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(new Response("first", { status: 200, headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response("second", { status: 200, headers: { etag: '"v1"' } }));

    await cache.fetch(fetchFn, "http://example.org/activity");
    now += 1001;
    const revalidated = await cache.fetch(fetchFn, "http://example.org/activity");

    expect(await revalidated.text()).toBe("first");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
