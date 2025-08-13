import {
  Activity,
  ActivityFlag,
  Lap,
  Peak,
  Scores,
  SlopeProfile
} from "@elevate/shared/models/sync/activity.model";
import { QueryEngine } from "@comunica/query-sparql";
import { AsyncIterator } from "asynciterator";
import { Bindings, Term } from "@rdfjs/types";
import { ZoneModel } from "@elevate/shared/models/zone.model";
//import { fetch as cfetch } from "cross-fetch";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { v4 as uuidv4 } from "uuid";

export class ActivityMapping {
  private queryEngine: QueryEngine;

  constructor() {
    this.queryEngine = new QueryEngine();
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

  async query(
    sources: [string, ...string[]],
    activityIri?: string,
    keys?: string[],
    sort?: { key: string; ascending: boolean },
    slice?: { limit: number; offset: number }
  ): Promise<Activity[]> {
    let query = `
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX activo: <https://solidlabresearch.github.io/activity-ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT * WHERE {\n`;

    let completeActivity = false;
    if (!keys || keys.length === 0) {
      keys = Object.keys(ActivityComponentMap);
      completeActivity = true;
    }

    let queryTree;
    if (!activityIri) {
      queryTree = {
        graphPattern: "?activity a activo:Activity .\n",
        children: []
      };
    } else {
      queryTree = {
        graphPattern: `${activityIri} a activo:Activity .\n`,
        children: {}
      };
    }

    for (const key of keys) {
      const component = ActivityComponentMap[key];
      const provenance = [key];
      let workingComponent = component;
      while (workingComponent.requiredVariable != "activity") {
        if (provenance[provenance.length - 1] === workingComponent.requiredVariable) {
          console.error("Circular dependency detected in activity component mapping for key: " + key);
        }
        provenance.push(workingComponent.requiredVariable);
        workingComponent = ActivityComponentMap[workingComponent.requiredVariable];
      }
      let workingNode = queryTree;
      for (let i = provenance.length - 1; i >= 0; i--) {
        const variable = provenance[i];
        if (!workingNode.children[variable]) {
          workingNode.children[variable] = {
            graphPattern: ActivityComponentMap[variable].graphPattern,
            children: {}
          };
        }
        workingNode = workingNode.children[variable];
      }
    }

    // Construct query from tree
    const constructQuery = (node: any): string => {
      let queryPart = node.graphPattern;
      for (const childKey in node.children) {
        const nestedQuery = constructQuery(node.children[childKey]);
        if (nestedQuery == "") {
          continue;
        }
        queryPart += "OPTIONAL {\n";
        queryPart += nestedQuery + "\n";
        queryPart += "}\n";
      }
      return queryPart;
    };
    query += constructQuery(queryTree);
    query += "\n}\n";

    // add logic for sorting and slicing
    if (sort) {
      if (sort.ascending) {
        query += "ORDER BY ?" + sort.key + "\n";
      } else {
        query += "ORDER BY DESC(?" + sort.key + ")\n";
      }
    }
    if (slice) {
      if (slice.limit) {
        query += "LIMIT " + slice.limit + "\n";
      }
      if (slice.offset) {
        query += "OFFSET " + slice.offset + "\n";
      }
    }

    // do query
    const bindingsStream: AsyncIterator<Bindings> = await this.queryEngine.queryBindings(query, {
      sources: [...sources, "https://solidlabresearch.github.io/activity-ontology/"]
    });

    const result = await bindingsStream
      .transform({
        transform: async (bindings: Bindings, done: () => void, push: (activity: Activity) => void) => {
          const activity = new Activity();
          activity.id = bindings.get("activity").value.split("#")[1];
          activity.connector = ConnectorType.SOLID;

          for (const key of keys) {
            if (ActivityComponentMap[key].ignore) {
              continue;
            }
            const activityAttributes = key.split("_").slice(1);
            let workingObject = activity;
            for (let i = 0; i < activityAttributes.length; i++) {
              const attribute = activityAttributes[i];
              if (i === activityAttributes.length - 1) {
                // last attribute, set value
                let value = null;
                if (ActivityComponentMap[key].formatValue) {
                  value = ActivityComponentMap[key].formatValue(bindings);
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

          if (completeActivity) {
            // We also need to query Peak, Zones, Lap, and Flag data
            const promises = [];
            // We also need to query Peak, Zones, Lap, and Flag data
            promises.push(
              this.queryLaps(bindings.get("activity").value, sources).then(result => {
                activity.laps = result;
              })
            );

            promises.push(
              this.queryFlags(bindings.get("activity").value, sources).then(result => {
                activity.flags = result;
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
                this.complicatedQueryZones(bindings.get("activity_srcStats_heartRate").value, sources).then(result => {
                  activity.srcStats.heartRate.zones = result;
                })
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
                this.complicatedQueryZones(bindings.get("activity_srcStats_elevation").value, sources).then(result => {
                  activity.srcStats.elevation.elevationZones = result;
                })
              );
            }

            await Promise.all(promises);
          }

          push(activity);
          done();
        }
      })
      .toArray();

    return result.length > 0 ? result : null;
  }

  async queryLaps(activityId: string, sources: [string, ...string[]]): Promise<Lap[] | null> {
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
        sources
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

  async queryFlags(activityId: string, sources: [string, ...string[]]): Promise<ActivityFlag[] | null> {
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
        sources: ["https://solidlabresearch.github.io/activity-ontology/", ...sources]
      }
    );
    const result = await bindingsStream
      .map((bindings: Bindings) => {
        return parseInt(bindings.get("index").value) as ActivityFlag;
      })
      .toArray();

    return result.length > 0 ? result : null;
  }

  async queryPeaks(statId: string, sources: [string, ...string[]]): Promise<Peak[] | null> {
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
        sources
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

  async simpleQueryZones(statId: string, sources: [string, ...string[]]): Promise<ZoneModel[] | null> {
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
      { sources }
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

  async complicatedQueryZones(statId: string, sources: [string, ...string[]]): Promise<ZoneModel[] | null> {
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
      { sources }
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

  write(activityIri: string, activity: Activity): string {
    // ----------------- helpers -----------------
    let ttl = "";
    const XSD = "http://www.w3.org/2001/XMLSchema#";
    const S = (iri: string) => {
      if (iri.startsWith("http://") || iri.startsWith("https://")) {
        return `<${iri}>`;
      }
      return iri;
    };
    const mint = (frag: string) => `${activityIri}-${uuidv4()}-${frag.replace(/[^a-zA-Z0-9_\-]/g, "-")}`;

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
    addLit(activityIri, "activo:isWithoutAthletePerformance", (activity as any).settingsLack);
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
      extras?: { peaks?: PeakT[]; zones?: ZoneT[]; slope?: any }
    ) => {
      if (!obj) return null;

      const frag = className.charAt(0).toLowerCase() + className.slice(1); // e.g., speedStats
      const iri = mint(frag);
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

      writeMetricSet(iri, "SpeedStats", st.speed, { peaks: st?.speed?.peaks, zones: st?.speed?.zones });
      writeMetricSet(iri, "PaceStats", st.pace, { peaks: st?.pace?.peaks, zones: st?.pace?.zones });
      writeMetricSet(iri, "PowerStats", st.power, { peaks: st?.power?.peaks, zones: st?.power?.zones });
      writeMetricSet(iri, "HeartRateStats", st.heartRate, { peaks: st?.heartRate?.peaks, zones: st?.heartRate?.zones });
      writeMetricSet(iri, "CadenceStats", st.cadence, { peaks: st?.cadence?.peaks, zones: st?.cadence?.zones });
      writeMetricSet(iri, "GradeStats", st.grade, { zones: st?.grade?.zones, slope: st?.grade });
      writeMetricSet(iri, "ElevationStats", st.elevation, {
        zones: st?.elevation?.elevationZones || st?.elevation?.zones
      });

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
      if (filePath) addLit(fileIri, "prov:atLocation", filePath);
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

const ActivityComponentMap: {
  [key: string]: {
    graphPattern: string;
    requiredVariable: string;
    formatValue?: (bindings: Bindings) => any;
    ignore?: boolean;
  };
} = {
  activity_name: {
    graphPattern: "?activity activo:name ?activity_name .",
    requiredVariable: "activity"
  },
  activity_type: {
    graphPattern:
      "?activity a ?activity_type_class ." +
      "?activity_type_class rdfs:label ?activity_type ." +
      "?activity_type_class rdfs:subClassOf activo:Activity .",
    requiredVariable: "activity"
  },
  activity_startTime: {
    graphPattern: "?activity activo:startTime ?activity_startTime .",
    requiredVariable: "activity"
  },
  activity_endTime: {
    graphPattern: "?activity activo:endTime ?activity_endTime .",
    requiredVariable: "activity"
  },
  activity_startTimestamp: {
    graphPattern: "",
    requiredVariable: "activity_startTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_startTime")) {
        return null;
      }
      return Math.floor(new Date(bindings.get("activity_startTime").value).getTime() / 1000);
    }
  },
  activity_endTimestamp: {
    graphPattern: "",
    requiredVariable: "activity_endTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_endTime")) {
        return null;
      }
      return Math.floor(new Date(bindings.get("activity_endTime").value).getTime() / 1000);
    }
  },
  activity_hasPowerMeter: {
    graphPattern: "?activity activo:hasPowerData ?activity_hasPowerMeter .", // alternate calculation
    requiredVariable: "activity"
  },
  activity_trainer: {
    graphPattern: "?activity activo:isTrainer ?activity_trainer .",
    requiredVariable: "activity"
  },
  activity_commute: {
    graphPattern: "?activity activo:isCommute ?activity_commute .",
    requiredVariable: "activity"
  },
  activity_manual: {
    graphPattern: "?activity activo:isManual ?activity_manual .",
    requiredVariable: "activity"
  },

  activity_athlete: {
    graphPattern: "?activity activo:hasAthlete ?activity_athlete .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_athleteSnapshot_gender: {
    graphPattern: "?activity_athlete foaf:gender ?activity_athleteSnapshot_gender .",
    requiredVariable: "activity_athlete"
  },
  activity_athleteSnapshot_age: {
    graphPattern: "?activity_athlete foaf:age ?activity_athleteSnapshot_age .", // possibly also use birthday
    requiredVariable: "activity_athlete"
  },
  activity_athleteSnapshot: {
    graphPattern: "?activity activo:hasPerformanceSnapshot ?activity_athleteSnapshot .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_athleteSnapshot_athleteSettings_maxHr: {
    graphPattern: "?activity_athleteSnapshot activo:maxHeartRate ?activity_athleteSnapshot_athleteSettings_maxHr .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_restHr: {
    graphPattern: "?activity_athleteSnapshot activo:restHeartRate ?activity_athleteSnapshot_athleteSettings_restHr .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_lthr_default: {
    graphPattern:
      "?activity_athleteSnapshot activo:defaultLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_default .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_lthr_cycling: {
    graphPattern:
      "?activity_athleteSnapshot activo:cyclingLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_cycling .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_lthr_running: {
    graphPattern:
      "?activity_athleteSnapshot activo:runningLactateThreshold ?activity_athleteSnapshot_athleteSettings_lthr_running .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_cyclingFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:cyclingFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_cyclingFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_runningFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:runningFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_runningFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_swimFtp: {
    graphPattern:
      "?activity_athleteSnapshot activo:swimmingFunctionalThresholdPower ?activity_athleteSnapshot_athleteSettings_swimFtp .",
    requiredVariable: "activity_athleteSnapshot"
  },
  activity_athleteSnapshot_athleteSettings_weight: {
    graphPattern: "?activity_athleteSnapshot activo:weight ?activity_athleteSnapshot_athleteSettings_weight .",
    requiredVariable: "activity_athleteSnapshot"
  },

  activity_srcStats: {
    graphPattern: "?activity activo:hasSourceStats ?activity_srcStats .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_srcStats_distance: {
    graphPattern: "?activity_srcStats activo:distance ?activity_srcStats_distance .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_elevationGain: {
    graphPattern: "?activity_srcStats_elevation activo:ascent ?activity_srcStats_elevationGain .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elapsedTime: {
    graphPattern: "?activity_srcStats activo:elapsedTime ?activity_srcStats_elapsedTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_movingTime: {
    graphPattern: "?activity_srcStats activo:movingTime ?activity_srcStats_movingTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_pauseTime: {
    graphPattern: "?activity_srcStats activo:pauseTime ?activity_srcStats_pauseTime .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_moveRatio: {
    graphPattern: "?activity_srcStats activo:moveRatio ?activity_srcStats_moveRatio .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_calories: {
    graphPattern: "?activity_srcStats activo:calories ?activity_srcStats_calories .",
    requiredVariable: "activity_srcStats"
  },
  activity_srcStats_caloriesPerHour: {
    graphPattern: "?activity_srcStats activo:caloriesPerHour ?activity_srcStats_caloriesPerHour .",
    requiredVariable: "activity_srcStats"
  },

  activity_srcStats_scores: {
    graphPattern: "?activity_srcStats activo:hasScores ?activity_srcStats_scores .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_scores_stress_hrss: {
    graphPattern: "?activity_srcStats_scores activo:heartRateStressScore ?activity_srcStats_scores_stress_hrss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_hrssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:heartRateStressScorePerHour ?activity_srcStats_scores_stress_hrssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trimp: {
    graphPattern: "?activity_srcStats_scores activo:trainingImpulse ?activity_srcStats_scores_stress_trimp .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trimpPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:trainingImpulsePerHour ?activity_srcStats_scores_stress_trimpPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_rss: {
    graphPattern: "?activity_srcStats_scores activo:runningStressScore ?activity_srcStats_scores_stress_rss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_rssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:runningStressScorePerHour ?activity_srcStats_scores_stress_rssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_sss: {
    graphPattern: "?activity_srcStats_scores activo:swimStressScore ?activity_srcStats_scores_stress_sss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_sssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:swimStressScorePerHour ?activity_srcStats_scores_stress_sssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_pss: {
    graphPattern: "?activity_srcStats_scores activo:powerStressScore ?activity_srcStats_scores_stress_pss .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_pssPerHour: {
    graphPattern:
      "?activity_srcStats_scores activo:powerStressScorePerHour ?activity_srcStats_scores_stress_pssPerHour .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trainingEffect_aerobic: {
    graphPattern:
      "?activity_srcStats_scores activo:aerobicTrainingEffect ?activity_srcStats_scores_stress_trainingEffect_aerobic .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_stress_trainingEffect_anaerobic: {
    graphPattern:
      "?activity_srcStats_scores activo:anaerobicTrainingEffect ?activity_srcStats_scores_stress_trainingEffect_anaerobic .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_efficiency: {
    graphPattern: "?activity_srcStats_scores activo:efficiency ?activity_srcStats_scores_efficiency .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_powerHr: {
    graphPattern: "?activity_srcStats_scores activo:averagePowerHeartRateRatio ?activity_srcStats_scores_powerHr .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_runningRating: {
    graphPattern: "?activity_srcStats_scores activo:runningRating ?activity_srcStats_scores_runningRating .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_swolf_25: {
    graphPattern: "?activity_srcStats_scores activo:swolf25 ?activity_srcStats_scores_swolf_25 .",
    requiredVariable: "activity_srcStats_scores"
  },
  activity_srcStats_scores_swolf_50: {
    graphPattern: "?activity_srcStats_scores activo:swolf50 ?activity_srcStats_scores_swolf_50 .",
    requiredVariable: "activity_srcStats_scores"
  },

  activity_srcStats_speed: {
    graphPattern: "?activity_srcStats activo:hasSpeedStats ?activity_srcStats_speed .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_speed_avg: {
    graphPattern: "?activity_srcStats_speed activo:average ?activity_srcStats_speed_avg .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_max: {
    graphPattern: "?activity_srcStats_speed activo:max ?activity_srcStats_speed_max .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_lowQ: {
    graphPattern: "?activity_srcStats_speed activo:lowQ ?activity_srcStats_speed_lowQ .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_upperQ: {
    graphPattern: "?activity_srcStats_speed activo:upperQ ?activity_srcStats_speed_upperQ .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_median: {
    graphPattern: "?activity_srcStats_speed activo:median ?activity_srcStats_speed_median .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_stdDev: {
    graphPattern: "?activity_srcStats_speed activo:stdDev ?activity_srcStats_speed_stdDev .",
    requiredVariable: "activity_srcStats_speed"
  },
  activity_srcStats_speed_best20min: {
    graphPattern:
      "?activity_srcStats_speed activo:hasPeak ?activity_srcStats_speed_peaks ." +
      "?activity_srcStats_speed_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_speed_peaks activo:peakValue ?activity_srcStats_speed_best20min .",
    requiredVariable: "activity_srcStats_speed"
  },

  activity_srcStats_pace: {
    graphPattern: "?activity_srcStats activo:hasPaceStats ?activity_srcStats_pace .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_pace_avg: {
    graphPattern: "?activity_srcStats_pace activo:average ?activity_srcStats_pace_avg .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_max: {
    graphPattern: "?activity_srcStats_pace activo:max ?activity_srcStats_pace_max .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_lowQ: {
    graphPattern: "?activity_srcStats_pace activo:lowQ ?activity_srcStats_pace_lowQ .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_upperQ: {
    graphPattern: "?activity_srcStats_pace activo:upperQ ?activity_srcStats_pace_upperQ .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_median: {
    graphPattern: "?activity_srcStats_pace activo:median ?activity_srcStats_pace_median .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_stdDev: {
    graphPattern: "?activity_srcStats_pace activo:stdDev ?activity_srcStats_pace_stdDev .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_gapAvg: {
    graphPattern: "?activity_srcStats_pace activo:gradeAdjustedPaceAverage ?activity_srcStats_pace_gapAvg .",
    requiredVariable: "activity_srcStats_pace"
  },
  activity_srcStats_pace_best20min: {
    graphPattern:
      "?activity_srcStats_pace activo:hasPeak ?activity_srcStats_pace_peaks ." +
      "?activity_srcStats_pace_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_pace_peaks activo:peakValue ?activity_srcStats_pace_best20min .",
    requiredVariable: "activity_srcStats_pace"
  },

  activity_srcStats_power: {
    graphPattern: "?activity_srcStats activo:hasPowerStats ?activity_srcStats_power .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_power_avg: {
    graphPattern: "?activity_srcStats_power activo:average ?activity_srcStats_power_avg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_max: {
    graphPattern: "?activity_srcStats_power activo:max ?activity_srcStats_power_max .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_lowQ: {
    graphPattern: "?activity_srcStats_power activo:lowQ ?activity_srcStats_power_lowQ .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_upperQ: {
    graphPattern: "?activity_srcStats_power activo:upperQ ?activity_srcStats_power_upperQ .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_median: {
    graphPattern: "?activity_srcStats_power activo:median ?activity_srcStats_power_median .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_stdDev: {
    graphPattern: "?activity_srcStats_power activo:stdDev ?activity_srcStats_power_stdDev .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_best20min: {
    graphPattern:
      "?activity_srcStats_power activo:hasPeak ?activity_srcStats_power_peaks ." +
      "?activity_srcStats_power_peaks activo:peakDuration 1200 ." +
      "?activity_srcStats_power_peaks activo:peakValue ?activity_srcStats_power_best20min .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_avgKg: {
    graphPattern: "?activity_srcStats_power activo:powerToWeightRatio ?activity_srcStats_power_avgKg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_weighted: {
    graphPattern: "?activity_srcStats_power activo:normalizedPowerAverage ?activity_srcStats_power_weighted .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_weightedKg: {
    graphPattern: "?activity_srcStats_power activo:normalizedPowerToWeightRatio ?activity_srcStats_power_weightedKg .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_work: {
    graphPattern: "?activity_srcStats_power activo:work ?activity_srcStats_power_work .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_variabilityIndex: {
    graphPattern: "?activity_srcStats_power activo:variabilityIndex ?activity_srcStats_power_variabilityIndex .",
    requiredVariable: "activity_srcStats_power"
  },
  activity_srcStats_power_intensityFactor: {
    graphPattern: "?activity_srcStats_power activo:intensityFactor ?activity_srcStats_power_intensityFactor .",
    requiredVariable: "activity_srcStats_power"
  },

  activity_srcStats_heartRate: {
    graphPattern: "?activity_srcStats activo:hasHeartRateStats ?activity_srcStats_heartRate .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_heartRate_avg: {
    graphPattern: "?activity_srcStats_heartRate activo:average ?activity_srcStats_heartRate_avg .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_max: {
    graphPattern: "?activity_srcStats_heartRate activo:max ?activity_srcStats_heartRate_max .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_lowQ: {
    graphPattern: "?activity_srcStats_heartRate activo:lowQ ?activity_srcStats_heartRate_lowQ .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_upperQ: {
    graphPattern: "?activity_srcStats_heartRate activo:upperQ ?activity_srcStats_heartRate_upperQ .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_median: {
    graphPattern: "?activity_srcStats_heartRate activo:median ?activity_srcStats_heartRate_median .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_stdDev: {
    graphPattern: "?activity_srcStats_heartRate activo:stdDev ?activity_srcStats_heartRate_stdDev .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_best20min: {
    graphPattern:
      "?activity_srcStats_heartRate activo:hasPeak ?activity_srcStats_heartRate_peaks_best20min ." +
      "?activity_srcStats_heartRate_peaks_best20min activo:peakDuration 1200 ." +
      "?activity_srcStats_heartRate_peaks_best20min activo:peakValue ?activity_srcStats_heartRate_best20min .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_best60min: {
    graphPattern:
      "?activity_srcStats_heartRate activo:hasPeak ?activity_srcStats_heartRate_peak_best60min ." +
      "?activity_srcStats_heartRate_peak_best60min activo:peakDuration 3600 ." +
      "?activity_srcStats_heartRate_peak_best60min activo:peakValue ?activity_srcStats_heartRate_best60min .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_avgReserve: {
    graphPattern: "?activity_srcStats_heartRate activo:averageReserve ?activity_srcStats_heartRate_avgReserve .",
    requiredVariable: "activity_srcStats_heartRate"
  },
  activity_srcStats_heartRate_maxReserve: {
    graphPattern: "?activity_srcStats_heartRate activo:maxReserve ?activity_srcStats_heartRate_maxReserve .",
    requiredVariable: "activity_srcStats_heartRate"
  },

  activity_srcStats_cadence: {
    graphPattern: "?activity_srcStats activo:hasCadenceStats ?activity_srcStats_cadence .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_cadence_avg: {
    graphPattern: "?activity_srcStats_cadence activo:average ?activity_srcStats_cadence_avg .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_max: {
    graphPattern: "?activity_srcStats_cadence activo:max ?activity_srcStats_cadence_max .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_lowQ: {
    graphPattern: "?activity_srcStats_cadence activo:lowQ ?activity_srcStats_cadence_lowQ .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_upperQ: {
    graphPattern: "?activity_srcStats_cadence activo:upperQ ?activity_srcStats_cadence_upperQ .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_median: {
    graphPattern: "?activity_srcStats_cadence activo:median ?activity_srcStats_cadence_median .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_stdDev: {
    graphPattern: "?activity_srcStats_cadence activo:stdDev ?activity_srcStats_cadence_stdDev .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_avgActive: {
    graphPattern: "?activity_srcStats_cadence activo:averageActive ?activity_srcStats_cadence_avgActive .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_activeRatio: {
    graphPattern: "?activity_srcStats_cadence activo:activeRatio ?activity_srcStats_cadence_activeRatio .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_activeTime: {
    graphPattern: "?activity_srcStats_cadence activo:activeTime ?activity_srcStats_cadence_activeTime .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_cycles: {
    graphPattern: "?activity_srcStats_cadence activo:cycles ?activity_srcStats_cadence_cycles .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_distPerCycle: {
    graphPattern: "?activity_srcStats_cadence activo:distancePerCycle ?activity_srcStats_cadence_distPerCycle .",
    requiredVariable: "activity_srcStats_cadence"
  },
  activity_srcStats_cadence_slope_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_srcStats_cadence_slope_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_srcStats_cadence_slope_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_srcStats_cadence_slope_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_srcStats_cadence_slope_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_srcStats_cadence_slope_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },

  activity_srcStats_grade: {
    graphPattern: "?activity_srcStats activo:hasGradeStats ?activity_srcStats_grade .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_grade_avg: {
    graphPattern: "?activity_srcStats_grade activo:average ?activity_srcStats_grade_avg .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_max: {
    graphPattern: "?activity_srcStats_grade activo:max ?activity_srcStats_grade_max .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_min: {
    graphPattern: "?activity_srcStats_grade activo:min ?activity_srcStats_grade_min .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_lowQ: {
    graphPattern: "?activity_srcStats_grade activo:lowQ ?activity_srcStats_grade_lowQ .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_upperQ: {
    graphPattern: "?activity_srcStats_grade activo:upperQ ?activity_srcStats_grade_upperQ .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_median: {
    graphPattern: "?activity_srcStats_grade activo:median ?activity_srcStats_grade_median .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_stdDev: {
    graphPattern: "?activity_srcStats_grade activo:stdDev ?activity_srcStats_grade_stdDev .",
    requiredVariable: "activity_srcStats_grade"
  },
  activity_srcStats_grade_slopeTime: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeTime ?activity_srcStats_grade_slopeTime .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeTime_up: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:uphill ?activity_srcStats_grade_slopeTime_up .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_flat: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:flat ?activity_srcStats_grade_slopeTime_flat .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_down: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:downhill ?activity_srcStats_grade_slopeTime_down .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeTime_total: {
    graphPattern: "?activity_srcStats_grade_slopeTime activo:total ?activity_srcStats_grade_slopeTime_total .",
    requiredVariable: "activity_srcStats_grade_slopeTime"
  },
  activity_srcStats_grade_slopeSpeed: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeSpeed ?activity_srcStats_grade_slopeSpeed .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeSpeed_up: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:uphill ?activity_srcStats_grade_slopeSpeed_up .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_flat: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:flat ?activity_srcStats_grade_slopeSpeed_flat .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_down: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:downhill ?activity_srcStats_grade_slopeSpeed_down .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopeSpeed_total: {
    graphPattern: "?activity_srcStats_grade_slopeSpeed activo:total ?activity_srcStats_grade_slopeSpeed_total .",
    requiredVariable: "activity_srcStats_grade_slopeSpeed"
  },
  activity_srcStats_grade_slopePace: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopePace ?activity_srcStats_grade_slopePace .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopePace_up: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:uphill ?activity_srcStats_grade_slopePace_up .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_flat: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:flat ?activity_srcStats_grade_slopePace_flat .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_down: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:downhill ?activity_srcStats_grade_slopePace_down .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopePace_total: {
    graphPattern: "?activity_srcStats_grade_slopePace activo:total ?activity_srcStats_grade_slopePace_total .",
    requiredVariable: "activity_srcStats_grade_slopePace"
  },
  activity_srcStats_grade_slopeDistance: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeDistance ?activity_srcStats_grade_slopeDistance .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeDistance_up: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:uphill ?activity_srcStats_grade_slopeDistance_up .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_flat: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:flat ?activity_srcStats_grade_slopeDistance_flat .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_down: {
    graphPattern:
      "?activity_srcStats_grade_slopeDistance activo:downhill ?activity_srcStats_grade_slopeDistance_down .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeDistance_total: {
    graphPattern: "?activity_srcStats_grade_slopeDistance activo:total ?activity_srcStats_grade_slopeDistance_total .",
    requiredVariable: "activity_srcStats_grade_slopeDistance"
  },
  activity_srcStats_grade_slopeCadence: {
    graphPattern: "?activity_srcStats_grade activo:hasSlopeCadence ?activity_srcStats_grade_slopeCadence .",
    requiredVariable: "activity_srcStats_grade",
    ignore: true
  },
  activity_srcStats_grade_slopeCadence_up: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:uphill ?activity_srcStats_grade_slopeCadence_up .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_flat: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:flat ?activity_srcStats_grade_slopeCadence_flat .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_down: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:downhill ?activity_srcStats_grade_slopeCadence_down .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeCadence_total: {
    graphPattern: "?activity_srcStats_grade_slopeCadence activo:total ?activity_srcStats_grade_slopeCadence_total .",
    requiredVariable: "activity_srcStats_grade_slopeCadence"
  },
  activity_srcStats_grade_slopeProfile: {
    graphPattern:
      "?activity_srcStats_grade activo:hasSlopeProfile ?activity_srcStats_grade_slopeProfileIri ." +
      'BIND(IF(?activity_srcStats_grade_slopeProfileIri = activo:HillyProfile, "HILLY", ' +
      'IF(?activity_srcStats_grade_slopeProfileIri = activo:FlatProfile, "FLAT", "")) AS ?activity_srcStats_grade_slopeProfile) .',
    requiredVariable: "activity_srcStats_grade"
  },

  activity_srcStats_elevation: {
    graphPattern: "?activity_srcStats activo:hasElevationStats ?activity_srcStats_elevation .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_elevation_avg: {
    graphPattern: "?activity_srcStats_elevation activo:average ?activity_srcStats_elevation_avg .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_max: {
    graphPattern: "?activity_srcStats_elevation activo:max ?activity_srcStats_elevation_max .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_min: {
    graphPattern: "?activity_srcStats_elevation activo:min ?activity_srcStats_elevation_min .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_lowQ: {
    graphPattern: "?activity_srcStats_elevation activo:lowQ ?activity_srcStats_elevation_lowQ .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_upperQ: {
    graphPattern: "?activity_srcStats_elevation activo:upperQ ?activity_srcStats_elevation_upperQ .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_median: {
    graphPattern: "?activity_srcStats_elevation activo:median ?activity_srcStats_elevation_median .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_stdDev: {
    graphPattern: "?activity_srcStats_elevation activo:stdDev ?activity_srcStats_elevation_stdDev .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_ascent: {
    graphPattern: "?activity_srcStats_elevation activo:ascent ?activity_srcStats_elevation_ascent .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_descent: {
    graphPattern: "?activity_srcStats_elevation activo:descent ?activity_srcStats_elevation_descent .",
    requiredVariable: "activity_srcStats_elevation"
  },
  activity_srcStats_elevation_ascentSpeed: {
    graphPattern: "?activity_srcStats_elevation activo:ascentSpeed ?activity_srcStats_elevation_ascentSpeed .",
    requiredVariable: "activity_srcStats_elevation"
  },

  activity_srcStats_dynamics_cycling: {
    graphPattern:
      "?activity_srcStats activo:hasDynamicsStats ?activity_srcStats_dynamics_cycling .\n" +
      "?activity_srcStats_dynamics_cycling a activo:CyclingDynamicsStats .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_standingTime: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:standingTime ?activity_srcStats_dynamics_cycling_standingTime .",
    requiredVariable: "activity_srcStats_dynamics_cycling"
  },
  activity_srcStats_dynamics_cycling_seatedTime: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:seatedTime ?activity_srcStats_dynamics_cycling_seatedTime .",
    requiredVariable: "activity_srcStats_dynamics_cycling"
  },
  activity_srcStats_dynamics_cycling_balance: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasBalance ?activity_srcStats_dynamics_cycling_balance .\n" +
      "?activity_srcStats_dynamics_cycling_balance a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_balance_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_balance activo:left ?activity_srcStats_dynamics_cycling_balance_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_balance"
  },
  activity_srcStats_dynamics_cycling_balance_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_balance activo:right ?activity_srcStats_dynamics_cycling_balance_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_balance"
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasPedalSmoothness ?activity_srcStats_dynamics_cycling_pedalSmoothness .\n" +
      "?activity_srcStats_dynamics_cycling_pedalSmoothness a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_pedalSmoothness activo:left ?activity_srcStats_dynamics_cycling_pedalSmoothness_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_pedalSmoothness"
  },
  activity_srcStats_dynamics_cycling_pedalSmoothness_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_pedalSmoothness activo:right ?activity_srcStats_dynamics_cycling_pedalSmoothness_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_pedalSmoothness"
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling activo:hasTorqueEffectiveness ?activity_srcStats_dynamics_cycling_torqueEffectiveness .\n" +
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_cycling",
    ignore: true
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness_left: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness activo:left ?activity_srcStats_dynamics_cycling_torqueEffectiveness_left .",
    requiredVariable: "activity_srcStats_dynamics_cycling_torqueEffectiveness"
  },
  activity_srcStats_dynamics_cycling_torqueEffectiveness_right: {
    graphPattern:
      "?activity_srcStats_dynamics_cycling_torqueEffectiveness activo:right ?activity_srcStats_dynamics_cycling_torqueEffectiveness_right .",
    requiredVariable: "activity_srcStats_dynamics_cycling_torqueEffectiveness"
  },
  activity_srcStats_dynamics_running: {
    graphPattern:
      "?activity_srcStats activo:hasDynamicsStats ?activity_srcStats_dynamics_running .\n" +
      "?activity_srcStats_dynamics_running a activo:RunningDynamicsStats .",
    requiredVariable: "activity_srcStats",
    ignore: true
  },
  activity_srcStats_dynamics_running_verticalOscillation: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:verticalOscillation ?activity_srcStats_dynamics_running_verticalOscillation .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_verticalRatio: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:verticalRatio ?activity_srcStats_dynamics_running_verticalRatio .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_stanceTimeBalance: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:hasGroundContactTimeBalance ?activity_srcStats_dynamics_running_stanceTimeBalance .\n" +
      "?activity_srcStats_dynamics_running_stanceTimeBalance a activo:LeftRightPercent .",
    requiredVariable: "activity_srcStats_dynamics_running",
    ignore: true
  },
  activity_srcStats_dynamics_running_stanceTimeBalance_left: {
    graphPattern:
      "?activity_srcStats_dynamics_running_stanceTimeBalance activo:left ?activity_srcStats_dynamics_running_stanceTimeBalance_left .",
    requiredVariable: "activity_srcStats_dynamics_running_stanceTimeBalance"
  },
  activity_srcStats_dynamics_running_stanceTimeBalance_right: {
    graphPattern:
      "?activity_srcStats_dynamics_running_stanceTimeBalance activo:right ?activity_srcStats_dynamics_running_stanceTimeBalance_right .",
    requiredVariable: "activity_srcStats_dynamics_running_stanceTimeBalance"
  },
  activity_srcStats_dynamics_running_stanceTime: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:groundContactTime ?activity_srcStats_dynamics_running_stanceTime .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },
  activity_srcStats_dynamics_running_avgStrideLength: {
    graphPattern:
      "?activity_srcStats_dynamics_running activo:averageStrideLength ?activity_srcStats_dynamics_running_avgStrideLength .",
    requiredVariable: "activity_srcStats_dynamics_running"
  },

  // normal stats
  activity_stats: {
    graphPattern: "?activity activo:hasStats ?activity_stats .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_stats_distance: {
    graphPattern: "?activity_stats activo:distance ?activity_stats_distance .",
    requiredVariable: "activity_stats"
  },
  activity_stats_elevationGain: {
    graphPattern: "?activity_stats_elevation activo:ascent ?activity_stats_elevationGain .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elapsedTime: {
    graphPattern: "?activity_stats activo:elapsedTime ?activity_stats_elapsedTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_movingTime: {
    graphPattern: "?activity_stats activo:movingTime ?activity_stats_movingTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_pauseTime: {
    graphPattern: "?activity_stats activo:pauseTime ?activity_stats_pauseTime .",
    requiredVariable: "activity_stats"
  },
  activity_stats_moveRatio: {
    graphPattern: "?activity_stats activo:moveRatio ?activity_stats_moveRatio .",
    requiredVariable: "activity_stats"
  },
  activity_stats_calories: {
    graphPattern: "?activity_stats activo:calories ?activity_stats_calories .",
    requiredVariable: "activity_stats"
  },
  activity_stats_caloriesPerHour: {
    graphPattern: "?activity_stats activo:caloriesPerHour ?activity_stats_caloriesPerHour .",
    requiredVariable: "activity_stats"
  },

  activity_stats_scores: {
    graphPattern: "?activity_stats activo:hasScores ?activity_stats_scores .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_scores_stress_hrss: {
    graphPattern: "?activity_stats_scores activo:heartRateStressScore ?activity_stats_scores_stress_hrss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_hrssPerHour: {
    graphPattern:
      "?activity_stats_scores activo:heartRateStressScorePerHour ?activity_stats_scores_stress_hrssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trimp: {
    graphPattern: "?activity_stats_scores activo:trainingImpulse ?activity_stats_scores_stress_trimp .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trimpPerHour: {
    graphPattern: "?activity_stats_scores activo:trainingImpulsePerHour ?activity_stats_scores_stress_trimpPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_rss: {
    graphPattern: "?activity_stats_scores activo:runningStressScore ?activity_stats_scores_stress_rss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_rssPerHour: {
    graphPattern: "?activity_stats_scores activo:runningStressScorePerHour ?activity_stats_scores_stress_rssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_sss: {
    graphPattern: "?activity_stats_scores activo:swimStressScore ?activity_stats_scores_stress_sss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_sssPerHour: {
    graphPattern: "?activity_stats_scores activo:swimStressScorePerHour ?activity_stats_scores_stress_sssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_pss: {
    graphPattern: "?activity_stats_scores activo:powerStressScore ?activity_stats_scores_stress_pss .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_pssPerHour: {
    graphPattern: "?activity_stats_scores activo:powerStressScorePerHour ?activity_stats_scores_stress_pssPerHour .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trainingEffect_aerobic: {
    graphPattern:
      "?activity_stats_scores activo:aerobicTrainingEffect ?activity_stats_scores_stress_trainingEffect_aerobic .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_stress_trainingEffect_anaerobic: {
    graphPattern:
      "?activity_stats_scores activo:anaerobicTrainingEffect ?activity_stats_scores_stress_trainingEffect_anaerobic .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_efficiency: {
    graphPattern: "?activity_stats_scores activo:efficiency ?activity_stats_scores_efficiency .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_powerHr: {
    graphPattern: "?activity_stats_scores activo:averagePowerHeartRateRatio ?activity_stats_scores_powerHr .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_runningRating: {
    graphPattern: "?activity_stats_scores activo:runningRating ?activity_stats_scores_runningRating .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_swolf_25: {
    graphPattern: "?activity_stats_scores activo:swolf25 ?activity_stats_scores_swolf_25 .",
    requiredVariable: "activity_stats_scores"
  },
  activity_stats_scores_swolf_50: {
    graphPattern: "?activity_stats_scores activo:swolf50 ?activity_stats_scores_swolf_50 .",
    requiredVariable: "activity_stats_scores"
  },

  activity_stats_speed: {
    graphPattern: "?activity_stats activo:hasSpeedStats ?activity_stats_speed .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_speed_avg: {
    graphPattern: "?activity_stats_speed activo:average ?activity_stats_speed_avg .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_max: {
    graphPattern: "?activity_stats_speed activo:max ?activity_stats_speed_max .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_lowQ: {
    graphPattern: "?activity_stats_speed activo:lowQ ?activity_stats_speed_lowQ .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_upperQ: {
    graphPattern: "?activity_stats_speed activo:upperQ ?activity_stats_speed_upperQ .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_median: {
    graphPattern: "?activity_stats_speed activo:median ?activity_stats_speed_median .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_stdDev: {
    graphPattern: "?activity_stats_speed activo:stdDev ?activity_stats_speed_stdDev .",
    requiredVariable: "activity_stats_speed"
  },
  activity_stats_speed_best20min: {
    graphPattern:
      "?activity_stats_speed activo:hasPeak ?activity_stats_speed_peaks ." +
      "?activity_stats_speed_peaks activo:peakDuration 1200 ." +
      "?activity_stats_speed_peaks activo:peakValue ?activity_stats_speed_best20min .",
    requiredVariable: "activity_stats_speed"
  },

  activity_stats_pace: {
    graphPattern: "?activity_stats activo:hasPaceStats ?activity_stats_pace .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_pace_avg: {
    graphPattern: "?activity_stats_pace activo:average ?activity_stats_pace_avg .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_max: {
    graphPattern: "?activity_stats_pace activo:max ?activity_stats_pace_max .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_lowQ: {
    graphPattern: "?activity_stats_pace activo:lowQ ?activity_stats_pace_lowQ .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_upperQ: {
    graphPattern: "?activity_stats_pace activo:upperQ ?activity_stats_pace_upperQ .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_median: {
    graphPattern: "?activity_stats_pace activo:median ?activity_stats_pace_median .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_stdDev: {
    graphPattern: "?activity_stats_pace activo:stdDev ?activity_stats_pace_stdDev .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_gapAvg: {
    graphPattern: "?activity_stats_pace activo:gradeAdjustedPaceAverage ?activity_stats_pace_gapAvg .",
    requiredVariable: "activity_stats_pace"
  },
  activity_stats_pace_best20min: {
    graphPattern:
      "?activity_stats_pace activo:hasPeak ?activity_stats_pace_peaks ." +
      "?activity_stats_pace_peaks activo:peakDuration 1200 ." +
      "?activity_stats_pace_peaks activo:peakValue ?activity_stats_pace_best20min .",
    requiredVariable: "activity_stats_pace"
  },

  activity_stats_power: {
    graphPattern: "?activity_stats activo:hasPowerStats ?activity_stats_power .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_power_avg: {
    graphPattern: "?activity_stats_power activo:average ?activity_stats_power_avg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_max: {
    graphPattern: "?activity_stats_power activo:max ?activity_stats_power_max .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_lowQ: {
    graphPattern: "?activity_stats_power activo:lowQ ?activity_stats_power_lowQ .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_upperQ: {
    graphPattern: "?activity_stats_power activo:upperQ ?activity_stats_power_upperQ .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_median: {
    graphPattern: "?activity_stats_power activo:median ?activity_stats_power_median .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_stdDev: {
    graphPattern: "?activity_stats_power activo:stdDev ?activity_stats_power_stdDev .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_best20min: {
    graphPattern:
      "?activity_stats_power activo:hasPeak ?activity_stats_power_peaks ." +
      "?activity_stats_power_peaks activo:peakDuration 1200 ." +
      "?activity_stats_power_peaks activo:peakValue ?activity_stats_power_best20min .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_avgKg: {
    graphPattern: "?activity_stats_power activo:powerToWeightRatio ?activity_stats_power_avgKg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_weighted: {
    graphPattern: "?activity_stats_power activo:normalizedPowerAverage ?activity_stats_power_weighted .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_weightedKg: {
    graphPattern: "?activity_stats_power activo:normalizedPowerToWeightRatio ?activity_stats_power_weightedKg .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_work: {
    graphPattern: "?activity_stats_power activo:work ?activity_stats_power_work .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_variabilityIndex: {
    graphPattern: "?activity_stats_power activo:variabilityIndex ?activity_stats_power_variabilityIndex .",
    requiredVariable: "activity_stats_power"
  },
  activity_stats_power_intensityFactor: {
    graphPattern: "?activity_stats_power activo:intensityFactor ?activity_stats_power_intensityFactor .",
    requiredVariable: "activity_stats_power"
  },

  activity_stats_heartRate: {
    graphPattern: "?activity_stats activo:hasHeartRateStats ?activity_stats_heartRate .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_heartRate_avg: {
    graphPattern: "?activity_stats_heartRate activo:average ?activity_stats_heartRate_avg .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_max: {
    graphPattern: "?activity_stats_heartRate activo:max ?activity_stats_heartRate_max .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_lowQ: {
    graphPattern: "?activity_stats_heartRate activo:lowQ ?activity_stats_heartRate_lowQ .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_upperQ: {
    graphPattern: "?activity_stats_heartRate activo:upperQ ?activity_stats_heartRate_upperQ .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_median: {
    graphPattern: "?activity_stats_heartRate activo:median ?activity_stats_heartRate_median .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_stdDev: {
    graphPattern: "?activity_stats_heartRate activo:stdDev ?activity_stats_heartRate_stdDev .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_best20min: {
    graphPattern:
      "?activity_stats_heartRate activo:hasPeak ?activity_stats_heartRate_peaks_best20min ." +
      "?activity_stats_heartRate_peaks_best20min activo:peakDuration 1200 ." +
      "?activity_stats_heartRate_peaks_best20min activo:peakValue ?activity_stats_heartRate_best20min .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_best60min: {
    graphPattern:
      "?activity_stats_heartRate activo:hasPeak ?activity_stats_heartRate_peak_best60min ." +
      "?activity_stats_heartRate_peak_best60min activo:peakDuration 3600 ." +
      "?activity_stats_heartRate_peak_best60min activo:peakValue ?activity_stats_heartRate_best60min .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_avgReserve: {
    graphPattern: "?activity_stats_heartRate activo:averageReserve ?activity_stats_heartRate_avgReserve .",
    requiredVariable: "activity_stats_heartRate"
  },
  activity_stats_heartRate_maxReserve: {
    graphPattern: "?activity_stats_heartRate activo:maxReserve ?activity_stats_heartRate_maxReserve .",
    requiredVariable: "activity_stats_heartRate"
  },

  activity_stats_cadence: {
    graphPattern: "?activity_stats activo:hasCadenceStats ?activity_stats_cadence .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_cadence_avg: {
    graphPattern: "?activity_stats_cadence activo:average ?activity_stats_cadence_avg .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_max: {
    graphPattern: "?activity_stats_cadence activo:max ?activity_stats_cadence_max .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_lowQ: {
    graphPattern: "?activity_stats_cadence activo:lowQ ?activity_stats_cadence_lowQ .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_upperQ: {
    graphPattern: "?activity_stats_cadence activo:upperQ ?activity_stats_cadence_upperQ .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_median: {
    graphPattern: "?activity_stats_cadence activo:median ?activity_stats_cadence_median .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_stdDev: {
    graphPattern: "?activity_stats_cadence activo:stdDev ?activity_stats_cadence_stdDev .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_avgActive: {
    graphPattern: "?activity_stats_cadence activo:averageActive ?activity_stats_cadence_avgActive .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_activeRatio: {
    graphPattern: "?activity_stats_cadence activo:activeRatio ?activity_stats_cadence_activeRatio .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_activeTime: {
    graphPattern: "?activity_stats_cadence activo:activeTime ?activity_stats_cadence_activeTime .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_cycles: {
    graphPattern: "?activity_stats_cadence activo:cycles ?activity_stats_cadence_cycles .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_distPerCycle: {
    graphPattern: "?activity_stats_cadence activo:distancePerCycle ?activity_stats_cadence_distPerCycle .",
    requiredVariable: "activity_stats_cadence"
  },
  activity_stats_cadence_slope_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_stats_cadence_slope_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_stats_cadence_slope_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_stats_cadence_slope_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_cadence_slope_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_stats_cadence_slope_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },

  activity_stats_grade: {
    graphPattern: "?activity_stats activo:hasGradeStats ?activity_stats_grade .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_grade_avg: {
    graphPattern: "?activity_stats_grade activo:average ?activity_stats_grade_avg .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_max: {
    graphPattern: "?activity_stats_grade activo:max ?activity_stats_grade_max .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_min: {
    graphPattern: "?activity_stats_grade activo:min ?activity_stats_grade_min .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_lowQ: {
    graphPattern: "?activity_stats_grade activo:lowQ ?activity_stats_grade_lowQ .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_upperQ: {
    graphPattern: "?activity_stats_grade activo:upperQ ?activity_stats_grade_upperQ .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_median: {
    graphPattern: "?activity_stats_grade activo:median ?activity_stats_grade_median .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_stdDev: {
    graphPattern: "?activity_stats_grade activo:stdDev ?activity_stats_grade_stdDev .",
    requiredVariable: "activity_stats_grade"
  },
  activity_stats_grade_slopeTime: {
    graphPattern: "?activity_stats_grade activo:hasSlopeTime ?activity_stats_grade_slopeTime .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeTime_up: {
    graphPattern: "?activity_stats_grade_slopeTime activo:uphill ?activity_stats_grade_slopeTime_up .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_flat: {
    graphPattern: "?activity_stats_grade_slopeTime activo:flat ?activity_stats_grade_slopeTime_flat .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_down: {
    graphPattern: "?activity_stats_grade_slopeTime activo:downhill ?activity_stats_grade_slopeTime_down .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeTime_total: {
    graphPattern: "?activity_stats_grade_slopeTime activo:total ?activity_stats_grade_slopeTime_total .",
    requiredVariable: "activity_stats_grade_slopeTime"
  },
  activity_stats_grade_slopeSpeed: {
    graphPattern: "?activity_stats_grade activo:hasSlopeSpeed ?activity_stats_grade_slopeSpeed .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeSpeed_up: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:uphill ?activity_stats_grade_slopeSpeed_up .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_flat: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:flat ?activity_stats_grade_slopeSpeed_flat .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_down: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:downhill ?activity_stats_grade_slopeSpeed_down .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopeSpeed_total: {
    graphPattern: "?activity_stats_grade_slopeSpeed activo:total ?activity_stats_grade_slopeSpeed_total .",
    requiredVariable: "activity_stats_grade_slopeSpeed"
  },
  activity_stats_grade_slopePace: {
    graphPattern: "?activity_stats_grade activo:hasSlopePace ?activity_stats_grade_slopePace .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopePace_up: {
    graphPattern: "?activity_stats_grade_slopePace activo:uphill ?activity_stats_grade_slopePace_up .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_flat: {
    graphPattern: "?activity_stats_grade_slopePace activo:flat ?activity_stats_grade_slopePace_flat .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_down: {
    graphPattern: "?activity_stats_grade_slopePace activo:downhill ?activity_stats_grade_slopePace_down .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopePace_total: {
    graphPattern: "?activity_stats_grade_slopePace activo:total ?activity_stats_grade_slopePace_total .",
    requiredVariable: "activity_stats_grade_slopePace"
  },
  activity_stats_grade_slopeDistance: {
    graphPattern: "?activity_stats_grade activo:hasSlopeDistance ?activity_stats_grade_slopeDistance .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeDistance_up: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:uphill ?activity_stats_grade_slopeDistance_up .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_flat: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:flat ?activity_stats_grade_slopeDistance_flat .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_down: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:downhill ?activity_stats_grade_slopeDistance_down .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeDistance_total: {
    graphPattern: "?activity_stats_grade_slopeDistance activo:total ?activity_stats_grade_slopeDistance_total .",
    requiredVariable: "activity_stats_grade_slopeDistance"
  },
  activity_stats_grade_slopeCadence: {
    graphPattern: "?activity_stats_grade activo:hasSlopeCadence ?activity_stats_grade_slopeCadence .",
    requiredVariable: "activity_stats_grade",
    ignore: true
  },
  activity_stats_grade_slopeCadence_up: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:uphill ?activity_stats_grade_slopeCadence_up .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_flat: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:flat ?activity_stats_grade_slopeCadence_flat .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_down: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:downhill ?activity_stats_grade_slopeCadence_down .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeCadence_total: {
    graphPattern: "?activity_stats_grade_slopeCadence activo:total ?activity_stats_grade_slopeCadence_total .",
    requiredVariable: "activity_stats_grade_slopeCadence"
  },
  activity_stats_grade_slopeProfile: {
    graphPattern:
      "?activity_stats_grade activo:hasSlopeProfile ?activity_stats_grade_slopeProfileIri ." +
      'BIND(IF(?activity_stats_grade_slopeProfileIri = activo:HillyProfile, "HILLY", ' +
      'IF(?activity_stats_grade_slopeProfileIri = activo:FlatProfile, "FLAT", "")) AS ?activity_stats_grade_slopeProfile) .',
    requiredVariable: "activity_stats_grade"
  },

  activity_stats_elevation: {
    graphPattern: "?activity_stats activo:hasElevationStats ?activity_stats_elevation .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_elevation_avg: {
    graphPattern: "?activity_stats_elevation activo:average ?activity_stats_elevation_avg .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_max: {
    graphPattern: "?activity_stats_elevation activo:max ?activity_stats_elevation_max .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_min: {
    graphPattern: "?activity_stats_elevation activo:min ?activity_stats_elevation_min .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_lowQ: {
    graphPattern: "?activity_stats_elevation activo:lowQ ?activity_stats_elevation_lowQ .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_upperQ: {
    graphPattern: "?activity_stats_elevation activo:upperQ ?activity_stats_elevation_upperQ .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_median: {
    graphPattern: "?activity_stats_elevation activo:median ?activity_stats_elevation_median .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_stdDev: {
    graphPattern: "?activity_stats_elevation activo:stdDev ?activity_stats_elevation_stdDev .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_ascent: {
    graphPattern: "?activity_stats_elevation activo:ascent ?activity_stats_elevation_ascent .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_descent: {
    graphPattern: "?activity_stats_elevation activo:descent ?activity_stats_elevation_descent .",
    requiredVariable: "activity_stats_elevation"
  },
  activity_stats_elevation_ascentSpeed: {
    graphPattern: "?activity_stats_elevation activo:ascentSpeed ?activity_stats_elevation_ascentSpeed .",
    requiredVariable: "activity_stats_elevation"
  },

  activity_stats_dynamics_cycling: {
    graphPattern:
      "?activity_stats activo:hasDynamicsStats ?activity_stats_dynamics_cycling .\n" +
      "?activity_stats_dynamics_cycling a activo:CyclingDynamicsStats .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_dynamics_cycling_standingTime: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:standingTime ?activity_stats_dynamics_cycling_standingTime .",
    requiredVariable: "activity_stats_dynamics_cycling"
  },
  activity_stats_dynamics_cycling_seatedTime: {
    graphPattern: "?activity_stats_dynamics_cycling activo:seatedTime ?activity_stats_dynamics_cycling_seatedTime .",
    requiredVariable: "activity_stats_dynamics_cycling"
  },
  activity_stats_dynamics_cycling_balance: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasBalance ?activity_stats_dynamics_cycling_balance .\n" +
      "?activity_stats_dynamics_cycling_balance a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_balance_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_balance activo:left ?activity_stats_dynamics_cycling_balance_left .",
    requiredVariable: "activity_stats_dynamics_cycling_balance"
  },
  activity_stats_dynamics_cycling_balance_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_balance activo:right ?activity_stats_dynamics_cycling_balance_right .",
    requiredVariable: "activity_stats_dynamics_cycling_balance"
  },
  activity_stats_dynamics_cycling_pedalSmoothness: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasPedalSmoothness ?activity_stats_dynamics_cycling_pedalSmoothness .\n" +
      "?activity_stats_dynamics_cycling_pedalSmoothness a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_pedalSmoothness_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_pedalSmoothness activo:left ?activity_stats_dynamics_cycling_pedalSmoothness_left .",
    requiredVariable: "activity_stats_dynamics_cycling_pedalSmoothness"
  },
  activity_stats_dynamics_cycling_pedalSmoothness_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_pedalSmoothness activo:right ?activity_stats_dynamics_cycling_pedalSmoothness_right .",
    requiredVariable: "activity_stats_dynamics_cycling_pedalSmoothness"
  },
  activity_stats_dynamics_cycling_torqueEffectiveness: {
    graphPattern:
      "?activity_stats_dynamics_cycling activo:hasTorqueEffectiveness ?activity_stats_dynamics_cycling_torqueEffectiveness .\n" +
      "?activity_stats_dynamics_cycling_torqueEffectiveness a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_cycling",
    ignore: true
  },
  activity_stats_dynamics_cycling_torqueEffectiveness_left: {
    graphPattern:
      "?activity_stats_dynamics_cycling_torqueEffectiveness activo:left ?activity_stats_dynamics_cycling_torqueEffectiveness_left .",
    requiredVariable: "activity_stats_dynamics_cycling_torqueEffectiveness"
  },
  activity_stats_dynamics_cycling_torqueEffectiveness_right: {
    graphPattern:
      "?activity_stats_dynamics_cycling_torqueEffectiveness activo:right ?activity_stats_dynamics_cycling_torqueEffectiveness_right .",
    requiredVariable: "activity_stats_dynamics_cycling_torqueEffectiveness"
  },
  activity_stats_dynamics_running: {
    graphPattern:
      "?activity_stats activo:hasDynamicsStats ?activity_stats_dynamics_running .\n" +
      "?activity_stats_dynamics_running a activo:RunningDynamicsStats .",
    requiredVariable: "activity_stats",
    ignore: true
  },
  activity_stats_dynamics_running_verticalOscillation: {
    graphPattern:
      "?activity_stats_dynamics_running activo:verticalOscillation ?activity_stats_dynamics_running_verticalOscillation .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_verticalRatio: {
    graphPattern:
      "?activity_stats_dynamics_running activo:verticalRatio ?activity_stats_dynamics_running_verticalRatio .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_stanceTimeBalance: {
    graphPattern:
      "?activity_stats_dynamics_running activo:hasGroundContactTimeBalance ?activity_stats_dynamics_running_stanceTimeBalance .\n" +
      "?activity_stats_dynamics_running_stanceTimeBalance a activo:LeftRightPercent .",
    requiredVariable: "activity_stats_dynamics_running",
    ignore: true
  },
  activity_stats_dynamics_running_stanceTimeBalance_left: {
    graphPattern:
      "?activity_stats_dynamics_running_stanceTimeBalance activo:left ?activity_stats_dynamics_running_stanceTimeBalance_left .",
    requiredVariable: "activity_stats_dynamics_running_stanceTimeBalance"
  },
  activity_stats_dynamics_running_stanceTimeBalance_right: {
    graphPattern:
      "?activity_stats_dynamics_running_stanceTimeBalance activo:right ?activity_stats_dynamics_running_stanceTimeBalance_right .",
    requiredVariable: "activity_stats_dynamics_running_stanceTimeBalance"
  },
  activity_stats_dynamics_running_stanceTime: {
    graphPattern:
      "?activity_stats_dynamics_running activo:groundContactTime ?activity_stats_dynamics_running_stanceTime .",
    requiredVariable: "activity_stats_dynamics_running"
  },
  activity_stats_dynamics_running_avgStrideLength: {
    graphPattern:
      "?activity_stats_dynamics_running activo:averageStrideLength ?activity_stats_dynamics_running_avgStrideLength .",
    requiredVariable: "activity_stats_dynamics_running"
  },

  activity_laps: {
    graphPattern: "SELECT (COUNT(?activity_lap) AS ?activity_laps) WHERE { ?activity activo:hasLap ?activity_lap . }",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_laps")) {
        return null;
      }
      let laps = [];
      for (let i = 0; i < parseInt(bindings.get("activity_laps").value); i++) {
        laps.push({
          id: i + 1,
          distance: null,
          duration: null,
          startTime: null,
          endTime: null
        });
      }
      return parseInt(bindings.get("activity_laps").value);
    }
  },
  activity_flags: {
    graphPattern:
      "SELECT (COUNT(?activity_flag) AS ?activity_flags) WHERE { ?activity activo:hasFlag ?activity_flag . }",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_flags")) {
        return null;
      }
      return [];
    }
  },

  activity_isSwimPool: {
    graphPattern: "?activity activo:isSwimPool ?activity_isSwimPool .",
    requiredVariable: "activity"
  },
  activity_latLngCenter: {
    graphPattern:
      "?activity activo:latCenter ?activity_latCenter .\n" + "?activity activo:lonCenter ?activity_lngCenter .",
    requiredVariable: "activity",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_latCenter") || !bindings.has("activity_lngCenter")) {
        return null;
      }
      return [
        parseFloat(bindings.get("activity_latCenter").value),
        parseFloat(bindings.get("activity_lngCenter").value)
      ];
    }
  },
  activity_hash: {
    graphPattern: "?activity activo:hash ?activity_hash .",
    requiredVariable: "activity"
  },
  activity_settingsLack: {
    graphPattern: "?activity activo:isWithoutAthletePerformance ?activity_settingsLack .",
    requiredVariable: "activity"
  },
  activity_creationTime: {
    graphPattern: "?activity prov:generatedAtTime ?activity_creationTime .",
    requiredVariable: "activity"
  },
  activity_lastEditTime: {
    graphPattern: "",
    requiredVariable: "activity_creationTime",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_creationTime")) {
        return null;
      }
      return bindings.get("activity_creationTime").value;
    }
  },
  activity_device: {
    graphPattern:
      "?activity_extras_file prov:wasAttributedTo ?activity_deviceAgent ." +
      "?activity_deviceAgent foaf:name ?activity_device .",
    requiredVariable: "activity_extras_file"
  },
  activity_notes: {
    graphPattern: "?activity activo:notes ?activity_notes .",
    requiredVariable: "activity"
  },
  activity_autoDetectedType: {
    graphPattern: "?activity activo:isTypeAutoDetected ?activity_autoDetectedType .",
    requiredVariable: "activity"
  },
  activity_extras_file: {
    graphPattern: "?activity prov:wasDerivedFrom ?activity_extras_file .",
    requiredVariable: "activity",
    ignore: true
  },
  activity_extras_file_path: {
    graphPattern: "?activity_extras_file prov:atLocation ?activity_extras_file_path .",
    requiredVariable: "activity_extras_file"
  },
  activity_extras_file_type: {
    graphPattern: "",
    requiredVariable: "activity_extras_file_path",
    formatValue: (bindings: Bindings) => {
      if (!bindings.has("activity_extras_file_path")) {
        return null;
      }
      const filePath = bindings.get("activity_extras_file_path").value;
      const fileType = filePath.split(".").pop();
      return fileType ? fileType.toLowerCase() : null;
    }
  }
};
