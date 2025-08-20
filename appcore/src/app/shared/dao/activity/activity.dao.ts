import { Inject, Injectable } from "@angular/core";
import { Activity } from "@elevate/shared/models/sync/activity.model";
import { QueryEngine } from "@incremunica/query-sparql-incremental";
import { isAddition } from "@incremunica/user-tools";
import { BindingsStream } from "@comunica/types";
import { SolidConnectorInfoService } from "../../services/solid-connector-info/solid-connector-info.service";
import fetch from "cross-fetch";
import { ActivityRDFMapper } from "./activityRDFMapper";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class ActivityDao {
  private source = "/activities";
  private activityMapping: ActivityRDFMapper;
  private queryEngine: QueryEngine;
  private activityLocationsBindingsStream: BindingsStream;
  private _activityLocations: string[] = [];
  private activityLocationPromise: Promise<void> | null;

  constructor(
    @Inject(SolidConnectorInfoService) private readonly solidConnectorInfoService: SolidConnectorInfoService
  ) {
    this.init();
  }

  public init(): void {
    this.activityMapping = new ActivityRDFMapper();
    this.queryEngine = new QueryEngine();
    this.subscribeActivityLocations();
  }

  get activityLocations() {
    if (this.activityLocationPromise) {
      return this.activityLocationPromise.then(() => this._activityLocations);
    }
    return Promise.resolve(this._activityLocations);
  }

  private async subscribeActivityLocations(): Promise<void> {
    const containerIri = `${this.solidConnectorInfoService.fetch().base}${this.source}/`;
    console.log(`Subscribing to activity locations at: ${containerIri}`);
    let response = await fetch(containerIri, {
      method: "HEAD"
    });
    if (!response.ok) {
      let response = await fetch(containerIri, {
        method: "POST"
      });
      if (!response.ok) {
        console.error("Error creating activity container:", containerIri, response.statusText);
        throw new Error(`Failed to create activity container at ${containerIri}`);
      }
    }
    if (this.activityLocationsBindingsStream) {
      this.activityLocationsBindingsStream.destroy();
    }

    const TIMEOUT_MS = 100;
    let resolve: () => void | null;
    let timeoutId: NodeJS.Timeout | null = null;

    this.activityLocationPromise = new Promise<void>(resolvingF => {
      resolve = resolvingF;
    });

    const resolveWithTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        if (resolve) {
          resolve();
          resolve = null;
          this.activityLocationPromise = null;
        }
      }, TIMEOUT_MS);
    };

    this.activityLocationsBindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX ldp: <http://www.w3.org/ns/ldp#>
SELECT ?activityIri WHERE {
  <${containerIri}> ldp:contains ?activityIri .
}
`,
      {
        sources: [containerIri],
        lenient: true
      }
    );

    this._activityLocations = [];
    const readBindingsStream = () => {
      let bindings = this.activityLocationsBindingsStream.read();
      if (!bindings) {
        return;
      }
      if (!resolve) {
        this.activityLocationPromise = new Promise<void>(resolvingF => {
          resolve = resolvingF;
        });
      }
      while (bindings) {
        resolveWithTimeout();
        console.log(bindings.toString());
        const activityIri = bindings.get("activityIri");
        if (activityIri) {
          const activityLocation = activityIri.value;
          if (isAddition(bindings)) {
            console.log(`Adding activity location: ${activityLocation}`);
            this._activityLocations.push(activityLocation);
          } else {
            this.activityLocations[this._activityLocations.find((location: string) => location === activityLocation)] =
              this._activityLocations.pop();
          }
        }
        bindings = this.activityLocationsBindingsStream.read();
      }
    };
    readBindingsStream();
    resolveWithTimeout();
    this.activityLocationsBindingsStream.on("readable", readBindingsStream);
  }

  private async getDefaultSources(sources?: string[]): Promise<[string, ...string[]]> {
    if (!sources || sources.length === 0) {
      return [this.solidConnectorInfoService.fetch().base + this.source + "/", ...(await this.activityLocations)];
    }
    if (!this.solidConnectorInfoService.fetch() || this.solidConnectorInfoService.fetch().base === "") {
      return Promise.resolve(["https://solidlabresearch.github.io/activity-ontology/", ...sources]);
    }
    return Promise.resolve([...sources]) as Promise<[string, ...string[]]>;
  }

  public async findByDatedSession(startTime: string, endTime: string): Promise<Activity[]> {
    return this.activityMapping.query(await this.getDefaultSources(), {
      filterKeys: [
        {
          key: "activity_startTime",
          relationKeyToValue: ">",
          value: new Date(startTime)
        },
        {
          key: "activity_endTime",
          relationKeyToValue: ">",
          value: new Date(endTime)
        }
      ]
    }) as Promise<Activity[]>;
  }

  public async findSorted(descending: boolean): Promise<Activity[]> {
    return this.activityMapping.query(await this.getDefaultSources(), {
      sort: {
        key: "activity_startTime",
        ascending: !descending
      }
    }) as Promise<Activity[]>;
  }

  public async hasActivitiesWithSettingsLacks(): Promise<boolean> {
    return this.activityMapping.query(await this.getDefaultSources(), {
      keys: ["activity_settingsLack"],
      boundKeys: [
        {
          key: "activity_settingsLack",
          value: true
        }
      ],
      type: "ask"
    }) as Promise<boolean>;
  }

  public async findActivitiesWithSettingsLacks(): Promise<Activity[]> {
    return this.activityMapping.query(await this.getDefaultSources(), {
      boundKeys: [
        {
          key: "activity_settingsLack",
          value: true
        }
      ]
    }) as Promise<Activity[]>;
  }

  public async find(options?: {
    keys?: string[];
    boundKeys?: { key: string; value: string | number | Date | boolean }[];
    filterKeys?: (
      | { key: string; relationKeyToValue: string; value: string | number | Date | boolean }
      | {
          requiredKeys: string[];
          condition: string;
        }
    )[];
    sort?: { key: string; ascending: boolean };
    slice?: { limit: number; offset?: number };
    type?: "select" | "count" | "ask";
  }): Promise<Activity[]> {
    return this.activityMapping.query(await this.getDefaultSources(), options) as Promise<Activity[]>;
  }

  /*
  public async findOne(query?: { queryString: string; sources: [string, ...string[]] }): Promise<Activity> {
    if (!query) {
      return Promise.resolve((await this.query(null, null))[0]);
    }
    return Promise.resolve((await this.query(query.queryString, query.sources, 1))[0]);
  }
  */

  public async getById(id: number | string): Promise<Activity> {
    let activityIri = `${this.solidConnectorInfoService.fetch().base}${this.source}/${id}#activity`;
    return (
      await this.activityMapping.query([activityIri], {
        boundKeys: [
          {
            key: "activity",
            value: activityIri
          }
        ],
        slice: {
          limit: 1
        }
      })
    )[0];
  }

  public async insert(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    let location = this.solidConnectorInfoService.fetch().base + this.source;
    if (!activity.id) {
      activity.id = uuidv4();
    }
    location += `/${activity.id}`;
    let promise = fetch(location, {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle"
      },
      body: this.activityMapping.write(location, activity)
    }).then(response => {
      if (!response.ok) {
        console.error("Error inserting document:", location, activity, response.statusText);
      }
    });
    if (waitSaveDrained) {
      await promise;
      return this.getById(activity.id);
    }
    return activity;
  }

  public async insertMany(activities: Activity[], waitSaveDrained: boolean = false): Promise<void> {
    let promises = activities.map((activity: Activity) => this.insert(activity, waitSaveDrained));
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  public async update(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    return this.insert(activity, waitSaveDrained);
  }

  public async put(activity: Activity, waitSaveDrained: boolean = false): Promise<Activity> {
    return this.insert(activity, waitSaveDrained);
  }

  public async remove(activity: Activity, waitSaveDrained: boolean = false): Promise<void> {
    let location = this.solidConnectorInfoService.fetch().base + this.source + `/${activity.id}`;
    let promise = fetch(location, {
      method: "DELETE"
    }).then(response => {
      if (!response.ok) {
        console.error("Error remove document:", location, activity, response.statusText);
      }
    });
    if (waitSaveDrained) {
      await promise;
    }
  }

  public async removeById(id: number | string, waitSaveDrained: boolean = false): Promise<void> {
    let location = this.solidConnectorInfoService.fetch().base + this.source + `/${id}`;
    let promise = fetch(location, {
      method: "DELETE"
    }).then(response => {
      if (!response.ok) {
        console.error("Error remove document by id:", location, id, response.statusText);
      }
    });
    if (waitSaveDrained) {
      await promise;
    }
  }

  public async removeByManyIds(ids: (number | string)[], waitSaveDrained: boolean = false): Promise<void> {
    let promises = ids.map((id: number | string) => this.removeById(id, waitSaveDrained));
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  /**
   * Count elements in datastore
   */
  public async count(options?: {
    boundKeys?: { key: string; value: any }[];
    filterKeys?: { key: string; relationKeyToValue: string; value: string | number | boolean | Date }[];
  }): Promise<number> {
    if (!options) {
      options = {
        boundKeys: [],
        filterKeys: []
      };
    }
    let keys = ["activity"];
    if (options.boundKeys) {
      options.boundKeys.forEach(boundKey => {
        if (!keys.includes(boundKey.key)) {
          keys.push(boundKey.key);
        }
      });
    }
    if (options.filterKeys) {
      options.filterKeys.forEach(filterKey => {
        if (!keys.includes(filterKey.key)) {
          keys.push(filterKey.key);
        }
      });
    }
    return this.activityMapping.query(await this.getDefaultSources(), {
      keys: keys,
      boundKeys: options.boundKeys,
      filterKeys: options.filterKeys,
      type: "count"
    }) as Promise<number>;
  }

  /**
   * Clear all data
   */
  public async clear(waitSaveDrained: boolean = false): Promise<void> {
    const promises = (await this.activityLocations).map(location => {
      return fetch(location, {
        method: "DELETE"
      }).then(response => {
        if (!response.ok) {
          console.error("Error clearing document:", location, response.statusText);
        }
      });
    });
    if (waitSaveDrained) {
      await Promise.all(promises);
    }
  }

  public async persist(waitSaveDrained: boolean = false): Promise<void> {
    console.error("BaseDao.persist() not implemented, I don't think this is necessary.");
  }
}
