import { Quad } from "@rdfjs/types";
import { Parser } from "n3";
import { ActivityRDFMapper, ActivityQueryOptions, OxigraphStore } from "./activityRDFMapper";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ActivityMaterializedRdfStore {
  private static readonly SOURCE_LOAD_CONCURRENCY = 12;
  private storePromise: Promise<OxigraphStore>;
  private updateQueue: Promise<void> = Promise.resolve();
  private readonly sourceQuads: Map<string, Quad[]> = new Map<string, Quad[]>();
  private initialized = false;

  constructor(private readonly mapper: ActivityRDFMapper, private readonly fetchFn: FetchFn) {
    this.storePromise = ActivityRDFMapper.createEmptyStore();
  }

  public reset(): void {
    this.storePromise = ActivityRDFMapper.createEmptyStore();
    this.updateQueue = Promise.resolve();
    this.sourceQuads.clear();
    this.initialized = false;
  }

  public initialize(sources: string[]): Promise<void> {
    return this.enqueueUpdate(async () => {
      if (this.initialized) {
        return;
      }
      await this.rebuild(sources);
      this.initialized = true;
    });
  }

  public applySnapshot(sources: string[], invalidatedSources: string[] = []): Promise<void> {
    return this.enqueueUpdate(async () => {
      if (!this.initialized) {
        await this.rebuild(sources);
        this.initialized = true;
        return;
      }

      const nextSources = new Set(sources.map(source => this.normalizeSource(source)));
      const invalidated = new Set(invalidatedSources.map(source => this.normalizeSource(source)));
      const store = await this.storePromise;

      for (const source of Array.from(this.sourceQuads.keys())) {
        if (!nextSources.has(source) || invalidated.has(source)) {
          this.removeSource(store, source);
        }
      }

      await this.loadSources(
        store,
        Array.from(nextSources).filter(source => !this.sourceQuads.has(source))
      );
    });
  }

  public async query(sources: string[], options?: ActivityQueryOptions): Promise<unknown> {
    if (!this.initialized) {
      await this.initialize(sources);
    }
    await this.updateQueue;
    const store = await this.storePromise;
    return this.mapper.queryLoadedStore(store, options, {
      sourceCount: 1,
      activityLocationCount: this.sourceQuads.size,
      sources: ["[materialized-activity-store]"]
    });
  }

  private enqueueUpdate(task: () => Promise<void>): Promise<void> {
    const run = this.updateQueue.then(task, task);
    this.updateQueue = run.catch(error => {
      console.error("[ActivityMaterializedRdfStore] update failed", error);
    });
    return run;
  }

  private async rebuild(sources: string[]): Promise<void> {
    const store = await ActivityRDFMapper.createEmptyStore();
    this.sourceQuads.clear();
    const normalizedSources = Array.from(new Set(sources.map(value => this.normalizeSource(value))));
    await this.loadSources(store, normalizedSources);
    this.storePromise = Promise.resolve(store);
    console.info("[ActivityMaterializedRdfStore] rebuilt", {
      sourceCount: this.sourceQuads.size
    });
  }

  private async loadSource(store: OxigraphStore, source: string): Promise<void> {
    const quads = await this.fetchSourceQuads(source);
    if (!quads) {
      this.sourceQuads.delete(source);
      return;
    }

    quads.forEach(quad => ActivityRDFMapper.addQuadToStore(store, quad));
    this.sourceQuads.set(source, quads);
    console.info("[ActivityMaterializedRdfStore] source loaded", {
      source,
      quadCount: quads.length,
      sourceCount: this.sourceQuads.size
    });
  }

  private async loadSources(store: OxigraphStore, sources: string[]): Promise<void> {
    if (sources.length === 0) {
      return;
    }

    console.info("[ActivityMaterializedRdfStore] source batch load started", {
      sourceCount: sources.length,
      concurrency: ActivityMaterializedRdfStore.SOURCE_LOAD_CONCURRENCY
    });
    const startedAt = Date.now();
    let nextSourceIndex = 0;

    const loadNext = async (): Promise<void> => {
      const sourceIndex = nextSourceIndex++;
      if (sourceIndex >= sources.length) {
        return;
      }

      await this.loadSource(store, sources[sourceIndex]);
      return loadNext();
    };

    const workerCount = Math.min(ActivityMaterializedRdfStore.SOURCE_LOAD_CONCURRENCY, sources.length);
    await Promise.all(Array.from({ length: workerCount }, () => loadNext()));
    console.info("[ActivityMaterializedRdfStore] source batch load completed", {
      sourceCount: sources.length,
      elapsedMs: Date.now() - startedAt
    });
  }

  private async fetchSourceQuads(source: string): Promise<Quad[] | null> {
    const response = await this.fetchFn(source, { headers: { Accept: "text/turtle" } });
    if (response.status === 404) {
      console.info("[ActivityMaterializedRdfStore] source does not exist, skipping", { source });
      return null;
    }
    if (!response.ok) {
      throw new Error(`Failed to load materialized RDF source ${source}: ${response.status} ${response.statusText}`);
    }

    const body = await response.text();
    return this.parseRdf(body, source, response.headers.get("content-type"));
  }

  private removeSource(store: OxigraphStore, source: string): void {
    const quads = this.sourceQuads.get(source);
    if (!quads) {
      return;
    }
    quads.forEach(quad => ActivityRDFMapper.deleteQuadFromStore(store, quad));
    this.sourceQuads.delete(source);
    console.info("[ActivityMaterializedRdfStore] source removed", {
      source,
      quadCount: quads.length,
      sourceCount: this.sourceQuads.size
    });
  }

  private parseRdf(body: string, source: string, contentType: string | null): Quad[] {
    const parser = new Parser({
      baseIRI: source,
      format: this.getRdfFormat(contentType, source)
    });
    return parser.parse(body) as Quad[];
  }

  private getRdfFormat(contentType: string | null, source: string): string {
    const type = contentType?.split(";")[0].trim().toLowerCase();
    if (type) {
      if (type.includes("turtle")) return "text/turtle";
      if (type.includes("n-triples")) return "application/n-triples";
      if (type.includes("n-quads")) return "application/n-quads";
      if (type.includes("trig")) return "application/trig";
      if (type.includes("rdf+xml")) return "application/rdf+xml";
      if (type.includes("n3")) return "text/n3";
    }

    if (source.endsWith(".nt")) return "application/n-triples";
    if (source.endsWith(".nq")) return "application/n-quads";
    if (source.endsWith(".trig")) return "application/trig";
    if (source.endsWith(".rdf") || source.endsWith(".xml")) return "application/rdf+xml";
    if (source.endsWith(".n3")) return "text/n3";
    return "text/turtle";
  }

  private normalizeSource(source: string): string {
    try {
      const url = new URL(source);
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return source.split("#")[0];
    }
  }
}
