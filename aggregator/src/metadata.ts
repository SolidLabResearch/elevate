import { config } from "./config";
import { AggregatorInstance } from "./types";
import { store } from "./store";

const AGGR = "https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#";
const FNO = "https://w3id.org/function/ontology#";
const FNOC = "https://fno.io/vocabulary/composition/0.1.0/";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const PROV = "http://www.w3.org/ns/prov#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const TRANS = `${config.baseUrl}/transformations#`;

export function serverDescriptionJson(): unknown {
  return {
    "@context": {
      aggr: AGGR,
      authorization_code: "aggr:AuthorizationCodeFlow",
      management_endpoint: { "@id": "aggr:registrationEndpoint", "@type": "@id" },
      supported_management_flows: { "@id": "aggr:supportedRegistrationType", "@type": "@vocab" },
      supported_management_request_formats: "aggr:registrationRequestFormatSupported",
      version: "aggr:specVersion",
      client_identifier: { "@id": "aggr:clientIdentifier", "@type": "@id" },
      transformation_catalog: { "@id": "aggr:transformationCatalog", "@type": "@id" }
    },
    "@id": `${config.baseUrl}/`,
    "@type": "aggr:AggregatorServer",
    management_endpoint: `${config.baseUrl}/registration`,
    supported_management_flows: ["authorization_code"],
    supported_management_request_formats: ["application/json"],
    version: "0.1.0",
    client_identifier: `${config.baseUrl}/client.jsonld`,
    transformation_catalog: `${config.baseUrl}/transformations`
  };
}

export function clientIdDocument(): unknown {
  const redirectUris = [
    "http://localhost:4200/",
    "http://localhost:4200/app/index.html",
    "http://127.0.0.1:4200/",
    "http://127.0.0.1:4200/app/index.html",
    "http://127.0.0.1:53682/solid-auth-callback",
    "https://solidlabresearch.github.io/elevate/",
    "https://solidlabresearch.github.io/elevate/index.html",
    "https://solidlabresearch.github.io/elevate/app/index.html"
  ];
  return {
    "@context": "https://www.w3.org/ns/solid/oidc-context.jsonld",
    client_id: `${config.baseUrl}/client.jsonld`,
    client_name: "Elevate FIT to RDF Aggregator",
    redirect_uris: redirectUris,
    post_logout_redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid webid offline_access"
  };
}

export function transformationCatalogTurtle(instance?: AggregatorInstance): string {
  const catalogUrl = instance ? `${instance.url}transformations` : `${config.baseUrl}/transformations`;
  return (
    prefixes() +
    `
<${catalogUrl}>
  a aggr:TransformationCatalog ;
  dct:title "Elevate aggregator transformations" ;
  aggr:hasTransformation <${TRANS}fit-gpx-to-rdf> .

<${TRANS}fit-gpx-to-rdf>
  a fno:Function ;
  fno:name "FIT/GPX/TCX to Elevate activo RDF"^^xsd:string ;
  dct:description "Parses activity files with Elevate's sports-lib pipeline, computes Elevate statistics, and stores the current activo RDF representation in the Solid Pod."^^xsd:string ;
  fno:expects ( <${TRANS}source> <${TRANS}athlete-settings> <${TRANS}user-settings> ) ;
  fno:returns ( <${TRANS}activity-rdf-output> ) .

<${TRANS}source>
  a fno:Parameter ;
  fno:predicate <${TRANS}source> ;
  fno:type xsd:anyURI ;
  dct:format <http://www.iana.org/assignments/media-types/application/octet-stream> ;
  fno:required "true"^^xsd:boolean .

<${TRANS}athlete-settings>
  a fno:Parameter ;
  fno:predicate <${TRANS}athleteSettings> ;
  fno:type xsd:anyURI ;
  dct:format <http://www.iana.org/assignments/media-types/application/json> ;
  fno:required "false"^^xsd:boolean .

<${TRANS}user-settings>
  a fno:Parameter ;
  fno:predicate <${TRANS}userSettings> ;
  fno:type xsd:anyURI ;
  dct:format <http://www.iana.org/assignments/media-types/application/json> ;
  fno:required "false"^^xsd:boolean .

<${TRANS}activity-rdf-output>
  a fno:Output ;
  fno:type dcat:Dataset ;
  fno:predicate <${TRANS}activityRdf> ;
  dct:format <http://www.w3.org/ns/formats/Turtle> ;
  dct:conformsTo <https://w3id.org/activity-ontology#> .
`
  );
}

export function aggregatorDescriptionJson(instance: AggregatorInstance): unknown {
  return {
    "@context": {
      id: "@id",
      aggr: AGGR,
      xsd: XSD,
      created_at: { "@id": "aggr:createdAt", "@type": "xsd:dateTime" },
      login_status: { "@id": "aggr:loginStatus", "@type": "xsd:boolean" },
      token_expiry: { "@id": "aggr:tokenExpiry", "@type": "xsd:dateTime" },
      transformation_catalog: { "@id": "aggr:transformationsEndpoint", "@type": "@id" },
      service_collection_endpoint: { "@id": "aggr:serviceCollectionEndpoint", "@type": "@id" }
    },
    id: instance.url,
    "@type": "aggr:Aggregator",
    created_at: instance.createdAt,
    login_status: Boolean(instance.tokenSet.accessToken),
    token_expiry: instance.tokenSet.expiresAt ? new Date(instance.tokenSet.expiresAt).toISOString() : null,
    transformation_catalog: `${instance.url}transformations`,
    service_collection_endpoint: `${instance.url}services`,
    source_container: instance.sourceContainer,
    output_container: instance.outputContainer,
    athlete_settings: instance.athleteSettingsUrl,
    user_settings: instance.userSettingsUrl,
    webid: instance.webId
  };
}

export function serviceCollectionTurtle(instance: AggregatorInstance): string {
  return (
    prefixes() +
    `
<${instance.url}services>
  a aggr:ServiceCollection ;
  aggr:hasService <${instance.url}services/fit-gpx-to-rdf/> .
`
  );
}

export function serviceDescriptionTurtle(instance: AggregatorInstance): string {
  const service = `${instance.url}services/fit-gpx-to-rdf/`;
  const outputUrl = serviceOutputUrl(instance);
  const provenanceTriple = instance.lastExecution ? `  aggr:provenanceLog <${service}provenance> ;\n` : "";
  return (
    prefixes() +
    `
<${service}>
  a aggr:Service, dcat:DataService, prov:SoftwareAgent ;
  aggr:status "running" ;
  aggr:createdAt "${instance.createdAt}"^^xsd:dateTime ;
  aggr:performs <${TRANS}fit-gpx-to-rdf> ;
  dct:conformsTo <${AGGR}> ;
${provenanceTriple}  dcat:servesDataset <${service}dataset> .

<${service}dataset>
  a dcat:Dataset ;
  aggr:forOutput <${TRANS}activity-rdf-output> ;
  dcat:distribution <${service}distribution> .

<${service}distribution>
  a dcat:Distribution ;
  dcat:mediaType <http://www.iana.org/assignments/media-types/text/turtle> ;
  dcat:accessURL <${outputUrl}> ;
  dcat:downloadURL <${outputUrl}> ;
  dcat:accessService <${service}> .
`
  );
}

export function provenanceTurtle(instance: AggregatorInstance): string {
  const service = `${instance.url}services/fit-gpx-to-rdf/`;
  const execution = instance.lastExecution;
  if (!execution) {
    return (
      prefixes() +
      `
<${service}provenance>
  a aggr:ProvenanceLog .
`
    );
  }

  return (
    prefixes() +
    `
<${service}provenance>
  a aggr:ProvenanceLog ;
  aggr:hasActivity <${service}provenance#${execution.id}> .

<${service}provenance#${execution.id}>
  a fno:Execution, prov:Activity ;
  fno:executes <${TRANS}fit-gpx-to-rdf> ;
  <${TRANS}source> <${execution.source}> ;
  <${TRANS}activityRdf> <${execution.output}> ;
  prov:associatedWith <${service}> ;
  prov:startedAtTime "${execution.startedAt}"^^xsd:dateTime${
      execution.endedAt ? ` ;\n  prov:endedAtTime "${execution.endedAt}"^^xsd:dateTime` : ""
    } .

<${execution.output}#activity>
  a dcat:Dataset, prov:Entity ;
  prov:wasGeneratedBy <${service}provenance#${execution.id}> ;
  prov:wasDerivedFrom <${execution.source}> .
`
  );
}

export function listAggregators(): string[] {
  return Array.from(store.instances.values()).map(instance => instance.url);
}

export function serviceOutputUrl(instance: AggregatorInstance): string {
  return instance.lastExecution?.output || instance.outputContainer;
}

function prefixes(): string {
  return `@prefix aggr: <${AGGR}> .
@prefix dcat: <${DCAT}> .
@prefix dct: <${DCT}> .
@prefix fno: <${FNO}> .
@prefix fnoc: <${FNOC}> .
@prefix prov: <${PROV}> .
@prefix xsd: <${XSD}> .

`;
}
