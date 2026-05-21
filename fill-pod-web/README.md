# Fill Pod Web

Small local browser UI for uploading `.fit` files to a Solid pod.

Start it from the repository root:

```bash
npm run fill-pod:web
```

Then open the printed local URL, log in with your Solid issuer, choose one or more FIT files, or generate random FIT files in the browser, and upload them. The UI uses the same `trustflows-client` login package as the main application and derives the pod root from the logged-in WebID.

The default issuer is `http://rs.local:3000`; override it with:

```bash
SOLID_ISSUER_URL=http://rs.local:3000 npm run fill-pod:web
```

By default the local server exposes a client identifier document at `/client-id.jsonld` for the current local URL. To use another client identifier:

```bash
SOLID_CLIENT_ID_URL=https://solidlabresearch.github.io/elevate/client-id.jsonld npm run fill-pod:web
```

The browser uploads each selected file with the authenticated fetch from `trustflows-client` to:

```text
<logged-in-pod-root>/raw-activities/<generated-file-name>
```

It uses the same FIT content type as `scripts/fill-pod.js`: `application/vnd.ant.fit`.

The generator creates valid random cycling, running, and swimming FIT files and adds them to the same selected-file queue as manually chosen files.
