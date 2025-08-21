import { Activity, ActivityFlag, Lap, Peak, Scores, SlopeProfile } from "@elevate/shared/models/sync/activity.model";
import { QueryEngine } from "@comunica/query-sparql";
import { AsyncIterator } from "asynciterator";
import { Bindings, Term } from "@rdfjs/types";
import { ZoneModel } from "@elevate/shared/models/zone.model";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { v4 as uuidv4 } from "uuid";
import { ActivitySparqlFieldMap } from "./activitySparqlFieldMap";
//import { fetch as cfetch } from "cross-fetch";

export class ActivityRDFMapper {
  private queryEngine: QueryEngine;

  constructor() {
    this.queryEngine = new QueryEngine();
  }

  // Type guard functions for better type safety
  private isKeyFilterType(
    filterKey: any
  ): filterKey is { key: string; relationKeyToValue: string; value: string | number | Date | boolean } {
    return "key" in filterKey && "relationKeyToValue" in filterKey && "value" in filterKey;
  }

  private isConditionFilterType(filterKey: any): filterKey is { requiredKeys: string[]; condition: string } {
    return "requiredKeys" in filterKey && "condition" in filterKey;
  }

  private parseTerm(term: Term) {
    if (term.termType === "Literal") {
      // Handle literal values
      if (term.datatype && term.datatype.value === "http://www.w3.org/2001/XMLSchema#dateTime") {
        return new Date(term.value).toDateString();
      } else if (term.datatype && term.datatype.value === "http://www.w3.org/2001/XMLSchema#integer") {
        return parseInt(term.value);
      } else if (
        term.datatype &&
        (term.datatype.value === "http://www.w3.org/2001/XMLSchema#double" ||
          term.datatype.value === "http://www.w3.org/2001/XMLSchema#float")
      ) {
        return parseFloat(term.value);
      } else if (term.datatype && term.datatype.value === "http://www.w3.org/2001/XMLSchema#boolean") {
        return term.value === "true";
      }
    }
    return term.value;
  }

  private encodeTerm(value: string | number | Date | boolean): string {
    if (typeof value === "string") {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        return `<${value}>`;
      }
      if (value.startsWith("<") && value.endsWith(">")) {
        return value;
      }
      return `"${value.replace(/"/g, '\\"')}"`;
    } else if (typeof value === "number") {
      return `"${value}"^^<http://www.w3.org/2001/XMLSchema#double>`;
    } else if (typeof value === "boolean") {
      return `"${value}"^^<http://www.w3.org/2001/XMLSchema#boolean>`;
    } else if (value instanceof Date) {
      return `"${value.toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime>`;
    }
    throw new Error("Unsupported term type for encoding: " + typeof value);
  }

  public async query(
    sources: [string, ...string[]],
    options?: {
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
    }
  ): Promise<Activity[] | number | boolean> {
    if (!options) {
      options = {};
    }

    let query = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;

    if (options.type === "count") {
      query += "SELECT (COUNT(?activity) AS ?count) WHERE {\n";
    } else if (options.type === "ask") {
      query += "ASK {\n";
    } else {
      query += "SELECT * WHERE {\n";
    }

    let completeActivity = false;
    let needsFlags = false;
    if (!options.keys || options.keys.length === 0) {
      options.keys = Object.keys(ActivitySparqlFieldMap);
      completeActivity = true;
    } else {
      let keysSet = new Set(options.keys);
      options.filterKeys?.forEach(filterKey => {
        if (this.isKeyFilterType(filterKey)) {
          keysSet.add(filterKey.key);
        }
        if (this.isConditionFilterType(filterKey)) {
          filterKey.requiredKeys.forEach(requiredKey => {
            keysSet.add(requiredKey);
          });
        }
      });
      options.boundKeys?.forEach(boundKey => {
        if (boundKey.key) {
          keysSet.add(boundKey.key);
        }
      });
      if (options.sort?.key) {
        keysSet.add(options.sort?.key);
      }
      keysSet.delete("activity");
      keysSet.delete("activity_id");
      if (keysSet.has("activity_flags")) {
        needsFlags = true;
        keysSet.delete("activity_flags");
      }
      options.keys = Array.from(keysSet);
    }

    let queryTree = {
      graphPattern: "?activity a activo:Activity .\n",
      children: {}
    };

    for (const key of options.keys) {
      if (ActivitySparqlFieldMap[key] === undefined) {
        console.trace();
        console.error("Activity component mapping for key: " + key + " is not defined.");
        break;
      }
      const component = ActivitySparqlFieldMap[key];
      const provenance = [key];
      let workingComponent = component;
      while (workingComponent.requiredVariable != "activity") {
        if (provenance[provenance.length - 1] === workingComponent.requiredVariable) {
          console.error("Circular dependency detected in activity component mapping for key: " + key);
        }
        provenance.push(workingComponent.requiredVariable);
        workingComponent = ActivitySparqlFieldMap[workingComponent.requiredVariable];
      }
      let workingNode = queryTree;
      for (let i = provenance.length - 1; i >= 0; i--) {
        const variable = provenance[i];
        if (!workingNode.children[variable]) {
          workingNode.children[variable] = {
            graphPattern: ActivitySparqlFieldMap[variable].graphPattern,
            required: ActivitySparqlFieldMap[variable].required,
            children: {}
          };
        }
        workingNode = workingNode.children[variable];
      }
    }

    // Add bound keys to the query tree
    for (const boundKey of options.boundKeys ?? []) {
      const key = boundKey.key;
      const value = boundKey.value;
      query += `BIND(${this.encodeTerm(value)} AS ?${key})\n`;
    }

    // Construct query from tree
    const constructQuery = (node: any): string => {
      let queryPart = node.graphPattern;
      for (const childKey in node.children) {
        const nestedQuery = constructQuery(node.children[childKey]);
        if (nestedQuery == "") {
          continue;
        }
        if (node.children[childKey].required) {
          queryPart += nestedQuery + "\n";
        } else {
          queryPart += "OPTIONAL {\n";
          queryPart += nestedQuery + "\n";
          queryPart += "}\n";
        }
      }
      return queryPart;
    };
    query += constructQuery(queryTree);

    // Add filter keys to the query
    for (const filterKey of options.filterKeys ?? []) {
      if (this.isKeyFilterType(filterKey)) {
        query += `FILTER(?${filterKey.key} ${filterKey.relationKeyToValue} ${this.encodeTerm(filterKey.value)})\n`;
      }
      if (this.isConditionFilterType(filterKey)) {
        query += `FILTER(${filterKey.condition})\n`;
      }
    }

    query += "\n}\n";

    // add logic for sorting and slicing
    if (options.sort) {
      if (options.sort.ascending) {
        query += "ORDER BY ?" + options.sort.key + "\n";
      } else {
        query += "ORDER BY DESC(?" + options.sort.key + ")\n";
      }
    }
    if (options.slice) {
      if (options.slice.limit) {
        query += "LIMIT " + options.slice.limit + "\n";
      }
      if (options.slice.offset) {
        query += "OFFSET " + options.slice.offset + "\n";
      }
    }
    console.log("Querying activities,", query);

    if (options.type === "ask") {
      return this.queryEngine.queryBoolean(query, {
        sources: [...sources, "https://solidlabresearch.github.io/activity-ontology/"],
        lenient: true
      });
    }

    // do query
    const bindingsStream: AsyncIterator<Bindings> = await this.queryEngine.queryBindings(query, {
      sources: [...sources, "https://solidlabresearch.github.io/activity-ontology/"],
      lenient: true
    });

    if (options.type === "count") {
      return new Promise<number>((resolve, reject) => {
        let count = 0;
        bindingsStream.on("data", (bindings: Bindings) => {
          count = parseInt(bindings.get("count").value);
        });
        bindingsStream.on("end", () => {
          resolve(count);
        });
        bindingsStream.on("error", (error: Error) => {
          reject(error);
        });
      });
    }

    let result: Activity[] = [];
    try {
      result = await bindingsStream
        .transform({
          transform: async (bindings: Bindings, done: () => void, push: (activity: Activity) => void) => {
            const activity = new Activity();
            const activityIriParts = bindings.get("activity").value.split("/");
            activity.id = activityIriParts[activityIriParts.length - 1].split("#")[0];
            activity.connector = ConnectorType.SOLID;

            for (const key of options.keys) {
              if (ActivitySparqlFieldMap[key].ignore) {
                continue;
              }
              const activityAttributes = key.split("_").slice(1);
              let workingObject = activity;
              for (let i = 0; i < activityAttributes.length; i++) {
                const attribute = activityAttributes[i];
                if (i === activityAttributes.length - 1) {
                  // last attribute, set value
                  let value = null;
                  if (ActivitySparqlFieldMap[key].formatValue) {
                    value = ActivitySparqlFieldMap[key].formatValue(bindings);
                  } else if (bindings.has(key)) {
                    value = this.parseTerm(bindings.get(key));
                  }
                  workingObject[attribute] = value;
                } else {
                  // not the last attribute, ensure the object exists
                  if (!workingObject[attribute]) {
                    workingObject[attribute] = {};
                  }
                  workingObject = workingObject[attribute];
                }
              }
            }

            const promises = [];
            if (completeActivity || needsFlags) {
              promises.push(
                this.queryFlags(bindings.get("activity").value, sources).then(result => {
                  activity.flags = result;
                })
              );
            }

            if (completeActivity) {
              // We also need to query Peak, Zones, Lap, and Flag data
              promises.push(
                this.queryLaps(bindings.get("activity").value, sources).then(result => {
                  activity.laps = result;
                })
              );

              // Stats
              if (bindings.get("activity_stats_speed")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_stats_speed").value, sources).then(result => {
                    if (result) {
                      activity.stats.speed.peaks = result;
                    }
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_speed").value, sources).then(result => {
                    if (result) {
                      activity.stats.speed.zones = result;
                    }
                  })
                );
              }

              if (bindings.get("activity_stats_pace")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_pace").value, sources).then(result => {
                    activity.stats.pace.zones = result;
                  })
                );
              }

              if (bindings.get("activity_stats_power")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_stats_power").value, sources).then(result => {
                    activity.stats.power.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_power").value, sources).then(result => {
                    activity.stats.power.zones = result;
                  })
                );
              }

              if (bindings.get("activity_stats_heartRate")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_stats_heartRate").value, sources).then(result => {
                    activity.stats.heartRate.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_heartRate").value, sources).then(result => {
                    activity.stats.heartRate.zones = result;
                  })
                );
              }

              if (bindings.get("activity_stats_cadence")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_stats_cadence").value, sources).then(result => {
                    activity.stats.cadence.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_cadence").value, sources).then(result => {
                    activity.stats.cadence.zones = result;
                  })
                );
              }

              if (bindings.get("activity_stats_grade")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_grade").value, sources).then(result => {
                    activity.stats.grade.zones = result;
                  })
                );
              }

              if (bindings.get("activity_stats_elevation")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_stats_elevation").value, sources).then(result => {
                    activity.stats.elevation.elevationZones = result;
                  })
                );
              }

              // srcStats
              if (bindings.get("activity_srcStats_speed")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_srcStats_speed").value, sources).then(result => {
                    if (result) {
                      activity.srcStats.speed.peaks = result;
                    }
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_speed").value, sources).then(result => {
                    if (result) {
                      activity.srcStats.speed.zones = result;
                    }
                  })
                );
              }

              if (bindings.get("activity_srcStats_pace")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_pace").value, sources).then(result => {
                    activity.srcStats.pace.zones = result;
                  })
                );
              }

              if (bindings.get("activity_srcStats_power")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_srcStats_power").value, sources).then(result => {
                    activity.srcStats.power.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_power").value, sources).then(result => {
                    activity.srcStats.power.zones = result;
                  })
                );
              }

              if (bindings.get("activity_srcStats_heartRate")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_srcStats_heartRate").value, sources).then(result => {
                    activity.srcStats.heartRate.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_heartRate").value, sources).then(
                    result => {
                      activity.srcStats.heartRate.zones = result;
                    }
                  )
                );
              }

              if (bindings.get("activity_srcStats_cadence")) {
                promises.push(
                  this.queryPeaks(bindings.get("activity_srcStats_cadence").value, sources).then(result => {
                    activity.srcStats.cadence.peaks = result;
                  })
                );
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_cadence").value, sources).then(result => {
                    activity.srcStats.cadence.zones = result;
                  })
                );
              }

              if (bindings.get("activity_srcStats_grade")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_grade").value, sources).then(result => {
                    activity.srcStats.grade.zones = result;
                  })
                );
              }

              if (bindings.get("activity_srcStats_elevation")) {
                promises.push(
                  this.complicatedQueryZones(bindings.get("activity_srcStats_elevation").value, sources).then(
                    result => {
                      activity.srcStats.elevation.elevationZones = result;
                    }
                  )
                );
              }
            }

            await Promise.all(promises);

            push(activity);
            done();
          }
        })
        .toArray();
    } catch (error) {
      console.error("Error processing bindings stream:", error);
    }

    return result.length > 0 ? result : null;
  }

  private async queryLaps(activityId: string, sources: [string, ...string[]]): Promise<Lap[] | null> {
    const bindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
SELECT
?lapIndex
?lapStart
?lapEnd
?isActive
?distance
?elapsedTime
?movingTime
?calories
?swolf25m
?swolf50m
?avgSpeed
?maxSpeed
?avgPace
?maxPace
?avgCadence
?avgHr
?maxHr
?avgWatts
?elevationGain
WHERE {
  <${activityId}> activo:hasLap ?lap .
  ?lap activo:lapIndex ?lapIndex .
  ?lap activo:lapStart ?lapStart .
  ?lap activo:lapEnd ?lapEnd .
  ?lap activo:isActive ?isActive .

  ?lap activo:hasStats ?stats .
  OPTIONAL { ?stats activo:distance ?distance . }
  OPTIONAL { ?stats activo:elapsedTime ?elapsedTime . }
  OPTIONAL { ?stats activo:movingTime ?movingTime . }
  OPTIONAL { ?stats activo:calories ?calories . }
  OPTIONAL {
    ?stats activo:hasScores ?scores .
    OPTIONAL { ?scores activo:swolf25 ?swolf25m . }
    OPTIONAL { ?scores activo:swolf50 ?swolf50m . }
  }
  OPTIONAL {
    ?stats activo:hasSpeedStats ?speedStats .
    OPTIONAL { ?speedStats activo:average ?avgSpeed . }
    OPTIONAL { ?speedStats activo:max ?maxSpeed . }
  }
  OPTIONAL {
    ?stats activo:hasPaceStats ?paceStats .
    OPTIONAL { ?paceStats activo:average ?avgPace . }
    OPTIONAL { ?paceStats activo:max ?maxPace . }
  }
  OPTIONAL {
    ?stats activo:hasCadenceStats ?cadenceStats .
    ?cadenceStats activo:average ?avgCadence .
  }
  OPTIONAL {
    ?stats activo:hasHeartRateStats ?heartRateStats .
    OPTIONAL { ?heartRateStats activo:average ?avgHr . }
    OPTIONAL { ?heartRateStats activo:max ?maxHr . }
  }
  OPTIONAL {
    ?stats activo:hasPowerStats ?powerStats .
    ?powerStats activo:average ?avgWatts .
  }
  OPTIONAL {
    ?stats activo:hasElevationStats ?elevationStats .
    ?elevationStats activo:ascent ?elevationGain .
  }
}
ORDER BY ?lapIndex
    `,
      {
        sources,
        lenient: true
      }
    );

    let laps = await bindingsStream
      .map((bindings: Bindings) => {
        const lap: Lap = {
          id: parseInt(bindings.get("lapIndex").value),
          indexes: [parseInt(bindings.get("lapStart").value), parseInt(bindings.get("lapEnd").value)],
          active: bindings.get("isActive").value === "true"
        };

        for (const key of bindings.keys()) {
          if (
            key.value === "lapIndex" ||
            key.value === "lapStart" ||
            key.value === "lapEnd" ||
            key.value === "isActive"
          ) {
            continue; // Skip these keys as they are already handled
          }
          let term = bindings.get(key);
          if (term) {
            lap[key.value] = this.parseTerm(term);
          }
        }

        return lap;
      })
      .toArray();

    return laps.length > 0 ? laps : null;
  }

  private async queryFlags(activityId: string, sources: [string, ...string[]]): Promise<ActivityFlag[] | null> {
    const bindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
SELECT ?index WHERE {
  <${activityId}> activo:hasFlag ?flag .

  # Define mapping between flag URIs and enum indices
  VALUES (?flag ?index) {
    (activo:MOVING_TIME_GREATER_THAN_ELAPSED 0)
    (activo:SPEED_AVG_ABNORMAL 1)
    (activo:SPEED_STD_DEV_ABNORMAL 2)
    (activo:ASCENT_SPEED_ABNORMAL 3)
    (activo:PACE_AVG_FASTER_THAN_GAP 4)
    (activo:POWER_AVG_KG_ABNORMAL 5)
    (activo:POWER_THRESHOLD_ABNORMAL 6)
    (activo:HR_AVG_ABNORMAL 7)
    (activo:SCORE_HRSS_PER_HOUR_ABNORMAL 8)
    (activo:SCORE_PSS_PER_HOUR_ABNORMAL 9)
    (activo:SCORE_RSS_PER_HOUR_ABNORMAL 10)
    (activo:SCORE_SSS_PER_HOUR_ABNORMAL 11)
  }
}
    `,
      {
        sources: ["https://solidlabresearch.github.io/activity-ontology/", ...sources],
        lenient: true
      }
    );
    const result = await bindingsStream
      .map((bindings: Bindings) => {
        return parseInt(bindings.get("index").value) as ActivityFlag;
      })
      .toArray();

    return result.length > 0 ? result : null;
  }

  private async queryPeaks(statId: string, sources: [string, ...string[]]): Promise<Peak[] | null> {
    const bindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
SELECT * WHERE {
  <${statId}> activo:hasPeak ?peak .
  ?peak activo:peakStart ?peakStart .
  ?peak activo:peakDuration ?peakDuration .
  ?peak activo:peakValue ?peakValue .
}
ORDER BY ?peakDuration
    `,
      {
        sources,
        lenient: true
      }
    );
    const result = await bindingsStream
      .map((bindings: Bindings) => {
        return {
          start: parseInt(bindings.get("peakStart").value),
          range: parseInt(bindings.get("peakDuration").value),
          end: parseInt(bindings.get("peakStart").value) + parseInt(bindings.get("peakDuration").value),
          result: parseFloat(bindings.get("peakValue").value)
        };
      })
      .toArray();
    return result.length > 0 ? result : null;
  }

  private async simpleQueryZones(statId: string, sources: [string, ...string[]]): Promise<ZoneModel[] | null> {
    const bindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
SELECT * WHERE {
  <${statId}> activo:hasZone ?zone .
  ?zone activo:zoneStart ?zoneStart .
  ?zone activo:zoneIndex ?zoneIndex .
  ?zone activo:time ?time .
}
    `,
      {
        sources,
        lenient: true
      }
    );
    let totalTime = 0;
    const zones = [];
    bindingsStream.on("data", (bindings: Bindings) => {
      const partialZone = {
        from: parseInt(bindings.get("zoneStart").value),
        s: parseFloat(bindings.get("time").value)
      };
      const index = parseInt(bindings.get("zoneIndex").value);
      while (zones.length <= index) {
        zones.push(null);
      }
      zones[index] = partialZone;
      totalTime += partialZone.s;
    });

    await new Promise(resolve => bindingsStream.on("end", resolve));

    for (let i = 0; i < zones.length; i++) {
      if (zones[i]) {
        zones[i].to = i === zones.length - 1 ? null : zones[i + 1].from;
        zones[i].percent = (zones[i].s / totalTime) * 100; // Calculate percentage of total time
      }
    }

    return zones.length > 0 ? zones : null;
  }

  private async complicatedQueryZones(statId: string, sources: [string, ...string[]]): Promise<ZoneModel[] | null> {
    const bindingsStream = await this.queryEngine.queryBindings(
      `
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
SELECT ?zoneStart ?zoneIndex ?time ?percent ?to WHERE {
  # Calculate total time for percentage
  {
    SELECT (SUM(?allTime) AS ?totalTime) WHERE {
      <${statId}> activo:hasZone ?allZone .
      ?allZone activo:time ?allTime .
    }
  }

  <${statId}> activo:hasZone ?zone .
  ?zone activo:zoneStart ?zoneStart .
  ?zone activo:zoneIndex ?zoneIndex .
  ?zone activo:time ?time .

  # Calculate percentage
  BIND((?time / ?totalTime * 100) AS ?percent)

  # Pre-calculate the next zone index
  BIND((?zoneIndex + 1) AS ?nextIndex)

  # Calculate "to" value using the pre-calculated next index
  OPTIONAL {
    <${statId}> activo:hasZone ?nextZone .
    ?nextZone activo:zoneIndex ?nextIndex .
    ?nextZone activo:zoneStart ?to .
  }
}
ORDER BY ?zoneIndex
    `,
      {
        sources,
        lenient: true
      }
    );

    const zones = [];
    bindingsStream.on("data", (bindings: Bindings) => {
      const zone = {
        from: parseInt(bindings.get("zoneStart").value),
        s: parseFloat(bindings.get("time").value),
        percent: parseFloat(bindings.get("percent").value),
        to: bindings.has("to") ? parseInt(bindings.get("to").value) : null
      };
      const index = parseInt(bindings.get("zoneIndex").value);
      while (zones.length <= index) {
        zones.push(null);
      }
      zones[index] = zone;
    });

    await new Promise(resolve => bindingsStream.on("end", resolve));

    return zones.length > 0 ? zones : null;
  }

  write(location: string, activity: Activity): string {
    const activityIri = `${location}#activity`;
    // ----------------- helpers -----------------
    let ttl = "";
    const XSD = "http://www.w3.org/2001/XMLSchema#";
    const S = (iri: string) => {
      if (iri.startsWith("http://") || iri.startsWith("https://")) {
        return `<${iri}>`;
      }
      return iri;
    };
    const mint = (frag: string) => `${activityIri}-${frag.replace(/[^a-zA-Z0-9_\-]/g, "-")}`;

    const lit = (v: any) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "string") return `"${v.replace(/"/g, '\\"')}"`;
      if (typeof v === "boolean") return `"${v}"^^<${XSD}boolean>`;
      if (typeof v === "number" && Number.isInteger(v)) return `"${v}"^^<${XSD}integer>`;
      if (typeof v === "number") return `"${v}"^^<${XSD}float>`;
      if (v instanceof Date) return `"${v.toDateString()}"^^<${XSD}dateTime>`;
      if (typeof v === "string" && /\d{4}-\d{2}-\d{2}T/.test(v))
        return `"${new Date(v).toDateString()}"^^<${XSD}dateTime>`;
      return `"${String(v).replace(/"/g, '\\"')}"`;
    };

    const add = (sIri: string, pred: string, obj: string) => {
      if (obj) ttl += `${S(sIri)} ${pred} ${obj} .\n`;
    };
    const addLit = (sIri: string, pred: string, v: any) => {
      const l = lit(v);
      if (l) add(sIri, pred, l);
    };
    const addLink = (sIri: string, pred: string, oIri: string) => {
      if (oIri) add(sIri, pred, S(oIri));
    };

    // ----------------- prefixes + root -----------------
    ttl += `PREFIX foaf: <http://xmlns.com/foaf/0.1/>\n`;
    ttl += `PREFIX prov: <http://www.w3.org/ns/prov#>\n`;
    ttl += `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n`;
    ttl += `PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>\n\n`;

    addLink(activityIri, "a", "activo:Activity");
    switch (activity.type) {
      case ElevateSport.Ride:
        addLink(activityIri, "a", "activo:Ride");
        break;
      case ElevateSport.Run:
        addLink(activityIri, "a", "activo:Run");
        break;
      case ElevateSport.Swim:
        addLink(activityIri, "a", "activo:Swim");
        break;
    }

    // ----------------- basic activity fields -----------------
    addLit(activityIri, "activo:name", (activity as any).name);
    addLit(activityIri, "activo:startTime", (activity as any).startTime);
    addLit(activityIri, "activo:endTime", (activity as any).endTime);
    addLit(activityIri, "activo:hasPowerData", (activity as any).hasPowerMeter);
    addLit(activityIri, "activo:isTrainer", (activity as any).trainer);
    addLit(activityIri, "activo:isCommute", (activity as any).commute);
    addLit(activityIri, "activo:isManual", (activity as any).manual);
    addLit(activityIri, "activo:isSwimPool", (activity as any).isSwimPool);
    addLit(activityIri, "activo:hash", (activity as any).hash);
    addLit(
      activityIri,
      "activo:isWithoutAthletePerformance",
      (activity as any).settingsLack === undefined || (activity as any).settingsLack === null
        ? false
        : (activity as any).settingsLack
    );
    addLit(activityIri, "prov:generatedAtTime", (activity as any).creationTime);
    addLit(activityIri, "activo:notes", (activity as any).notes);
    addLit(activityIri, "activo:isTypeAutoDetected", (activity as any).autoDetectedType);

    const latLng = (activity as any).latLngCenter;
    if (Array.isArray(latLng) && latLng.length === 2) {
      addLit(activityIri, "activo:latCenter", latLng[0]);
      addLit(activityIri, "activo:lonCenter", latLng[1]); // ontology
    }

    // ----------------- athlete snapshot (ONLY) -----------------
    const snap = (activity as any).athleteSnapshot; // { gender, age, athleteSettings }
    if (snap) {
      const snapshotIri = mint("performanceSnapshot");
      addLink(activityIri, "activo:hasPerformanceSnapshot", snapshotIri);
      addLink(snapshotIri, "a", "activo:PerformanceSnapshot");
      const athleteIri = mint("athlete");
      addLink(activityIri, "activo:hasAthlete", athleteIri);
      addLink(athleteIri, "a", "foaf:Person");
      addLink(snapshotIri, "activo:hasAthlete", athleteIri);

      if ("gender" in snap) addLit(athleteIri, "foaf:gender", snap.gender);
      if ("age" in snap) addLit(athleteIri, "foaf:age", snap.age);

      const set = snap.athleteSettings as any;
      console.log(snap);
      console.log(set);
      if (set) {
        addLit(snapshotIri, "activo:maxHeartRate", set.maxHr);
        addLit(snapshotIri, "activo:restHeartRate", set.restHr);
        addLit(snapshotIri, "activo:weight", set.weight);
        if (set.cyclingFtp != null) addLit(snapshotIri, "activo:cyclingFunctionalThresholdPower", set.cyclingFtp);
        if (set.runningFtp != null) addLit(snapshotIri, "activo:runningFunctionalThresholdPower", set.runningFtp);
        if (set.swimFtp != null) addLit(snapshotIri, "activo:swimmingFunctionalThresholdPower", set.swimFtp);

        const lthr = set.lthr as any;
        if (lthr) {
          // Write what exists; names match your earlier usage
          if (lthr.default != null) addLit(snapshotIri, "activo:defaultLactateThreshold", lthr.default);
          if (lthr.cycling != null) addLit(snapshotIri, "activo:cyclingLactateThreshold", lthr.cycling);
          if (lthr.running != null) addLit(snapshotIri, "activo:runningLactateThreshold", lthr.running);
        }
      }
    }

    // ----------------- flags -----------------
    const FLAG_IRIS: string[] = [
      "activo:MOVING_TIME_GREATER_THAN_ELAPSED",
      "activo:SPEED_AVG_ABNORMAL",
      "activo:SPEED_STD_DEV_ABNORMAL",
      "activo:ASCENT_SPEED_ABNORMAL",
      "activo:PACE_AVG_FASTER_THAN_GAP",
      "activo:POWER_AVG_KG_ABNORMAL",
      "activo:POWER_THRESHOLD_ABNORMAL",
      "activo:HR_AVG_ABNORMAL",
      "activo:SCORE_HRSS_PER_HOUR_ABNORMAL",
      "activo:SCORE_PSS_PER_HOUR_ABNORMAL",
      "activo:SCORE_RSS_PER_HOUR_ABNORMAL",
      "activo:SCORE_SSS_PER_HOUR_ABNORMAL"
    ];
    if (Array.isArray((activity as any).flags)) {
      for (const f of (activity as any).flags) {
        const iri = FLAG_IRIS[f as number];
        if (iri) addLink(activityIri, "activo:hasFlag", iri);
      }
    }

    // ----------------- stats writer utilities -----------------
    type PeakT = Peak; // { start:number, range:number, end:number, result:number }
    type ZoneT = ZoneModel; // { from:number, to?:number|null, s:number, percent?:number }

    const writePeaks = (statIri: string, peaks?: PeakT[]) => {
      if (!statIri || !Array.isArray(peaks)) return;
      peaks.forEach((p, i) => {
        if (!p) return;
        const pIri = mint(`${statIri.split("#").pop() || "stat"}-peak-${i + 1}`);
        addLink(statIri, "activo:hasPeak", pIri);
        addLink(pIri, "a", "activo:Peak");
        addLit(pIri, "activo:peakStart", p.start);
        addLit(pIri, "activo:peakDuration", p.range);
        addLit(pIri, "activo:peakValue", p.result);
        addLink(pIri, "activo:isPeakOf", statIri);
      });
    };

    const writeZones = (statIri: string, zones?: ZoneT[]) => {
      if (!statIri || !Array.isArray(zones)) return;
      zones.forEach((z, i) => {
        if (!z) return;
        const zIri = mint(`${statIri.split("#").pop() || "stat"}-zone-${i}`);
        addLink(statIri, "activo:hasZone", zIri);
        addLink(zIri, "a", "activo:Zone");
        addLit(zIri, "activo:zoneIndex", i);
        addLit(zIri, "activo:zoneStart", z.from);
        addLit(zIri, "activo:time", z.s);
        addLink(zIri, "activo:isZoneOf", statIri);
      });
    };

    const writeSlopeBundle = (
      rootIri: string,
      slot: "SlopeTime" | "SlopeSpeed" | "SlopePace" | "SlopeDistance" | "SlopeCadence",
      obj?: any
    ) => {
      if (!obj) return;
      const iri = mint(`${rootIri.split("#").pop()}-${slot}`);
      const pred = `activo:has${slot}`;
      addLink(rootIri, pred, iri);
      addLink(iri, "a", "activo:SlopeStats");
      addLit(iri, "activo:uphill", obj.up);
      addLit(iri, "activo:flat", obj.flat);
      addLit(iri, "activo:downhill", obj.down);
      addLit(iri, "activo:total", obj.total);
    };

    const writeMetricSet = (
      parentIri: string,
      className:
        | "SpeedStats"
        | "PaceStats"
        | "PowerStats"
        | "HeartRateStats"
        | "CadenceStats"
        | "GradeStats"
        | "ElevationStats",
      obj?: any,
      extras?: { peaks?: PeakT[]; zones?: ZoneT[]; slope?: any },
      context?: string // New parameter to ensure unique IRIs
    ) => {
      if (!obj) return null;

      const frag = className.charAt(0).toLowerCase() + className.slice(1); // e.g., speedStats
      const contextualFrag = context ? `${context}-${frag}` : frag;
      const iri = mint(contextualFrag);
      addLink(parentIri, `activo:has${className}`, iri);
      addLink(iri, "a", `activo:${className}`);

      // common stats
      if ("avg" in obj) addLit(iri, "activo:average", obj.avg);
      if ("max" in obj) addLit(iri, "activo:max", obj.max);
      if ("min" in obj) addLit(iri, "activo:min", obj.min);
      // ontology uses activo:lowerQ; your queries use activo:lowQ — write both
      if ("lowQ" in obj) {
        addLit(iri, "activo:lowerQ", obj.lowQ); // ontology
        addLit(iri, "activo:lowQ", obj.lowQ); // query map compatibility
      }
      if ("upperQ" in obj) addLit(iri, "activo:upperQ", obj.upperQ);
      if ("median" in obj) addLit(iri, "activo:median", obj.median);
      if ("stdDev" in obj) addLit(iri, "activo:stdDev", obj.stdDev);

      // pace specific: ontology predicate is activo:gradeAdjustedAverage, label "gradeAdjustedPaceAverage"
      if ("gapAvg" in obj) {
        addLit(iri, "activo:gradeAdjustedAverage", obj.gapAvg); // ontology
        addLit(iri, "activo:gradeAdjustedPaceAverage", obj.gapAvg); // query map compatibility
      }

      // power specific
      if ("avgKg" in obj) addLit(iri, "activo:powerToWeightRatio", obj.avgKg);
      if ("weighted" in obj) addLit(iri, "activo:normalizedPowerAverage", obj.weighted);
      if ("weightedKg" in obj) addLit(iri, "activo:normalizedPowerToWeightRatio", obj.weightedKg);
      if ("work" in obj) addLit(iri, "activo:work", obj.work);
      if ("variabilityIndex" in obj) addLit(iri, "activo:variabilityIndex", obj.variabilityIndex);
      if ("intensityFactor" in obj) addLit(iri, "activo:intensityFactor", obj.intensityFactor);

      // heart rate reserve
      if ("avgReserve" in obj) addLit(iri, "activo:averageReserve", obj.avgReserve);
      if ("maxReserve" in obj) addLit(iri, "activo:maxReserve", obj.maxReserve);

      // cadence extras
      if ("avgActive" in obj) addLit(iri, "activo:averageActive", obj.avgActive);
      if ("activeRatio" in obj) addLit(iri, "activo:activeRatio", obj.activeRatio);
      if ("activeTime" in obj) addLit(iri, "activo:activeTime", obj.activeTime);
      if ("cycles" in obj) addLit(iri, "activo:cycles", obj.cycles);
      if ("distPerCycle" in obj) addLit(iri, "activo:distancePerCycle", obj.distPerCycle);

      // elevation extras
      if ("ascent" in obj) addLit(iri, "activo:ascent", obj.ascent);
      if ("descent" in obj) addLit(iri, "activo:descent", obj.descent);
      if ("ascentSpeed" in obj) addLit(iri, "activo:ascentSpeed", obj.ascentSpeed);

      if ("best20min" in obj) {
        if (!extras.peaks?.find((peak: Peak) => peak.range === 1200)) {
          const pIri = mint(`${iri.split("#").pop() || "stat"}-peak-${1200}`);
          addLink(iri, "activo:hasPeak", pIri);
          addLink(pIri, "a", "activo:Peak");
          addLit(pIri, "activo:peakDuration", 1200);
          addLit(pIri, "activo:peakValue", obj.best20min);
          addLink(pIri, "activo:isPeakOf", iri);
        }
      }
      if ("best60min" in obj) {
        if (!extras.peaks?.find((peak: Peak) => peak.range === 3600)) {
          const pIri = mint(`${iri.split("#").pop() || "stat"}-peak-${3600}`);
          addLink(iri, "activo:hasPeak", pIri);
          addLink(pIri, "a", "activo:Peak");
          addLit(pIri, "activo:peakDuration", 3600);
          addLit(pIri, "activo:peakValue", obj.best60min);
          addLink(pIri, "activo:isPeakOf", iri);
        }
      }

      // slope breakdowns on GradeStats
      if (className === "GradeStats" && extras?.slope) {
        writeSlopeBundle(iri, "SlopeTime", extras.slope.slopeTime);
        writeSlopeBundle(iri, "SlopeSpeed", extras.slope.slopeSpeed);
        writeSlopeBundle(iri, "SlopePace", extras.slope.slopePace);
        writeSlopeBundle(iri, "SlopeDistance", extras.slope.slopeDistance);
        writeSlopeBundle(iri, "SlopeCadence", extras.slope.slopeCadence);
        if (extras.slope.slopeProfile) {
          if (extras.slope.slopeProfile == SlopeProfile.FLAT) {
            addLink(iri, "activo:hasSlopeProfile", "activo:FlatProfile");
          }
          if (extras.slope.slopeProfile == SlopeProfile.HILLY) {
            addLink(iri, "activo:hasSlopeProfile", "activo:HillyProfile");
          }
        }
      }

      if (extras?.peaks) writePeaks(iri, extras.peaks);
      if (extras?.zones) writeZones(iri, extras.zones);

      return iri;
    };

    const writeScores = (statsIri: string, s?: Scores) => {
      if (!s) return;
      const i = mint("scores");
      addLink(statsIri, "activo:hasScores", i);
      addLink(i, "a", "activo:Scores");
      if ("efficiency" in s) addLit(i, "activo:efficiency", s.efficiency);
      if ("powerHr" in s) addLit(i, "activo:averagePowerHeartRateRatio", s.powerHr);
      if ("runningRating" in s) addLit(i, "activo:runningRating", s.runningRating);
      if ("swolf" in s && s.swolf) {
        if ("25" in s.swolf) addLit(i, "activo:swolf25", s.swolf["25"]);
        if ("50" in s.swolf) addLit(i, "activo:swolf50", s.swolf["50"]);
      }

      if ("stress" in s && s.stress) {
        if ("hrss" in s.stress) addLit(i, "activo:heartRateStressScore", s.stress.hrss);
        if ("hrssPerHour" in s.stress) addLit(i, "activo:heartRateStressScorePerHour", s.stress.hrssPerHour);
        if ("trimp" in s.stress) addLit(i, "activo:trainingImpulse", s.stress.trimp);
        if ("trimpPerHour" in s.stress) addLit(i, "activo:trainingImpulsePerHour", s.stress.trimpPerHour);
        if ("rss" in s.stress) addLit(i, "activo:runningStressScore", s.stress.rss);
        if ("rssPerHour" in s.stress) addLit(i, "activo:runningStressScorePerHour", s.stress.rssPerHour);
        if ("sss" in s.stress) addLit(i, "activo:swimStressScore", s.stress.sss);
        if ("sssPerHour" in s.stress) addLit(i, "activo:swimStressScorePerHour", s.stress.sssPerHour);
        if ("pss" in s.stress) addLit(i, "activo:powerStressScore", s.stress.pss);
        if ("pssPerHour" in s.stress) addLit(i, "activo:powerStressScorePerHour", s.stress.pssPerHour);
        if ("trainingEffect" in s.stress && s.stress.trainingEffect) {
          if ("aerobic" in s.stress.trainingEffect)
            addLit(i, "activo:aerobicTrainingEffect", s.stress.trainingEffect.aerobic);
          if ("anaerobic" in s.stress.trainingEffect)
            addLit(i, "activo:anaerobicTrainingEffect", s.stress.trainingEffect.anaerobic);
        }
      }
    };

    const writeDynamics = (statsRootIri: string, dyn?: any, slot: "src" | "norm" = "norm") => {
      if (!dyn) return;
      if (dyn.cycling) {
        const dIri = mint(`${slot}-dynamics-cycling`);
        addLink(statsRootIri, "activo:hasDynamicsStats", dIri);
        addLink(dIri, "a", "activo:CyclingDynamicsStats");
        addLit(dIri, "activo:standingTime", dyn.cycling.standingTime);
        addLit(dIri, "activo:seatedTime", dyn.cycling.seatedTime);
        if (dyn.cycling.balance) {
          const bIri = mint(`${slot}-cycling-balance`);
          addLink(dIri, "activo:hasBalance", bIri);
          addLink(bIri, "a", "activo:LeftRightPercent");
          addLit(bIri, "activo:left", dyn.cycling.balance.left);
          addLit(bIri, "activo:right", dyn.cycling.balance.right);
        }
        if (dyn.cycling.pedalSmoothness) {
          const pIri = mint(`${slot}-cycling-pedalSmoothness`);
          addLink(dIri, "activo:hasPedalSmoothness", pIri);
          addLink(pIri, "a", "activo:LeftRightPercent");
          addLit(pIri, "activo:left", dyn.cycling.pedalSmoothness.left);
          addLit(pIri, "activo:right", dyn.cycling.pedalSmoothness.right);
        }
        if (dyn.cycling.torqueEffectiveness) {
          const tIri = mint(`${slot}-cycling-torqueEffectiveness`);
          addLink(dIri, "activo:hasTorqueEffectiveness", tIri);
          addLink(tIri, "a", "activo:LeftRightPercent");
          addLit(tIri, "activo:left", dyn.cycling.torqueEffectiveness.left);
          addLit(tIri, "activo:right", dyn.cycling.torqueEffectiveness.right);
        }
      }
      if (dyn.running) {
        const dIri = mint(`${slot}-dynamics-running`);
        addLink(statsRootIri, "activo:hasDynamicsStats", dIri);
        addLink(dIri, "a", "activo:RunningDynamicsStats");
        addLit(dIri, "activo:verticalOscillation", dyn.running.verticalOscillation);
        addLit(dIri, "activo:verticalRatio", dyn.running.verticalRatio);
        if (dyn.running.stanceTimeBalance) {
          const bIri = mint(`${slot}-running-stanceTimeBalance`);
          addLink(dIri, "activo:hasGroundContactTimeBalance", bIri);
          addLink(bIri, "a", "activo:LeftRightPercent");
          addLit(bIri, "activo:left", dyn.running.stanceTimeBalance.left);
          addLit(bIri, "activo:right", dyn.running.stanceTimeBalance.right);
        }
        addLit(dIri, "activo:groundContactTime", dyn.running.stanceTime);
        addLit(dIri, "activo:averageStrideLength", dyn.running.avgStrideLength);
      }
    };

    const writeStatsRoot = (slotName: "srcStats" | "stats", st?: any) => {
      if (!st) return;
      const iri = mint(slotName);

      if (slotName === "srcStats") {
        addLink(activityIri, "activo:hasSourceStats", iri);
      }
      if (slotName === "stats") {
        addLink(activityIri, "activo:hasStats", iri);
      }
      addLink(iri, "a", "activo:Stats");

      if ("distance" in st) addLit(iri, "activo:distance", st.distance);
      if ("elapsedTime" in st) addLit(iri, "activo:elapsedTime", st.elapsedTime);
      if ("movingTime" in st) addLit(iri, "activo:movingTime", st.movingTime);
      if ("pauseTime" in st) addLit(iri, "activo:pauseTime", st.pauseTime);
      if ("moveRatio" in st) addLit(iri, "activo:moveRatio", st.moveRatio);
      if ("calories" in st) addLit(iri, "activo:calories", st.calories);
      if ("caloriesPerHour" in st) addLit(iri, "activo:caloriesPerHour", st.caloriesPerHour);

      if ("scores" in st) writeScores(iri, st.scores);

      writeMetricSet(iri, "SpeedStats", st.speed, { peaks: st?.speed?.peaks, zones: st?.speed?.zones }, slotName);
      writeMetricSet(iri, "PaceStats", st.pace, { peaks: st?.pace?.peaks, zones: st?.pace?.zones }, slotName);
      writeMetricSet(iri, "PowerStats", st.power, { peaks: st?.power?.peaks, zones: st?.power?.zones }, slotName);
      writeMetricSet(
        iri,
        "HeartRateStats",
        st.heartRate,
        { peaks: st?.heartRate?.peaks, zones: st?.heartRate?.zones },
        slotName
      );
      writeMetricSet(
        iri,
        "CadenceStats",
        st.cadence,
        { peaks: st?.cadence?.peaks, zones: st?.cadence?.zones },
        slotName
      );
      writeMetricSet(iri, "GradeStats", st.grade, { zones: st?.grade?.zones, slope: st?.grade }, slotName);
      writeMetricSet(
        iri,
        "ElevationStats",
        st.elevation,
        {
          zones: st?.elevation?.elevationZones || st?.elevation?.zones
        },
        slotName
      );

      writeDynamics(iri, st.dynamics, slotName === "srcStats" ? "src" : "norm");
    };

    writeStatsRoot("srcStats", (activity as any).srcStats);
    writeStatsRoot("stats", (activity as any).stats);

    // ----------------- laps -----------------
    if (Array.isArray((activity as any).laps)) {
      for (const lap of (activity as any).laps) {
        if (!lap) continue;
        const lapIri = mint(`lap-${lap.id ?? lap.index ?? 0}`);
        addLink(activityIri, "activo:hasLap", lapIri);
        addLink(lapIri, "a", "activo:Lap");
        addLit(lapIri, "activo:lapIndex", lap.id);
        if (Array.isArray(lap.indexes)) {
          addLit(lapIri, "activo:lapStart", lap.indexes[0]);
          addLit(lapIri, "activo:lapEnd", lap.indexes[1]);
        }
        if ("active" in lap) addLit(lapIri, "activo:isActive", lap.active);
        addLink(lapIri, "activo:isLapOf", activityIri);

        // Lap stats (subset; extend as needed)
        const sIri = mint(`lap-${lap.id}-stats`);
        addLink(lapIri, "activo:hasStats", sIri);
        addLink(sIri, "a", "activo:Stats");
        if ("distance" in lap) addLit(sIri, "activo:distance", (lap as any).distance);
        if ("elapsedTime" in lap) addLit(sIri, "activo:elapsedTime", (lap as any).elapsedTime);
        if ("movingTime" in lap) addLit(sIri, "activo:movingTime", (lap as any).movingTime);
        if ("calories" in lap) addLit(sIri, "activo:calories", (lap as any).calories);

        if ("avgSpeed" in lap || "maxSpeed" in lap) {
          const x = mint(`lap-${lap.id}-speedStats`);
          addLink(sIri, "activo:hasSpeedStats", x);
          addLink(x, "a", "activo:SpeedStats");
          if ("avgSpeed" in lap) addLit(x, "activo:average", lap.avgSpeed);
          if ("maxSpeed" in lap) addLit(x, "activo:max", lap.maxSpeed);
        }

        if ("avgPace" in lap || "maxPace" in lap) {
          const x = mint(`lap-${lap.id}-paceStats`);
          addLink(sIri, "activo:hasPaceStats", x);
          addLink(x, "a", "activo:PaceStats");
          if ("avgPace" in lap) addLit(x, "activo:average", lap.avgPace);
          if ("maxPace" in lap) addLit(x, "activo:max", lap.maxPace);
        }

        if ("avgCadence" in lap) {
          const x = mint(`lap-${lap.id}-cadenceStats`);
          addLink(sIri, "activo:hasCadenceStats", x);
          addLink(x, "a", "activo:CadenceStats");
          addLit(x, "activo:average", lap.avgCadence);
        }

        if ("avgHr" in lap || "maxHr" in lap) {
          const x = mint(`lap-${lap.id}-heartRateStats`);
          addLink(sIri, "activo:hasHeartRateStats", x);
          addLink(x, "a", "activo:HeartRateStats");
          if ("avgHr" in lap) addLit(x, "activo:average", lap.avgHr);
          if ("maxHr" in lap) addLit(x, "activo:max", lap.maxHr);
        }

        if ("avgWatts" in lap) {
          const x = mint(`lap-${lap.id}-powerStats`);
          addLink(sIri, "activo:hasPowerStats", x);
          addLink(x, "a", "activo:PowerStats");
          addLit(x, "activo:average", lap.avgWatts);
        }

        if ("elevationGain" in lap) {
          const x = mint(`lap-${lap.id}-elevationStats`);
          addLink(sIri, "activo:hasElevationStats", x);
          addLink(x, "a", "activo:ElevationStats");
          addLit(x, "activo:ascent", lap.elevationGain);
        }

        if ("swolf25m" in lap || "swolf50m" in lap) {
          const sc = mint(`lap-${lap.id}-scores`);
          addLink(sIri, "activo:hasScores", sc);
          addLink(sc, "a", "activo:Scores");
          if ("swolf25m" in lap) addLit(sc, "activo:swolf25", lap.swolf25m);
          if ("swolf50m" in lap) addLit(sc, "activo:swolf50", lap.swolf50m);
        }
      }
    }

    // ----------------- provenance: device + file -----------------
    const device = (activity as any).device;
    const filePath = (activity as any)?.extras?.file?.path;
    if (device || filePath) {
      const fileIri = mint("file");
      addLink(activityIri, "prov:wasDerivedFrom", fileIri);
      if (filePath) addLink(fileIri, "prov:atLocation", filePath);
      if (device) {
        const agentIri = mint("deviceAgent");
        addLink(fileIri, "prov:wasAttributedTo", agentIri);
        addLink(agentIri, "a", "activo:Device");
        addLit(agentIri, "foaf:name", device);
      }
    }

    return ttl;
  }
}
