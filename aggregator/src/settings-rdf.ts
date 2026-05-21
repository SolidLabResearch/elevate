import { Parser, Store, DataFactory } from "n3";
import { AthleteModel } from "@elevate/shared/models/athlete/athlete.model";
import { DatedAthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/dated-athlete-settings.model";
import { AthleteSettings } from "@elevate/shared/models/athlete/athlete-settings/athlete-settings.model";
import { Gender } from "@elevate/shared/models/athlete/gender.enum";
import { UserLactateThreshold } from "@elevate/shared/models/athlete/athlete-settings/user-lactate-threshold.model";
import { UserSettings } from "@elevate/shared/models/user-settings/user-settings.namespace";
import { UserZonesModel } from "@elevate/shared/models/user-settings/user-zones.model";
import { BuildTarget } from "@elevate/shared/enums/build-target.enum";
import { MeasureSystem } from "@elevate/shared/enums/measure-system.enum";
import { Temperature } from "@elevate/shared/enums/temperature.enum";

const { namedNode } = DataFactory;
const ELSET = "https://solidlabresearch.github.io/elevate/settings#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

export function serializeAthleteModel(url: string, athleteModel: AthleteModel): string {
  const model = AthleteModel.asInstance(athleteModel || AthleteModel.DEFAULT_MODEL);
  const settings = model.datedAthleteSettings || AthleteModel.DEFAULT_MODEL.datedAthleteSettings;
  const athletePredicates = [
    requiredPredicate("elset:gender", model.gender || Gender.MEN),
    optionalPredicate("elset:firstName", model.firstName),
    optionalPredicate("elset:lastName", model.lastName),
    optionalPredicate("elset:birthDate", model.birthDate ? formatDate(model.birthDate) : null, "xsd:date"),
    rawPredicate(
      "elset:datedAthleteSettings",
      settings.map((_, index) => `<#dated-athlete-settings-${index}>`).join(", ")
    )
  ].filter(Boolean);
  const triples = [
    prefixes(),
    `<> a elset:AthleteSettingsDocument ;`,
    `  elset:athlete <#athlete> .`,
    ``,
    `<#athlete> a elset:Athlete ;`,
    finishPredicates(athletePredicates),
    ``,
    settings
      .map((datedSettings, index) =>
        serializeDatedAthleteSettings(
          `#dated-athlete-settings-${index}`,
          DatedAthleteSettings.asInstance(datedSettings)
        )
      )
      .join("\n\n")
  ];
  return triples.filter(line => line !== null && line !== undefined && line !== "").join("\n") + "\n";
}

export function parseAthleteModel(turtle: string, url: string): AthleteModel {
  const store = parseStore(turtle, url);
  const athlete = iri(url, "#athlete");
  const settingsIris = store.getObjects(namedNode(athlete), namedNode(`${ELSET}datedAthleteSettings`), null);
  const datedSettings = settingsIris.length
    ? settingsIris.map(term => parseDatedAthleteSettings(store, term.value))
    : AthleteModel.DEFAULT_MODEL.datedAthleteSettings;

  return new AthleteModel(
    (literal(store, athlete, "gender") as Gender) || Gender.MEN,
    datedSettings,
    literal(store, athlete, "firstName"),
    literal(store, athlete, "lastName"),
    literal(store, athlete, "birthDate") ? new Date(literal(store, athlete, "birthDate")) : null,
    null,
    []
  );
}

export function serializeUserSettings(url: string, userSettings: UserSettings.BaseUserSettings): string {
  const settings = userSettings || UserSettings.DesktopUserSettings.DEFAULT_MODEL;
  const zones = settings.zones || UserZonesModel.DEFAULT_MODEL;
  const zoneKeys = Object.keys(UserZonesModel.DEFAULT_MODEL);
  return (
    prefixes() +
    `
<> a elset:UserSettingsDocument ;
  elset:userSettings <#user-settings> .

<#user-settings> a elset:UserSettings ;
  elset:buildTarget ${lit(String(settings.buildTarget ?? BuildTarget.DESKTOP), "xsd:integer")} ;
  elset:systemUnit ${lit(settings.systemUnit || MeasureSystem.METRIC)} ;
  elset:temperatureUnit ${lit(settings.temperatureUnit || Temperature.CELSIUS)} ;
  elset:disableMissingStressScoresWarning ${lit(!!settings.disableMissingStressScoresWarning, "xsd:boolean")} ;
  elset:disableActivitiesNeedRecalculationWarning ${lit(
    !!settings.disableActivitiesNeedRecalculationWarning,
    "xsd:boolean"
  )} ;
  ${zoneKeys.map(key => `elset:zoneSet ${serializeZoneSet(key, zones[key])}`).join(" ;\n  ")} .
`
  );
}

export function parseUserSettings(turtle: string, url: string): UserSettings.BaseUserSettings {
  const store = parseStore(turtle, url);
  const subject = iri(url, "#user-settings");
  const zones = { ...UserZonesModel.DEFAULT_MODEL };
  for (const zoneSet of store.getObjects(namedNode(subject), namedNode(`${ELSET}zoneSet`), null)) {
    const key = literal(store, zoneSet.value, "zoneKey");
    const values = literal(store, zoneSet.value, "zoneValues");
    if (key && values) {
      zones[key] = parseNumberList(values);
    }
  }

  return {
    ...UserSettings.DesktopUserSettings.DEFAULT_MODEL,
    buildTarget: Number(literal(store, subject, "buildTarget") || BuildTarget.DESKTOP),
    systemUnit: (literal(store, subject, "systemUnit") as MeasureSystem) || MeasureSystem.METRIC,
    temperatureUnit: (literal(store, subject, "temperatureUnit") as Temperature) || Temperature.CELSIUS,
    disableMissingStressScoresWarning: literal(store, subject, "disableMissingStressScoresWarning") === "true",
    disableActivitiesNeedRecalculationWarning:
      literal(store, subject, "disableActivitiesNeedRecalculationWarning") === "true",
    zones: zones as UserZonesModel
  };
}

function serializeDatedAthleteSettings(fragment: string, settings: DatedAthleteSettings): string {
  const predicates = [
    optionalPredicate("elset:since", settings.since, "xsd:date"),
    requiredPredicate("elset:maxHr", settings.maxHr, "xsd:double"),
    requiredPredicate("elset:restHr", settings.restHr, "xsd:double"),
    optionalPredicate("elset:lthrDefault", settings.lthr?.default, "xsd:double"),
    optionalPredicate("elset:lthrCycling", settings.lthr?.cycling, "xsd:double"),
    optionalPredicate("elset:lthrRunning", settings.lthr?.running, "xsd:double"),
    optionalPredicate("elset:cyclingFtp", settings.cyclingFtp, "xsd:double"),
    optionalPredicate("elset:runningFtp", settings.runningFtp, "xsd:double"),
    optionalPredicate("elset:swimFtp", settings.swimFtp, "xsd:double"),
    requiredPredicate("elset:weight", settings.weight, "xsd:double")
  ].filter(Boolean);

  return `<${fragment}> a elset:DatedAthleteSettings ;\n${finishPredicates(predicates)}`;
}

function parseDatedAthleteSettings(store: Store, subject: string): DatedAthleteSettings {
  return new DatedAthleteSettings(
    literal(store, subject, "since"),
    new AthleteSettings(
      numberLiteral(store, subject, "maxHr", AthleteSettings.DEFAULT_MAX_HR),
      numberLiteral(store, subject, "restHr", AthleteSettings.DEFAULT_REST_HR),
      {
        default: nullableNumberLiteral(store, subject, "lthrDefault"),
        cycling: nullableNumberLiteral(store, subject, "lthrCycling"),
        running: nullableNumberLiteral(store, subject, "lthrRunning")
      } as UserLactateThreshold,
      nullableNumberLiteral(store, subject, "cyclingFtp"),
      nullableNumberLiteral(store, subject, "runningFtp"),
      nullableNumberLiteral(store, subject, "swimFtp"),
      numberLiteral(store, subject, "weight", AthleteSettings.DEFAULT_WEIGHT)
    )
  );
}

function serializeZoneSet(key: string, values: number[]): string {
  const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `[ a elset:ZoneSet ; elset:zoneKey ${lit(key)} ; elset:zoneValues ${lit(
    (values || []).join(" ")
  )} ; elset:zoneId ${lit(safeKey)} ]`;
}

function optionalPredicate(
  predicate: string,
  value: string | number | boolean | null,
  datatype?: string
): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return requiredPredicate(predicate, value, datatype);
}

function requiredPredicate(predicate: string, value: string | number | boolean | null, datatype?: string): string {
  return `  ${predicate} ${lit(value, datatype)}`;
}

function rawPredicate(predicate: string, value: string): string {
  return `  ${predicate} ${value}`;
}

function finishPredicates(predicates: string[]): string {
  return predicates
    .map((predicate, index) => `${predicate}${index === predicates.length - 1 ? " ." : " ;"}`)
    .join("\n");
}

function lit(value: string | number | boolean | null, datatype?: string): string {
  if (value === null || value === undefined) {
    return '""';
  }
  if (datatype) {
    return `"${String(value).replace(/"/g, '\\"')}"^^${datatype}`;
  }
  if (typeof value === "boolean") {
    return `"${value}"^^xsd:boolean`;
  }
  if (typeof value === "number") {
    return `"${value}"^^xsd:double`;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function literal(store: Store, subject: string, predicate: string): string | null {
  return store.getObjects(namedNode(subject), namedNode(`${ELSET}${predicate}`), null)[0]?.value || null;
}

function numberLiteral(store: Store, subject: string, predicate: string, fallback: number): number {
  const value = nullableNumberLiteral(store, subject, predicate);
  return Number.isFinite(value) ? value : fallback;
}

function nullableNumberLiteral(store: Store, subject: string, predicate: string): number | null {
  const value = literal(store, subject, predicate);
  if (value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberList(value: string): number[] {
  return value
    .split(/\s+/u)
    .map(number => Number(number))
    .filter(number => Number.isFinite(number));
}

function parseStore(turtle: string, baseIRI: string): Store {
  const parser = new Parser({ baseIRI });
  const store = new Store();
  store.addQuads(parser.parse(turtle));
  return store;
}

function iri(base: string, fragment: string): string {
  return new URL(fragment, base).toString();
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function prefixes(): string {
  return `@prefix elset: <${ELSET}> .
@prefix rdf: <${RDF}> .
@prefix xsd: <${XSD}> .

`;
}
