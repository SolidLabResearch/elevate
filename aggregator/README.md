# Elevate FIT/GPX RDF Aggregator

Standalone Aggregator Protocol server for converting Solid Pod FIT/GPX/TCX files into the current Elevate `activo:` RDF
shape and writing the generated Turtle back to the pod.

## Run

```bash
cd aggregator
npm run build
npm run start
```

By default the server listens on `http://localhost:4050`.

Environment variables:

- `AGGREGATOR_PORT`: HTTP port, default `4050`
- `AGGREGATOR_HOST`: bind host, default `127.0.0.1`
- `AGGREGATOR_BASE_URL`: public base URL used in the Client ID document and metadata
- `AGGREGATOR_AUTHORIZATION_SERVER`: optional UMA authorization server metadata value

## Login

The server exposes its own Client ID document at:

```text
http://localhost:4050/client.jsonld
```

Start authorization either by opening:

```text
http://localhost:4050/login?issuer=https://idp.example
```

or by using the management endpoint:

```bash
curl -X POST http://localhost:4050/registration \
  -H 'content-type: application/json' \
  --data '{
    "management_flow": "authorization_code",
    "issuer": "https://idp.example"
  }'
```

The callback creates an in-memory aggregator instance and subscribes to Solid webhooks for the source activity container
and Elevate settings resources.

## Pod Layout

Defaults are derived from the authenticated WebID storage root:

- Source container: `/raw-activities/`
- Output container: `/activities/`
- Athlete settings: `/settings/elevate-athlete.ttl`
- User settings: `/settings/elevate-user.ttl`

The settings files are Turtle RDF resources and are created with Elevate defaults if they are missing. Athlete or user
settings webhook notifications trigger a full recalculation of the generated activity resources. The generated activity
resources use stable names derived from the source IRI, so repeated conversions overwrite the same result instead of
creating duplicates.

## Discovery

- `GET /`: Aggregator Server Description
- `GET /transformations`: server-level FnO/DCAT transformation catalog
- `GET /aggregators/{id}/`: Aggregator Description
- `GET /aggregators/{id}/transformations`: instance transformation catalog
- `GET /aggregators/{id}/services`: service collection
- `GET /aggregators/{id}/services/fit-gpx-to-rdf/`: service description
- `GET /aggregators/{id}/services/fit-gpx-to-rdf/provenance`: latest execution provenance
