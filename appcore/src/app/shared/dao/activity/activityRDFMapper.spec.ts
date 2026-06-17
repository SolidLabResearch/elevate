import { Store, Parser } from "n3";
import {
  Activity,
  ActivityFlag,
  ActivityStats,
  SlopeProfile,
  Peak,
  SlopeStats
} from "@elevate/shared/models/sync/activity.model";
import { ActivityRDFMapper } from "./activityRDFMapper";
import { AthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/athlete-settings.model";
import { AthleteSnapshot } from "@elevate/shared/models/athlete/athlete-snapshot.model";
import { Gender } from "@elevate/shared/models/athlete/gender.enum";
import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";
import { ConnectorType } from "@elevate/shared/sync/connectors/connector-type.enum";
import { ActivityFileType } from "@elevate/shared/sync/connectors/activity-file-type.enum";
import { ZoneModel } from "@elevate/shared/models/zone.model";

/** Basic deep comparison with small numeric tolerance, ignores undefined/null props. */
function deepEqualActivities(a: any, b: any, eps = 1e-6): { equal: boolean; diff?: string } {
  const isNum = (x: any) => typeof x === "number" && Number.isFinite(x);
  const isPlain = (x: any) => x && typeof x === "object" && !Array.isArray(x);
  const keys = new Set<string>([
    ...Object.keys(a ?? {}).filter(k => a?.[k] !== undefined && a?.[k] !== null),
    ...Object.keys(b ?? {}).filter(k => b?.[k] !== undefined && b?.[k] !== null)
  ]);

  for (const k of keys) {
    const va = a?.[k];
    const vb = b?.[k];

    if (isNum(va) && isNum(vb)) {
      if (Math.abs(va - vb) > eps) return { equal: false, diff: `Number mismatch at "${k}": ${va} !== ${vb}` };
      continue;
    }

    if (Array.isArray(va) || Array.isArray(vb)) {
      const aa = Array.isArray(va) ? va : [];
      const bb = Array.isArray(vb) ? vb : [];
      if (aa.length !== bb.length) return { equal: false, diff: `Array length mismatch at "${k}"` };
      for (let i = 0; i < aa.length; i++) {
        const r = deepEqualActivities(aa[i], bb[i], eps);
        if (!r.equal) return { equal: false, diff: `${k}[${i}]: ${r.diff}` };
      }
      continue;
    }

    if (isPlain(va) || isPlain(vb)) {
      const r = deepEqualActivities(va ?? {}, vb ?? {}, eps);
      if (!r.equal) return { equal: false, diff: `${k}: ${r.diff}` };
      continue;
    }

    // treat ISO date strings equal if same ms
    const maybeDate = (x: any) => (typeof x === "string" && /\d{4}-\d{2}-\d{2}T/.test(x) ? Date.parse(x) : NaN);
    const da = maybeDate(va);
    const db = maybeDate(vb);
    if (!Number.isNaN(da) && !Number.isNaN(db)) {
      if (da !== db) return { equal: false, diff: `Date mismatch at "${k}"` };
      continue;
    }

    // direct compare (ignore null/undefined asymmetry)
    if (va == null && vb == null) continue;
    if (va !== vb) return { equal: false, diff: `Value mismatch at "${k}": ${va} !== ${vb}` };
  }

  return { equal: true };
}

/**
 * Round-trip test using N3 store:
 * - calls write(activityIri, activity)
 * - parses TTL into N3 store
 * - queries it back with ActivityMapping.query()
 * - returns the retrieved Activity and a comparison result
 */
async function roundtripActivityTest(activity: Activity) {
  const baseUrl = "http://example.org";
  const activityLocation = `${baseUrl}/${activity.id}`;
  const activityIri = activityLocation + "#activity";

  const mapping = new ActivityRDFMapper();
  const ttl = mapping.write(activityLocation, activity);

  // Parse the Turtle into an N3 store
  const store = new Store();
  const parser = new Parser({ format: "text/turtle" });

  return new Promise((resolve, reject) => {
    parser.parse(ttl, (error, quad, prefixes) => {
      if (error) {
        reject(error);
        return;
      }

      if (quad) {
        store.addQuad(quad);
      } else {
        // Parsing finished, now query the store
        queryStore(store, mapping, ttl, activity, activityIri).then(resolve).catch(reject);
      }
    });
  });
}

async function queryStore(
  store: Store,
  mapping: ActivityRDFMapper,
  ttl: string,
  activity: Activity,
  activityIri: string
) {
  try {
    // Use the N3 store as the source for querying
    const results = (await mapping.query([store] as any)) as Activity[];

    if (!results || results.length === 0) {
      return { ok: false, reason: "No activities returned from query()", written: ttl };
    }

    // pick the one with the expected id (= fragment after '#')
    const id = activityIri.split("#")[0].split("/").pop();
    const retrieved = results.find(a => a.id === id) ?? results[0];

    // Compare (your queried Activity contains extra derived pieces; that’s fine)
    const cmp = deepEqualActivities(activity, retrieved);
    return {
      ok: cmp.equal,
      diff: cmp.diff,
      retrieved,
      written: ttl,
      sourceStore: store,
      activityIri
    };
  } catch (error) {
    return { ok: false, reason: `Query failed: ${error}`, written: ttl };
  }
}

describe("ActivityMapping round-trip", () => {
  it("should treat a missing activity container as an empty source", async () => {
    const mapping = new ActivityRDFMapper(
      jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found"
      }) as any
    );

    const count = await mapping.query(["http://localhost:3000/alice/activities/"], { type: "count" });

    expect(count).toBe(0);
  });

  it("should still fail for unrelated missing RDF sources", async () => {
    const mapping = new ActivityRDFMapper(
      jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found"
      }) as any
    );

    await expect(mapping.query(["http://localhost:3000/alice/profile"], { type: "count" })).rejects.toThrow(
      "Failed to load RDF source http://localhost:3000/alice/profile: 404 Not Found"
    );
  });

  it("should serialize and query back a simple activity", async () => {
    const act = new Activity();
    act.id = "test-activity"; // fragment after # in the IRI
    act.name = "Morning Run";
    act.type = ElevateSport.Run;
    act.connector = ConnectorType.SOLID;
    act.startTime = new Date("2025-08-11T06:00:00Z").toDateString();
    act.endTime = new Date("2025-08-11T07:00:00Z").toDateString();
    act.startTimestamp = Math.floor(new Date(act.startTime).getTime() / 1000);
    act.endTimestamp = Math.floor(new Date(act.endTime).getTime() / 1000);
    act.hash = "hashingz";
    act.hasPowerMeter = false;
    act.trainer = false;
    act.commute = false;
    act.manual = false;
    act.isSwimPool = false;
    act.latLngCenter = [50.8503, 4.3517]; // Brussels
    act.creationTime = new Date("2025-08-11T07:30:00Z").toDateString();
    act.lastEditTime = new Date("2025-08-11T07:30:00Z").toDateString();

    // Athlete snapshot with settings
    const athleteSettings = new AthleteSettings(
      190, // maxHr
      65, // restHr
      { default: 170, cycling: 180, running: 175 }, // lthr
      250, // cycling FTP
      300, // running FTP
      null, // swim FTP
      70 // weight
    );
    act.athleteSnapshot = new AthleteSnapshot("man" as Gender, 32, athleteSettings);

    // Add minimal stats
    act.stats = {
      cadence: null,
      calories: 2000,
      caloriesPerHour: 1000,
      elevation: null,
      elevationGain: null,
      grade: null,
      heartRate: null,
      moveRatio: 0,
      pauseTime: 0,
      power: null,
      scores: null,
      distance: 10000,
      elapsedTime: 3600,
      movingTime: 3500,
      speed: {
        avg: 2.8,
        max: 5.0,
        best20min: null,
        lowQ: 2.0,
        median: 3,
        upperQ: 5,
        stdDev: 1,
        zones: null,
        peaks: null
      },
      pace: {
        avg: 357,
        gapAvg: 357,
        max: 300,
        best20min: null,
        lowQ: 2.0,
        median: 3,
        upperQ: 5,
        stdDev: 1,
        zones: null
      }
    };

    const res: any = await roundtripActivityTest(act);

    if (!res.ok) {
      console.error("Round-trip failed:", res.diff, "\n", res);
    }
    expect(res.ok).toBe(true);
  });

  it("should serialize activity type as a local ontology concept instead of a sport-specific activity subclass", () => {
    const act = new Activity();
    act.id = "test-activity";
    act.name = "Morning Run";
    act.type = ElevateSport.Run;
    act.startTime = "2025-08-11T06:00:00Z";
    act.endTime = "2025-08-11T07:00:00Z";

    const ttl = new ActivityRDFMapper().write("http://example.org/test-activity", act);

    expect(ttl).toContain(
      "<http://example.org/test-activity#activity> activo:activityType <https://w3id.org/activity-ontology#Run> ."
    );
    expect(ttl).not.toContain("<http://example.org/test-activity#activity> a activo:Run .");
    expect(ttl).not.toContain("rdfs:subClassOf activo:Activity");
    expect(ttl).not.toContain("activo:hasPowerData");
    expect(ttl).not.toContain("activo:isWithoutAthletePerformance");
  });

  it("should serialize and query back a complete activity schema", async () => {
    const act = new Activity();
    act.id = "test-activity"; // fragment after # in the IRI
    act.name = "Morning Run";
    act.type = ElevateSport.Run;
    act.connector = ConnectorType.SOLID;
    act.startTime = "2025-08-11T06:00:00Z";
    act.endTime = "2025-08-11T07:00:00Z";
    act.startTimestamp = Math.floor(new Date(act.startTime).getTime() / 1000);
    act.endTimestamp = Math.floor(new Date(act.endTime).getTime() / 1000);
    act.hash = "hashingz";
    act.hasPowerMeter = false;
    act.trainer = false;
    act.commute = false;
    act.manual = false;
    act.isSwimPool = false;
    act.latLngCenter = [50.8503, 4.3517]; // Brussels
    act.creationTime = new Date("2025-08-11T07:30:00Z").toDateString();
    act.lastEditTime = new Date("2025-08-11T07:30:00Z").toDateString();

    // Athlete snapshot with settings
    const athleteSettings = new AthleteSettings(
      190, // maxHr
      65, // restHr
      { default: 170, cycling: 180, running: 175 }, // lthr
      250, // cycling FTP
      300, // running FTP
      null, // swim FTP
      70 // weight
    );
    act.athleteSnapshot = new AthleteSnapshot("man" as Gender, 32, athleteSettings);

    // Add minimal stats
    act.stats = {
      cadence: null,
      calories: 2000,
      caloriesPerHour: 1000,
      elevation: null,
      elevationGain: null,
      grade: null,
      heartRate: null,
      moveRatio: 0,
      pauseTime: 0,
      power: null,
      scores: null,
      distance: 10000,
      elapsedTime: 3600,
      movingTime: 3500,
      speed: {
        avg: 2.8,
        max: 5.0,
        best20min: null,
        lowQ: 2.0,
        median: 3,
        upperQ: 5,
        stdDev: 1,
        zones: null,
        peaks: null
      },
      pace: {
        avg: 357,
        gapAvg: 357,
        max: 300,
        best20min: null,
        lowQ: 2.0,
        median: 3,
        upperQ: 5,
        stdDev: 1,
        zones: null
      }
    };

    const res: any = await roundtripActivityTest(act);

    if (!res.ok) {
      console.error("Round-trip failed:", res.diff);
    }
    expect(res.ok).toBe(true);
  });

  it("should serialize and query back a complete activity schema with ALL values filled", async () => {
    const act = new Activity();

    // Base activity properties
    act.id = "complete-test-activity";
    act.name = "Complete Morning Cycling Training";
    act.type = ElevateSport.Ride;
    act.startTime = "2025-08-11T06:00:00.000Z";
    act.endTime = "2025-08-11T08:30:00.000Z";
    act.startTimestamp = Math.floor(new Date(act.startTime).getTime() / 1000);
    act.endTimestamp = Math.floor(new Date(act.endTime).getTime() / 1000);
    act.hasPowerMeter = true;
    act.trainer = false;
    act.commute = true;
    act.manual = false;

    // Activity-specific properties
    act.hash = "complete-activity-hash-12345";
    act.isSwimPool = false;
    act.connector = ConnectorType.SOLID;
    act.latLngCenter = [50.8503, 4.3517];
    act.settingsLack = false;
    act.creationTime = "2025-08-11T08:35:00.000Z";
    act.lastEditTime = "2025-08-11T08:35:00.000Z";
    act.device = "Garmin Edge 530";
    act.notes = "Great training session with interval work";
    act.autoDetectedType = false;
    act.flags = [ActivityFlag.POWER_AVG_KG_ABNORMAL, ActivityFlag.HR_AVG_ABNORMAL];

    // Athlete snapshot with complete settings
    const athleteSettings = new AthleteSettings(
      190, // maxHr
      65, // restHr
      { default: 170, cycling: 180, running: 175 }, // lthr
      250, // cycling FTP
      300, // running FTP
      150, // swim FTP
      70 // weight
    );
    act.athleteSnapshot = new AthleteSnapshot(Gender.MEN, 32, athleteSettings);

    // Complete zones
    const speedZones = [
      { from: 0, to: 20, s: 1800, percent: 20 } as ZoneModel,
      { from: 20, to: 25, s: 2700, percent: 30 } as ZoneModel,
      { from: 25, to: 30, s: 1800, percent: 20 } as ZoneModel,
      { from: 30, to: 35, s: 1350, percent: 15 } as ZoneModel,
      { from: 35, to: null, s: 1350, percent: 15 } as ZoneModel
    ];

    const powerZones = [
      { from: 0, to: 125, s: 1800, percent: 20 } as ZoneModel,
      { from: 125, to: 175, s: 2700, percent: 30 } as ZoneModel,
      { from: 175, to: 200, s: 1800, percent: 20 } as ZoneModel,
      { from: 200, to: 225, s: 1350, percent: 15 } as ZoneModel,
      { from: 225, to: null, s: 1350, percent: 15 } as ZoneModel
    ];

    const hrZones = [
      { from: 65, to: 120, s: 900, percent: 10 } as ZoneModel,
      { from: 120, to: 140, s: 1800, percent: 20 } as ZoneModel,
      { from: 140, to: 160, s: 2700, percent: 30 } as ZoneModel,
      { from: 160, to: 175, s: 2250, percent: 25 } as ZoneModel,
      { from: 175, to: null, s: 1350, percent: 15 } as ZoneModel
    ];

    const cadenceZones = [
      { from: 0, to: 70, s: 450, percent: 5 } as ZoneModel,
      { from: 70, to: 85, s: 2250, percent: 25 } as ZoneModel,
      { from: 85, to: 95, s: 3600, percent: 40 } as ZoneModel,
      { from: 95, to: 105, s: 2250, percent: 25 } as ZoneModel,
      { from: 105, to: null, s: 450, percent: 5 } as ZoneModel
    ];

    const gradeZones = [
      { from: -10, to: -2, s: 900, percent: 10 } as ZoneModel,
      { from: -2, to: 2, s: 5400, percent: 60 } as ZoneModel,
      { from: 2, to: 6, s: 1800, percent: 20 } as ZoneModel,
      { from: 6, to: null, s: 900, percent: 10 } as ZoneModel
    ];

    const elevationZones = [
      { from: 100, to: 150, s: 1800, percent: 20 } as ZoneModel,
      { from: 150, to: 200, s: 2700, percent: 30 } as ZoneModel,
      { from: 200, to: 250, s: 2250, percent: 25 } as ZoneModel,
      { from: 250, to: 300, s: 1350, percent: 15 } as ZoneModel,
      { from: 300, to: null, s: 900, percent: 10 } as ZoneModel
    ];

    // Complete peaks data
    const speedPeaks: Peak[] = [
      { range: 5, result: 52.3, start: 1200, end: 1205 },
      { range: 20, result: 47.8, start: 3600, end: 3620 },
      { range: 60, result: 42.1, start: 5400, end: 5460 },
      { range: 300, result: 38.5, start: 2700, end: 3000 },
      { range: 1200, result: 11.67, start: 1800, end: 3000 }
    ];

    const powerPeaks: Peak[] = [
      { range: 5, result: 890, start: 1200, end: 1205 },
      { range: 20, result: 420, start: 3600, end: 3620 },
      { range: 60, result: 380, start: 5400, end: 5460 },
      { range: 300, result: 310, start: 2700, end: 3000 },
      { range: 1200, result: 340, start: 1800, end: 3000 }
    ];

    const hrPeaks: Peak[] = [
      { range: 20, result: 185, start: 1200, end: 1220 },
      { range: 60, result: 178, start: 3600, end: 3660 },
      { range: 300, result: 165, start: 5400, end: 5700 },
      { range: 1200, result: 150, start: 2700, end: 3900 },
      { range: 3600, result: 140, start: 0, end: 3600 }
    ];

    const cadencePeaks: Peak[] = [
      { range: 20, result: 115, start: 1200, end: 1220 },
      { range: 60, result: 108, start: 3600, end: 3660 },
      { range: 300, result: 95, start: 5400, end: 5700 }
    ];

    // Complete slope stats
    const slopeStats: SlopeStats = {
      up: 2700,
      flat: 5400,
      down: 900,
      total: 9000
    };

    // Complete activity stats
    act.stats = {
      distance: 75000, // 75km
      elevationGain: 1200,
      elapsedTime: 9000, // 2.5 hours
      movingTime: 8400, // 2h 20min
      pauseTime: 600, // 10 minutes
      moveRatio: 0.933,
      calories: 2800,
      caloriesPerHour: 1200,

      scores: {
        stress: {
          hrss: 125,
          hrssPerHour: 53.6,
          trimp: 142,
          trimpPerHour: 60.9,
          rss: 0,
          rssPerHour: 0,
          sss: 0,
          sssPerHour: 0,
          pss: 135,
          pssPerHour: 57.9,
          trainingEffect: {
            aerobic: 3.2,
            anaerobic: 2.8
          }
        },
        efficiency: 92.5,
        powerHr: 1.68,
        runningRating: 25,
        swolf: {
          "25": 10,
          "50": 20
        }
      },

      speed: {
        avg: 8.93, // 32.1 km/h
        max: 15.28, // 55 km/h
        best20min: 11.67, // 42 km/h
        lowQ: 6.94,
        median: 8.61,
        upperQ: 10.83,
        stdDev: 2.15,
        zones: speedZones,
        peaks: speedPeaks
      },

      pace: {
        avg: 112, // 1:52 min/km
        gapAvg: 115, // 1:55 min/km (Grade Adjusted Pace)
        max: 65, // 1:05 min/km
        best20min: 103, // 1:43 min/km
        lowQ: 133,
        median: 116,
        upperQ: 100,
        stdDev: 18,
        zones: []
      },

      power: {
        avg: 285,
        avgKg: 4.07,
        weighted: 312,
        weightedKg: 4.46,
        max: 890,
        work: 2394000, // Joules
        best20min: 340,
        variabilityIndex: 1.095,
        intensityFactor: 0.854,
        lowQ: 220,
        median: 275,
        upperQ: 340,
        stdDev: 78,
        zones: powerZones,
        peaks: powerPeaks
      },

      heartRate: {
        avg: 158,
        max: 185,
        avgReserve: 74.4,
        maxReserve: 96.0,
        best20min: 150,
        best60min: 140,
        lowQ: 145,
        median: 160,
        upperQ: 170,
        stdDev: 12,
        zones: hrZones,
        peaks: hrPeaks
      },

      cadence: {
        avg: 92,
        max: 115,
        avgActive: 94,
        activeRatio: 0.978,
        activeTime: 8215,
        cycles: 12920,
        distPerCycle: 5.8,
        lowQ: 85,
        median: 93,
        upperQ: 98,
        slope: slopeStats,
        stdDev: 8,
        zones: cadenceZones,
        peaks: cadencePeaks
      },

      grade: {
        avg: 1.6,
        max: 18.5,
        min: 12.3,
        lowQ: -1.2,
        median: 0.8,
        upperQ: 3.5,
        stdDev: 4.2,
        slopeTime: slopeStats,
        slopeSpeed: slopeStats,
        slopePace: slopeStats,
        slopeDistance: slopeStats,
        slopeCadence: slopeStats,
        slopeProfile: SlopeProfile.HILLY,
        zones: gradeZones
      },

      elevation: {
        avg: 225,
        max: 350,
        min: 100,
        ascent: 1200,
        descent: 1180,
        ascentSpeed: 1.8,
        lowQ: 180,
        median: 220,
        upperQ: 280,
        stdDev: 65,
        elevationZones: elevationZones
      },

      dynamics: {
        cycling: {
          standingTime: 450,
          seatedTime: 7950,
          balance: { left: 48.5, right: 51.5 },
          pedalSmoothness: { left: 24.2, right: 26.8 },
          torqueEffectiveness: { left: 89.5, right: 91.2 }
        },
        running: {
          stanceTimeBalance: { left: 51.2, right: 48.8 },
          stanceTime: 1200,
          verticalOscillation: 10,
          verticalRatio: 20,
          avgStrideLength: 1.2
        }
      }
    } as ActivityStats;

    // Complete laps
    act.laps = [
      {
        id: 1,
        active: true,
        indexes: [0, 1800],
        distance: 15000,
        elevationGain: 240,
        elapsedTime: 1800,
        movingTime: 1780,
        avgSpeed: 8.43,
        maxSpeed: 12.5,
        avgPace: 118,
        maxPace: 80,
        avgCadence: 90,
        avgHr: 152,
        maxHr: 168,
        avgWatts: 275,
        swolf25m: 20,
        swolf50m: 30,
        calories: 560
      },
      {
        id: 2,
        active: true,
        indexes: [1800, 5400],
        distance: 30000,
        elevationGain: 480,
        elapsedTime: 3600,
        movingTime: 3550,
        avgSpeed: 8.45,
        maxSpeed: 15.28,
        avgPace: 118,
        maxPace: 65,
        avgCadence: 93,
        avgHr: 162,
        maxHr: 185,
        avgWatts: 295,
        swolf25m: 25,
        swolf50m: 30,
        calories: 1120
      },
      {
        id: 3,
        active: true,
        indexes: [5400, 9000],
        distance: 30000,
        elevationGain: 480,
        elapsedTime: 3600,
        movingTime: 3070,
        avgSpeed: 9.77,
        maxSpeed: 13.2,
        avgPace: 102,
        maxPace: 75,
        avgCadence: 94,
        avgHr: 158,
        maxHr: 175,
        avgWatts: 285,
        swolf25m: 25,
        swolf50m: 30,
        calories: 1120
      }
    ];

    // Source stats (partial)
    act.srcStats = {
      distance: 75000, // 75km
      elevationGain: 1200,
      elapsedTime: 9000, // 2.5 hours
      movingTime: 8400, // 2h 20min
      pauseTime: 600, // 10 minutes
      moveRatio: 0.933,
      calories: 2800,
      caloriesPerHour: 1200,

      scores: {
        stress: {
          hrss: 125,
          hrssPerHour: 53.6,
          trimp: 142,
          trimpPerHour: 60.9,
          rss: 0,
          rssPerHour: 0,
          sss: 0,
          sssPerHour: 0,
          pss: 135,
          pssPerHour: 57.9,
          trainingEffect: {
            aerobic: 3.2,
            anaerobic: 2.8
          }
        },
        efficiency: 92.5,
        powerHr: 1.68,
        runningRating: 25,
        swolf: {
          "25": 10,
          "50": 20
        }
      },

      speed: {
        avg: 8.93, // 32.1 km/h
        max: 15.28, // 55 km/h
        best20min: 11.67, // 42 km/h
        lowQ: 6.94,
        median: 8.61,
        upperQ: 10.83,
        stdDev: 2.15,
        zones: speedZones,
        peaks: speedPeaks
      },

      pace: {
        avg: 112, // 1:52 min/km
        gapAvg: 115, // 1:55 min/km (Grade Adjusted Pace)
        max: 65, // 1:05 min/km
        best20min: 103, // 1:43 min/km
        lowQ: 133,
        median: 116,
        upperQ: 100,
        stdDev: 18,
        zones: []
      },

      power: {
        avg: 285,
        avgKg: 4.07,
        weighted: 312,
        weightedKg: 4.46,
        max: 890,
        work: 2394000, // Joules
        best20min: 340,
        variabilityIndex: 1.095,
        intensityFactor: 0.854,
        lowQ: 220,
        median: 275,
        upperQ: 340,
        stdDev: 78,
        zones: powerZones,
        peaks: powerPeaks
      },

      heartRate: {
        avg: 158,
        max: 185,
        avgReserve: 74.4,
        maxReserve: 96.0,
        best20min: 150,
        best60min: 140,
        lowQ: 145,
        median: 160,
        upperQ: 170,
        stdDev: 12,
        zones: hrZones,
        peaks: hrPeaks
      },

      cadence: {
        avg: 92,
        max: 115,
        avgActive: 94,
        activeRatio: 0.978,
        activeTime: 8215,
        cycles: 12920,
        distPerCycle: 5.8,
        lowQ: 85,
        median: 93,
        upperQ: 98,
        slope: slopeStats,
        stdDev: 8,
        zones: cadenceZones,
        peaks: cadencePeaks
      },

      grade: {
        avg: 1.6,
        max: 18.5,
        min: 12.3,
        lowQ: -1.2,
        median: 0.8,
        upperQ: 3.5,
        stdDev: 4.2,
        slopeTime: slopeStats,
        slopeSpeed: slopeStats,
        slopePace: slopeStats,
        slopeDistance: slopeStats,
        slopeCadence: slopeStats,
        slopeProfile: SlopeProfile.HILLY,
        zones: gradeZones
      },

      elevation: {
        avg: 225,
        max: 350,
        min: 100,
        ascent: 1200,
        descent: 1180,
        ascentSpeed: 1.8,
        lowQ: 180,
        median: 220,
        upperQ: 280,
        stdDev: 65,
        elevationZones: elevationZones
      },

      dynamics: {
        cycling: {
          standingTime: 450,
          seatedTime: 7950,
          balance: { left: 48.5, right: 51.5 },
          pedalSmoothness: { left: 24.2, right: 26.8 },
          torqueEffectiveness: { left: 89.5, right: 91.2 }
        },
        running: {
          stanceTimeBalance: { left: 51.2, right: 48.8 },
          stanceTime: 1200,
          verticalOscillation: 10,
          verticalRatio: 20,
          avgStrideLength: 1.2
        }
      }
    };

    // Extras
    act.extras = {
      file: {
        path: "/uploads/activities/activity_123456789.fit",
        type: ActivityFileType.FIT
      }
    };

    const res: any = await roundtripActivityTest(act);

    if (!res.ok) {
      console.error("Round-trip failed:", res.diff);
    }
    expect(res.ok).toBe(true);
    expect(res.written).not.toContain("activo:hasSourceStats");
    expect(res.written).toContain("activo:RecordingActivity");
    expect(res.written).toContain("activo:StatsComputationActivity");
    expect(res.written).toContain("prov:wasAssociatedWith");
  });
});
