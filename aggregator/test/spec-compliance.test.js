const assert = require("assert");
const http = require("http");
const { Parser, Store, DataFactory } = require("n3");

process.env.AGGREGATOR_BASE_URL = "https://aggregator.example";

require("reflect-metadata");
require("../dist/aggregator/src/register-paths");

const {
  aggregatorDescriptionJson,
  provenanceTurtle,
  serverDescriptionJson,
  serviceCollectionTurtle,
  serviceDescriptionTurtle,
  transformationCatalogTurtle
} = require("../dist/aggregator/src/metadata");
const {
  deleteAuthorizationServerClientRegistrations,
  deleteInstanceResourceRegistrations,
  registerInstanceResources
} = require("../dist/aggregator/src/authorization-server");
const { ensureWebhookSubscriptions } = require("../dist/aggregator/src/poller");
const { createAggregatorServer } = require("../dist/aggregator/src/server");
const { store } = require("../dist/aggregator/src/store");

const { namedNode } = DataFactory;

const AGGR = "https://spec.knows.idlab.ugent.be/aggregator-protocol/latest/#";
const DCAT = "http://www.w3.org/ns/dcat#";
const DCT = "http://purl.org/dc/terms/";
const FNO = "https://w3id.org/function/ontology#";
const PROV = "http://www.w3.org/ns/prov#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const TRANS = "https://aggregator.example/transformations#";

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function instance(overrides = {}) {
  return {
    id: "agg-1",
    url: "https://aggregator.example/aggregators/agg-1/",
    createdAt: "2026-05-16T10:00:00.000Z",
    issuer: "https://issuer.example/",
    authorizationServer: "https://as.example/",
    authorizationServerClient: null,
    webId: "https://user.example/#me",
    storageRoot: "https://pod.example/",
    sourceContainer: "https://pod.example/source/",
    outputContainer: "https://pod.example/output/activity.ttl",
    athleteSettingsUrl: "https://pod.example/settings/athlete.json",
    userSettingsUrl: "https://pod.example/settings/user.json",
    tokenSet: {
      accessToken: "token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    },
    processedSources: {},
    settingsSignature: null,
    webhookSecret: "secret",
    webhookSubscriptions: {},
    resourceRegistrations: {},
    lastExecution: null,
    ...overrides
  };
}

function parseTurtle(turtle) {
  return new Store(new Parser({ format: "text/turtle" }).parse(turtle));
}

function objects(model, subject, predicate) {
  return model.getObjects(namedNode(subject), namedNode(predicate), null).map(term => term.value);
}

function has(model, subject, predicate, object) {
  return model.countQuads(namedNode(subject), namedNode(predicate), namedNode(object), null) > 0;
}

function assertAbsoluteUrl(value, field) {
  assert.doesNotThrow(() => new URL(value), `${field} must be an absolute URL`);
}

test("server description exposes required discovery fields", () => {
  const description = serverDescriptionJson();

  assert.strictEqual(description["@type"], "aggr:AggregatorServer");
  assertAbsoluteUrl(description.management_endpoint, "management_endpoint");
  assertAbsoluteUrl(description.client_identifier, "client_identifier");
  assertAbsoluteUrl(description.transformation_catalog, "transformation_catalog");
  assert.deepStrictEqual(description.supported_management_flows, ["authorization_code"]);
  assert(description.supported_management_request_formats.includes("application/json"));
  assert.match(description.version, /^\d+\.\d+\.\d+/u);
});

test("server transformation catalog advertises spec-compliant FnO resources", () => {
  const model = parseTurtle(transformationCatalogTurtle());
  const catalog = "https://aggregator.example/transformations";
  const transformation = `${TRANS}fit-gpx-to-rdf`;
  const output = `${TRANS}activity-rdf-output`;

  assert(has(model, catalog, `${RDF}type`, `${AGGR}TransformationCatalog`));
  assert(has(model, catalog, `${AGGR}hasTransformation`, transformation));
  assert(has(model, transformation, `${RDF}type`, `${FNO}Function`));
  assert(has(model, `${TRANS}source`, `${RDF}type`, `${FNO}Parameter`));
  assert(has(model, `${TRANS}source`, `${FNO}predicate`, `${TRANS}source`));
  assert(has(model, output, `${RDF}type`, `${FNO}Output`));
  assert(has(model, output, `${FNO}type`, `${DCAT}Dataset`));
  assert(has(model, output, `${FNO}predicate`, `${TRANS}activityRdf`));
});

test("aggregator description exposes required instance metadata", () => {
  const description = aggregatorDescriptionJson(instance());

  assert.strictEqual(description["@type"], "aggr:Aggregator");
  assertAbsoluteUrl(description.id, "id");
  assert.strictEqual(description.created_at, "2026-05-16T10:00:00.000Z");
  assert.strictEqual(description.login_status, true);
  assertAbsoluteUrl(description.transformation_catalog, "transformation_catalog");
  assertAbsoluteUrl(description.service_collection_endpoint, "service_collection_endpoint");
});

test("service collection lists service description endpoints", () => {
  const sample = instance();
  const model = parseTurtle(serviceCollectionTurtle(sample));
  const collection = `${sample.url}services`;
  const service = `${sample.url}services/fit-gpx-to-rdf/`;

  assert(has(model, collection, `${RDF}type`, `${AGGR}ServiceCollection`));
  assert(has(model, collection, `${AGGR}hasService`, service));
});

test("service description links service, dataset, distribution, and pod output resource", () => {
  const sample = instance({
    outputContainer: "https://pod.example/activities/",
    lastExecution: {
      id: "exec-1",
      source: "https://pod.example/source/activity.fit",
      output: "https://pod.example/activities/activity-metrics-morning-ride-abc123.ttl",
      startedAt: "2026-05-16T10:01:00.000Z",
      endedAt: "2026-05-16T10:01:05.000Z",
      status: "success"
    }
  });
  const model = parseTurtle(serviceDescriptionTurtle(sample));
  const service = `${sample.url}services/fit-gpx-to-rdf/`;
  const dataset = `${service}dataset`;
  const distribution = `${service}distribution`;
  const accessUrls = objects(model, distribution, `${DCAT}accessURL`);

  assert(has(model, service, `${RDF}type`, `${AGGR}Service`));
  assert(has(model, service, `${RDF}type`, `${DCAT}DataService`));
  assert(has(model, service, `${RDF}type`, `${PROV}SoftwareAgent`));
  assert(has(model, service, `${AGGR}performs`, `${TRANS}fit-gpx-to-rdf`));
  assert(has(model, service, `${DCT}conformsTo`, AGGR));
  assert(has(model, service, `${DCAT}servesDataset`, dataset));
  assert(has(model, dataset, `${RDF}type`, `${DCAT}Dataset`));
  assert(has(model, dataset, `${AGGR}forOutput`, `${TRANS}activity-rdf-output`));
  assert(has(model, dataset, `${DCAT}distribution`, distribution));
  assert(has(model, distribution, `${RDF}type`, `${DCAT}Distribution`));
  assert(has(model, distribution, `${DCAT}accessService`, service));
  assert.deepStrictEqual(accessUrls, [sample.lastExecution.output]);
});

test("service does not advertise a provenance log until execution provenance exists", () => {
  const sample = instance();
  const model = parseTurtle(serviceDescriptionTurtle(sample));
  const service = `${sample.url}services/fit-gpx-to-rdf/`;

  assert.deepStrictEqual(objects(model, service, `${AGGR}provenanceLog`), []);
});

test("execution provenance includes the required activity and generated dataset links", () => {
  const sample = instance({
    lastExecution: {
      id: "exec-1",
      source: "https://pod.example/source/activity.fit",
      output: "https://pod.example/output/activity.ttl",
      startedAt: "2026-05-16T10:01:00.000Z",
      endedAt: "2026-05-16T10:01:05.000Z",
      status: "success"
    }
  });
  const service = `${sample.url}services/fit-gpx-to-rdf/`;
  const log = `${service}provenance`;
  const execution = `${log}#exec-1`;
  const generatedDataset = `${sample.lastExecution.output}#activity`;
  const serviceModel = parseTurtle(serviceDescriptionTurtle(sample));
  const provenanceModel = parseTurtle(provenanceTurtle(sample));

  assert(has(serviceModel, service, `${AGGR}provenanceLog`, log));
  assert(has(provenanceModel, log, `${RDF}type`, `${AGGR}ProvenanceLog`));
  assert(has(provenanceModel, log, `${AGGR}hasActivity`, execution));
  assert(has(provenanceModel, execution, `${RDF}type`, `${FNO}Execution`));
  assert(has(provenanceModel, execution, `${RDF}type`, `${PROV}Activity`));
  assert(has(provenanceModel, execution, `${FNO}executes`, `${TRANS}fit-gpx-to-rdf`));
  assert(has(provenanceModel, execution, `${PROV}associatedWith`, service));
  assert(has(provenanceModel, generatedDataset, `${RDF}type`, `${DCAT}Dataset`));
  assert(has(provenanceModel, generatedDataset, `${RDF}type`, `${PROV}Entity`));
  assert(has(provenanceModel, generatedDataset, `${PROV}wasGeneratedBy`, execution));
});

test("service collection HTTP responses expose ETag and Accept-Post", async () => {
  const { server, port } = await startServerWithInstance();
  try {
    const head = await request(port, "HEAD", "/aggregators/http-agg/services");
    const get = await request(port, "GET", "/aggregators/http-agg/services");

    assert.strictEqual(head.status, 200);
    assert.strictEqual(get.status, 200);
    assert(head.headers.etag);
    assert.strictEqual(get.headers.etag, head.headers.etag);
    assert.strictEqual(get.headers["accept-post"], "text/turtle");
    assert.strictEqual(head.body, "");
  } finally {
    await closeServer(server);
  }
});

test("service output endpoint includes aggr:fromService Link header", async () => {
  const { server, port } = await startServerWithInstance({
    outputContainer: "https://pod.example/activities/",
    lastExecution: {
      id: "exec-1",
      source: "https://pod.example/source/activity.fit",
      output: "https://pod.example/activities/activity-metrics-morning-ride-abc123.ttl",
      startedAt: "2026-05-16T10:01:00.000Z",
      endedAt: "2026-05-16T10:01:05.000Z",
      status: "success"
    }
  });
  try {
    const response = await request(port, "GET", "/aggregators/http-agg/services/fit-gpx-to-rdf/output");

    assert.strictEqual(response.status, 302);
    assert.strictEqual(
      response.headers.location,
      "https://pod.example/activities/activity-metrics-morning-ride-abc123.ttl"
    );
    assert.match(
      response.headers.link,
      /rel="https:\/\/spec\.knows\.idlab\.ugent\.be\/aggregator-protocol\/latest\/#fromService"/u
    );
  } finally {
    await closeServer(server);
  }
});

test("instance creation registers collection, service, and output resources", async () => {
  const as = await startAuthorizationServer();
  const sample = instance({
    authorizationServer: `http://127.0.0.1:${as.port}`,
    tokenSet: {
      accessToken: "resource-owner-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    }
  });
  try {
    await registerInstanceResources(sample);

    const registrations = as.requests.filter(item => item.method === "POST" && item.url === "/resource-registration");
    assert.strictEqual(registrations.length, 3);
    assert.strictEqual(as.requests.filter(item => item.method === "POST" && item.url === "/register").length, 1);
    assert.strictEqual(as.requests.filter(item => item.method === "POST" && item.url === "/token").length, 1);
    assert(registrations.every(item => item.authorization === "Bearer pat-token"));

    const byName = new Map(registrations.map(item => [item.body.name, item.body]));
    assert.deepStrictEqual(byName.get(`${sample.url}services`).resource_scopes, [
      "urn:knows:uma:scopes:read",
      "urn:knows:uma:scopes:create"
    ]);
    assert.deepStrictEqual(byName.get(`${sample.url}services/fit-gpx-to-rdf/`).resource_scopes, [
      "urn:knows:uma:scopes:read",
      "urn:knows:uma:scopes:delete"
    ]);
    assert.deepStrictEqual(
      byName.get(`${sample.url}services/fit-gpx-to-rdf/`).resource_relations["@reverse"][
        "http://www.w3.org/ns/ldp#contains"
      ],
      ["asset-3"]
    );
    assert.deepStrictEqual(byName.get(`${sample.url}services/fit-gpx-to-rdf/output`).resource_scopes, [
      "urn:knows:uma:scopes:read"
    ]);

    await deleteInstanceResourceRegistrations(sample);
    assert.strictEqual(as.requests.filter(item => item.method === "DELETE").length, 3);
  } finally {
    await closeServer(as.server);
  }
});

test("authorization server client credentials are reused across instances", async () => {
  const as = await startAuthorizationServer();
  const first = instance({
    authorizationServer: `http://127.0.0.1:${as.port}`,
    tokenSet: {
      accessToken: "resource-owner-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    }
  });
  const second = instance({
    id: "agg-2",
    url: "https://aggregator.example/aggregators/agg-2/",
    authorizationServer: `http://127.0.0.1:${as.port}`,
    tokenSet: {
      accessToken: "resource-owner-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    }
  });
  try {
    await registerInstanceResources(first);
    await registerInstanceResources(second);

    assert.strictEqual(as.requests.filter(item => item.method === "POST" && item.url === "/register").length, 1);
  } finally {
    await closeServer(as.server);
  }
});

test("authorization server client registrations are deleted during shutdown cleanup", async () => {
  const as = await startAuthorizationServer();
  const sample = instance({
    authorizationServer: `http://127.0.0.1:${as.port}`,
    tokenSet: {
      accessToken: "resource-owner-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    }
  });
  try {
    await registerInstanceResources(sample);
    await deleteInstanceResourceRegistrations(sample);
    await deleteAuthorizationServerClientRegistrations();

    assert.strictEqual(
      as.requests.filter(item => item.method === "DELETE" && item.url === "/register/rs-client").length,
      1
    );
  } finally {
    await closeServer(as.server);
  }
});

test("service deployment registers service resources with the authorization server", async () => {
  const as = await startAuthorizationServer();
  const { server, port } = await startServerWithInstance({
    authorizationServer: `http://127.0.0.1:${as.port}`,
    tokenSet: {
      accessToken: "resource-owner-token",
      idToken: "id-token",
      refreshToken: "refresh-token",
      expiresAt: Date.parse("2026-05-16T11:00:00.000Z")
    },
    resourceRegistrations: {
      "service-collection": "collection-asset"
    }
  });
  try {
    const response = await request(port, "POST", "/aggregators/http-agg/services");

    assert.strictEqual(response.status, 201);
    const registrations = as.requests.filter(item => item.method === "POST" && item.url === "/resource-registration");
    assert.strictEqual(registrations.length, 2);
    assert.strictEqual(as.requests.filter(item => item.method === "POST" && item.url === "/register").length, 1);
    assert.strictEqual(as.requests.filter(item => item.method === "POST" && item.url === "/token").length, 1);
    assert(registrations.every(item => item.authorization === "Bearer pat-token"));

    const byName = new Map(registrations.map(item => [item.body.name, item.body]));
    const service = `http://127.0.0.1:${port}/aggregators/http-agg/services/fit-gpx-to-rdf/`;
    assert.deepStrictEqual(byName.get(service).resource_scopes, [
      "urn:knows:uma:scopes:read",
      "urn:knows:uma:scopes:delete"
    ]);
    assert.deepStrictEqual(byName.get(`${service}output`).resource_scopes, ["urn:knows:uma:scopes:read"]);
  } finally {
    await closeServer(server);
    await closeServer(as.server);
  }
});

test("webhook setup subscribes to source and settings resources", async () => {
  const pod = await startWebhookPodServer();
  const base = `http://127.0.0.1:${pod.port}`;
  const sample = instance({
    sourceContainer: `${base}/source/`,
    athleteSettingsUrl: `${base}/settings/athlete.ttl`,
    userSettingsUrl: `${base}/settings/user.ttl`
  });

  try {
    await ensureWebhookSubscriptions(sample);

    assert.deepStrictEqual(
      pod.subscriptions.map(subscription => subscription.topic).sort(),
      [sample.athleteSettingsUrl, sample.sourceContainer, sample.userSettingsUrl].sort()
    );
    assert.deepStrictEqual(Object.keys(sample.webhookSubscriptions).sort(), [
      "athlete-settings",
      "source",
      "user-settings"
    ]);
    assert.strictEqual(sample.webhookSubscriptions["athlete-settings"].topic, sample.athleteSettingsUrl);
    assert.strictEqual(sample.webhookSubscriptions["user-settings"].topic, sample.userSettingsUrl);
    assert.match(
      sample.webhookSubscriptions["athlete-settings"].sendTo,
      /^https:\/\/aggregator\.example\/webhooks\/agg-1\/athlete-settings\/secret$/u
    );
    assert.match(
      sample.webhookSubscriptions["user-settings"].sendTo,
      /^https:\/\/aggregator\.example\/webhooks\/agg-1\/user-settings\/secret$/u
    );
  } finally {
    await closeServer(pod.server);
  }
});

async function startServerWithInstance(overrides = {}) {
  store.instances.clear();

  const server = createAggregatorServer();
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });

  store.instances.set(
    "http-agg",
    instance({
      id: "http-agg",
      url: `http://127.0.0.1:${port}/aggregators/http-agg/`,
      ...overrides
    })
  );

  return { server, port };
}

async function startAuthorizationServer() {
  store.authorizationServerClients.clear();
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/.well-known/uma2-configuration") {
      res.writeHead(200, { "content-type": "application/json" });
      const base = `http://127.0.0.1:${server.address().port}`;
      res.end(
        JSON.stringify({
          issuer: base,
          jwks_uri: `${base}/jwks`,
          permission_endpoint: `${base}/permission`,
          introspection_endpoint: `${base}/introspect`,
          resource_registration_endpoint: `${base}/resource-registration`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`
        })
      );
      return;
    }

    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText && req.headers["content-type"] === "application/json" ? JSON.parse(bodyText) : null;
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body
      });
      if (req.method === "POST" && req.url === "/register") {
        assert.match(req.headers.authorization, /^WebID /u);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ client_id: "rs-client", client_secret: "rs-secret" }));
        return;
      }
      if (req.method === "POST" && req.url === "/token") {
        assert.strictEqual(req.headers.authorization, `Basic ${Buffer.from("rs-client:rs-secret").toString("base64")}`);
        assert.strictEqual(bodyText, "grant_type=client_credentials&scope=uma_protection");
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "pat-token", token_type: "Bearer", expires_in: 3600 }));
        return;
      }
      if (req.method === "DELETE" && req.url === "/register/rs-client") {
        assert.strictEqual(req.headers.authorization, `Basic ${Buffer.from("rs-client:rs-secret").toString("base64")}`);
        res.writeHead(204);
        res.end("");
        return;
      }
      const id = req.method === "POST" ? `asset-${requests.length}` : decodeURIComponent(req.url.split("/").pop());
      res.writeHead(req.method === "DELETE" ? 204 : req.method === "POST" ? 201 : 200, {
        "content-type": "application/json",
        location: `/resource-registration/${id}`
      });
      res.end(req.method === "DELETE" ? "" : JSON.stringify({ _id: id }));
    });
  });
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  return { server, port, requests };
}

async function startWebhookPodServer() {
  const subscriptions = [];
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;

    if (req.method === "HEAD") {
      res.writeHead(200, {
        link: `<${base}/storage-description>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`
      });
      res.end("");
      return;
    }

    if (req.method === "GET" && req.url === "/storage-description") {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(`
@prefix notify: <http://www.w3.org/ns/solid/notifications#> .

<> notify:subscription <${base}/notifications/> .

<${base}/notifications/> notify:channelType notify:WebhookChannel2023 .
`);
      return;
    }

    if (req.method === "POST" && req.url === "/notifications/") {
      const chunks = [];
      req.on("data", chunk => chunks.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        subscriptions.push({
          topic: body["notify:topic"]["@id"],
          sendTo: body["notify:sendTo"]["@id"]
        });
        res.writeHead(201, {
          "content-type": "application/ld+json",
          location: `${base}/notifications/channel-${subscriptions.length}`
        });
        res.end(JSON.stringify({ id: `${base}/notifications/channel-${subscriptions.length}` }));
      });
      return;
    }

    res.writeHead(404);
    res.end("");
  });
  const port = await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  return { server, port, subscriptions };
}

function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
  });
}

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(err && err.stack ? err.stack : err);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
  }
})();
