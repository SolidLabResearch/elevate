(function () {
  "use strict";

  const GARMIN_EPOCH_MS = Date.UTC(1989, 11, 31);
  const SEMICIRCLES_PER_DEGREE = 2147483648 / 180;

  const BASE_TYPES = {
    enum: 0x00,
    uint8: 0x02,
    sint32: 0x85,
    uint16: 0x84,
    uint32: 0x86,
    uint32z: 0x8c,
    string: 0x07
  };

  const BASE_TYPE_SIZES = {
    [BASE_TYPES.enum]: 1,
    [BASE_TYPES.uint8]: 1,
    [BASE_TYPES.sint32]: 4,
    [BASE_TYPES.uint16]: 2,
    [BASE_TYPES.uint32]: 4,
    [BASE_TYPES.uint32z]: 4,
    [BASE_TYPES.string]: 1
  };

  const SPORTS = {
    cycling: {
      aliases: ["cycling", "ride", "bike"],
      fitSport: 2,
      subSport: 0,
      name: "Cycling",
      durationMinutes: [35, 180],
      speedMps: [5.5, 12],
      cadence: [65, 100],
      heartRate: [105, 175],
      power: [90, 320],
      temperature: [8, 30],
      gps: true,
      defaultPower: true
    },
    running: {
      aliases: ["running", "run"],
      fitSport: 1,
      subSport: 0,
      name: "Running",
      durationMinutes: [20, 95],
      speedMps: [2.4, 5.3],
      cadence: [150, 190],
      heartRate: [115, 185],
      power: [180, 420],
      temperature: [4, 26],
      gps: true,
      defaultPower: false
    },
    swimming: {
      aliases: ["swimming", "swim"],
      fitSport: 5,
      subSport: 0,
      name: "Swimming",
      durationMinutes: [15, 70],
      speedMps: [0.7, 1.6],
      cadence: [20, 42],
      heartRate: [95, 155],
      power: [0, 0],
      temperature: [24, 29],
      gps: false,
      defaultPower: false
    }
  };

  function hashSeed(seed) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index++) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createRandom(seed) {
    let state = hashSeed(seed);
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function chooseSport(requestedSport, random) {
    if (requestedSport === "random") {
      const keys = Object.keys(SPORTS);
      return SPORTS[keys[Math.floor(random() * keys.length)]];
    }

    const sport = Object.values(SPORTS).find(value => value.aliases.includes(requestedSport));
    if (!sport) {
      throw new Error(`Unsupported sport: ${requestedSport}`);
    }
    return sport;
  }

  function randomBetween(random, min, max) {
    return min + random() * (max - min);
  }

  function randomInteger(random, min, max) {
    return Math.round(randomBetween(random, min, max));
  }

  function toFitTimestamp(date) {
    return Math.floor((date.getTime() - GARMIN_EPOCH_MS) / 1000);
  }

  function toSemicircles(degrees) {
    return Math.round(degrees * SEMICIRCLES_PER_DEGREE);
  }

  function encodeAltitude(meters) {
    return clampUnsigned(Math.round((meters + 500) * 5), 0xffff);
  }

  function clampUnsigned(value, max) {
    return Math.max(0, Math.min(max, value || 0));
  }

  function field(num, type, size) {
    return { num, type, size: size || BASE_TYPE_SIZES[type] };
  }

  function createWriter(size) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;

    return {
      bytes,
      uint8(value) {
        view.setUint8(offset, clampUnsigned(Math.round(value), 0xff));
        offset += 1;
      },
      uint16(value) {
        view.setUint16(offset, clampUnsigned(Math.round(value), 0xffff), true);
        offset += 2;
      },
      uint32(value) {
        view.setUint32(offset, clampUnsigned(Math.round(value), 0xffffffff), true);
        offset += 4;
      },
      sint32(value) {
        view.setInt32(offset, Math.max(-2147483648, Math.min(2147483647, Math.round(value || 0))), true);
        offset += 4;
      },
      string(value, size) {
        const encoded = new TextEncoder().encode(String(value || ""));
        bytes.set(encoded.slice(0, size), offset);
        offset += size;
      }
    };
  }

  function writeDefinition(localMessageNumber, globalMessageNumber, fields) {
    const writer = createWriter(6 + fields.length * 3);
    writer.uint8(0x40 | localMessageNumber);
    writer.uint8(0);
    writer.uint8(0);
    writer.uint16(globalMessageNumber);
    writer.uint8(fields.length);
    fields.forEach(item => {
      writer.uint8(item.num);
      writer.uint8(item.size);
      writer.uint8(item.type);
    });
    return writer.bytes;
  }

  function writeField(writer, item, value) {
    switch (item.type) {
      case BASE_TYPES.enum:
      case BASE_TYPES.uint8:
        writer.uint8(value);
        break;
      case BASE_TYPES.uint16:
        writer.uint16(value);
        break;
      case BASE_TYPES.uint32:
      case BASE_TYPES.uint32z:
        writer.uint32(value);
        break;
      case BASE_TYPES.sint32:
        writer.sint32(value);
        break;
      case BASE_TYPES.string:
        writer.string(value, item.size);
        break;
      default:
        throw new Error(`Unsupported base type: ${item.type}`);
    }
  }

  function writeData(localMessageNumber, fields, values) {
    const writer = createWriter(1 + fields.reduce((size, item) => size + item.size, 0));
    writer.uint8(localMessageNumber);
    fields.forEach(item => writeField(writer, item, values[item.num]));
    return writer.bytes;
  }

  function concat(parts) {
    const totalLength = parts.reduce((total, part) => total + part.length, 0);
    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    parts.forEach(part => {
      bytes.set(part, offset);
      offset += part.length;
    });
    return bytes;
  }

  function calculateCrc(bytes) {
    const crcTable = [
      0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
      0x8801, 0x4400
    ];
    let crc = 0;
    for (const byte of bytes) {
      let tmp = crcTable[crc & 0x0f];
      crc = (crc >> 4) & 0x0fff;
      crc = crc ^ tmp ^ crcTable[byte & 0x0f];
      tmp = crcTable[crc & 0x0f];
      crc = (crc >> 4) & 0x0fff;
      crc = crc ^ tmp ^ crcTable[(byte >> 4) & 0x0f];
    }
    return crc;
  }

  function buildActivity(options, fileIndex) {
    const random = createRandom(`${options.seed}:${fileIndex}`);
    const sport = chooseSport(options.sport, random);
    const durationMinutes =
      options.durationMinutes || randomBetween(random, sport.durationMinutes[0], sport.durationMinutes[1]);
    const durationSeconds = Math.round(durationMinutes * 60);
    const start = options.start || new Date(Date.now() - randomInteger(random, 1, 240) * 86400 * 1000);
    const includePower = options.power === "auto" ? sport.defaultPower : options.power === "on";
    const baseLat = randomBetween(random, 45, 52);
    const baseLon = randomBetween(random, 2, 7);
    const baseAltitude = randomBetween(random, 10, 650);
    const climbAmplitude = randomBetween(random, 5, 45);
    const bearing = randomBetween(random, 0, Math.PI * 2);
    const records = [];
    let distance = 0;
    let ascent = 0;
    let descent = 0;
    let previousAltitude = baseAltitude;

    const sampleCount = Math.floor(durationSeconds / options.intervalSeconds) + 1;
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const seconds = Math.min(sampleIndex * options.intervalSeconds, durationSeconds);
      const progress = durationSeconds === 0 ? 0 : seconds / durationSeconds;
      const surge = Math.sin(progress * Math.PI * 8 + random() * 0.25) * 0.1;
      const speed = Math.max(0.2, randomBetween(random, sport.speedMps[0], sport.speedMps[1]) * (1 + surge));
      const stepDistance = sampleIndex === 0 ? 0 : speed * options.intervalSeconds;
      distance += stepDistance;

      const altitude =
        baseAltitude + Math.sin(progress * Math.PI * 4) * climbAmplitude + randomBetween(random, -0.25, 0.25);
      const elevationDelta = altitude - previousAltitude;
      if (elevationDelta > 0.5) {
        ascent += elevationDelta;
      } else if (elevationDelta < -0.5) {
        descent += Math.abs(elevationDelta);
      }
      previousAltitude = altitude;

      const angularDistance = distance / 6371000;
      const lat = baseLat + (angularDistance * Math.cos(bearing) * 180) / Math.PI;
      const lon =
        baseLon + (angularDistance * Math.sin(bearing) * 180) / (Math.PI * Math.cos((baseLat * Math.PI) / 180));

      records.push({
        timestamp: toFitTimestamp(new Date(start.getTime() + seconds * 1000)),
        positionLat: sport.gps ? toSemicircles(lat) : null,
        positionLon: sport.gps ? toSemicircles(lon) : null,
        distance,
        altitude,
        speed,
        heartRate: randomInteger(random, sport.heartRate[0], sport.heartRate[1]),
        cadence: randomInteger(random, sport.cadence[0], sport.cadence[1]),
        power: includePower ? randomInteger(random, sport.power[0], sport.power[1]) : null,
        temperature: randomInteger(random, sport.temperature[0], sport.temperature[1])
      });
    }

    const avg = fieldName => records.reduce((sum, record) => sum + record[fieldName], 0) / records.length;
    const max = fieldName => Math.max(...records.map(record => record[fieldName]));
    const powers = records.map(record => record.power).filter(value => value !== null);

    return {
      sport,
      includePower,
      startTimestamp: toFitTimestamp(start),
      endTimestamp: records[records.length - 1].timestamp,
      durationSeconds,
      serialNumber: randomInteger(random, 100000000, 999999999),
      totalDistance: distance,
      totalCalories: randomInteger(random, durationMinutes * 5, durationMinutes * 12),
      totalAscent: Math.round(ascent),
      totalDescent: Math.round(descent),
      avgSpeed: avg("speed"),
      maxSpeed: max("speed"),
      avgHeartRate: Math.round(avg("heartRate")),
      maxHeartRate: max("heartRate"),
      avgCadence: Math.round(avg("cadence")),
      maxCadence: max("cadence"),
      avgPower: powers.length ? Math.round(powers.reduce((sum, value) => sum + value, 0) / powers.length) : null,
      maxPower: powers.length ? Math.max(...powers) : null,
      records
    };
  }

  function buildFitFile(activity) {
    const fileIdFields = [
      field(0, BASE_TYPES.enum),
      field(1, BASE_TYPES.uint16),
      field(2, BASE_TYPES.uint16),
      field(3, BASE_TYPES.uint32z),
      field(4, BASE_TYPES.uint32)
    ];
    const sportFields = [field(0, BASE_TYPES.enum), field(1, BASE_TYPES.enum), field(3, BASE_TYPES.string, 16)];
    const eventFields = [field(253, BASE_TYPES.uint32), field(0, BASE_TYPES.enum), field(1, BASE_TYPES.enum)];
    const recordFields = [
      field(253, BASE_TYPES.uint32),
      ...(activity.sport.gps ? [field(0, BASE_TYPES.sint32), field(1, BASE_TYPES.sint32)] : []),
      field(5, BASE_TYPES.uint32),
      field(2, BASE_TYPES.uint16),
      field(6, BASE_TYPES.uint16),
      field(3, BASE_TYPES.uint8),
      field(4, BASE_TYPES.uint8),
      ...(activity.includePower ? [field(7, BASE_TYPES.uint16)] : []),
      field(13, BASE_TYPES.sint32)
    ];
    const lapFields = [
      field(253, BASE_TYPES.uint32),
      field(0, BASE_TYPES.enum),
      field(1, BASE_TYPES.enum),
      field(2, BASE_TYPES.uint32),
      field(7, BASE_TYPES.uint32),
      field(8, BASE_TYPES.uint32),
      field(9, BASE_TYPES.uint32),
      field(11, BASE_TYPES.uint16),
      field(13, BASE_TYPES.uint16),
      field(14, BASE_TYPES.uint16),
      field(15, BASE_TYPES.uint8),
      field(16, BASE_TYPES.uint8),
      field(17, BASE_TYPES.uint8),
      field(18, BASE_TYPES.uint8),
      ...(activity.includePower ? [field(19, BASE_TYPES.uint16), field(20, BASE_TYPES.uint16)] : []),
      field(21, BASE_TYPES.uint16),
      field(22, BASE_TYPES.uint16),
      field(25, BASE_TYPES.enum),
      field(26, BASE_TYPES.enum)
    ];
    const sessionFields = [
      field(253, BASE_TYPES.uint32),
      field(0, BASE_TYPES.enum),
      field(1, BASE_TYPES.enum),
      field(2, BASE_TYPES.uint32),
      field(5, BASE_TYPES.enum),
      field(6, BASE_TYPES.enum),
      field(7, BASE_TYPES.uint32),
      field(8, BASE_TYPES.uint32),
      field(9, BASE_TYPES.uint32),
      field(11, BASE_TYPES.uint16),
      field(14, BASE_TYPES.uint16),
      field(15, BASE_TYPES.uint16),
      field(16, BASE_TYPES.uint8),
      field(17, BASE_TYPES.uint8),
      field(18, BASE_TYPES.uint8),
      field(19, BASE_TYPES.uint8),
      ...(activity.includePower ? [field(20, BASE_TYPES.uint16), field(21, BASE_TYPES.uint16)] : []),
      field(22, BASE_TYPES.uint16),
      field(23, BASE_TYPES.uint16),
      field(25, BASE_TYPES.uint16),
      field(26, BASE_TYPES.uint16),
      field(28, BASE_TYPES.enum)
    ];
    const activityFields = [
      field(253, BASE_TYPES.uint32),
      field(0, BASE_TYPES.uint32),
      field(1, BASE_TYPES.uint16),
      field(2, BASE_TYPES.enum),
      field(3, BASE_TYPES.enum),
      field(4, BASE_TYPES.enum)
    ];

    const parts = [];
    parts.push(writeDefinition(0, 0, fileIdFields));
    parts.push(
      writeData(0, fileIdFields, { 0: 4, 1: 255, 2: 1, 3: activity.serialNumber, 4: activity.startTimestamp })
    );
    parts.push(writeDefinition(1, 12, sportFields));
    parts.push(
      writeData(1, sportFields, { 0: activity.sport.fitSport, 1: activity.sport.subSport, 3: activity.sport.name })
    );
    parts.push(writeDefinition(2, 21, eventFields));
    parts.push(writeData(2, eventFields, { 253: activity.startTimestamp, 0: 0, 1: 0 }));
    parts.push(writeDefinition(3, 20, recordFields));
    activity.records.forEach(record => {
      parts.push(
        writeData(3, recordFields, {
          253: record.timestamp,
          0: record.positionLat,
          1: record.positionLon,
          5: Math.round(record.distance * 100),
          2: encodeAltitude(record.altitude),
          6: Math.round(record.speed * 1000),
          3: record.heartRate,
          4: record.cadence,
          7: record.power,
          13: record.temperature
        })
      );
    });
    parts.push(writeData(2, eventFields, { 253: activity.endTimestamp, 0: 0, 1: 1 }));

    const lapValues = {
      253: activity.endTimestamp,
      0: 9,
      1: 1,
      2: activity.startTimestamp,
      7: activity.durationSeconds * 1000,
      8: activity.durationSeconds * 1000,
      9: Math.round(activity.totalDistance * 100),
      11: activity.totalCalories,
      13: Math.round(activity.avgSpeed * 1000),
      14: Math.round(activity.maxSpeed * 1000),
      15: activity.avgHeartRate,
      16: activity.maxHeartRate,
      17: activity.avgCadence,
      18: activity.maxCadence,
      19: activity.avgPower,
      20: activity.maxPower,
      21: activity.totalAscent,
      22: activity.totalDescent,
      25: activity.sport.fitSport,
      26: activity.sport.subSport
    };
    const sessionValues = {
      253: activity.endTimestamp,
      0: 8,
      1: 1,
      2: activity.startTimestamp,
      5: activity.sport.fitSport,
      6: activity.sport.subSport,
      7: activity.durationSeconds * 1000,
      8: activity.durationSeconds * 1000,
      9: Math.round(activity.totalDistance * 100),
      11: activity.totalCalories,
      14: Math.round(activity.avgSpeed * 1000),
      15: Math.round(activity.maxSpeed * 1000),
      16: activity.avgHeartRate,
      17: activity.maxHeartRate,
      18: activity.avgCadence,
      19: activity.maxCadence,
      20: activity.avgPower,
      21: activity.maxPower,
      22: activity.totalAscent,
      23: activity.totalDescent,
      25: 0,
      26: 1,
      28: 0
    };

    parts.push(writeDefinition(4, 19, lapFields));
    parts.push(writeData(4, lapFields, lapValues));
    parts.push(writeDefinition(5, 18, sessionFields));
    parts.push(writeData(5, sessionFields, sessionValues));
    parts.push(writeDefinition(6, 34, activityFields));
    parts.push(
      writeData(6, activityFields, {
        253: activity.endTimestamp,
        0: activity.durationSeconds * 1000,
        1: 1,
        2: 0,
        3: 26,
        4: 1
      })
    );

    const data = concat(parts);
    const header = createWriter(14);
    header.uint8(14);
    header.uint8(16);
    header.uint16(2134);
    header.uint32(data.length);
    header.string(".FIT", 4);
    new DataView(header.bytes.buffer).setUint16(12, calculateCrc(header.bytes.slice(0, 12)), true);

    const withoutFileCrc = concat([header.bytes, data]);
    const fileCrc = createWriter(2);
    fileCrc.uint16(calculateCrc(withoutFileCrc));
    return concat([withoutFileCrc, fileCrc.bytes]);
  }

  function makeFileName(activity, index, count) {
    const startDate = new Date(activity.startTimestamp * 1000 + GARMIN_EPOCH_MS).toISOString().replace(/[:.]/g, "-");
    const suffix = count === 1 ? "" : `-${String(index + 1).padStart(3, "0")}`;
    return `random-${activity.sport.name.toLowerCase()}-${startDate}${suffix}.fit`;
  }

  function normalizeOptions(options) {
    const count = Math.max(1, Math.min(100, Number.parseInt(options.count, 10) || 1));
    const intervalSeconds = Math.max(1, Number.parseInt(options.intervalSeconds, 10) || 5);
    const durationMinutes = Number.parseFloat(options.durationMinutes);
    return {
      count,
      sport: options.sport || "random",
      durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : null,
      intervalSeconds,
      seed: options.seed || String(Date.now()),
      power: options.power || "auto"
    };
  }

  function createRandomFitFiles(options) {
    const normalized = normalizeOptions(options);
    return Array.from({ length: normalized.count }, (_, index) => {
      const activity = buildActivity(normalized, index);
      const bytes = buildFitFile(activity);
      return new File([bytes], makeFileName(activity, index, normalized.count), {
        type: "application/vnd.ant.fit",
        lastModified: Date.now()
      });
    });
  }

  window.FitGenerator = {
    createRandomFitFiles,
    generateRandomFitBytes(options, index = 0) {
      const normalized = normalizeOptions({ ...options, count: 1 });
      const activity = buildActivity(normalized, index);
      return {
        name: makeFileName(activity, index, 1),
        bytes: buildFitFile(activity),
        sport: activity.sport.name,
        distance: activity.totalDistance
      };
    }
  };
})();
