# Elevate

This repository demonstrates a dashboard that stores and visualizes sports and activity data in Solid Pods. It shows how decentralized data pods, Incremunica, and aggregators can be combined to build a high-performance dashboard app with rich insights and visualizations.

## Development

This section covers the environment setup to develop and build both desktop app and web extension.

### Global solution structure

The solution is cut in 3 folders/projects: the `appcore`, the `desktop`

#### App-core project

Appcore contains core features like _fitness trend, year progressions, athlete settings..._

The `Appcore` main technology stack is:

- [Typescript](https://www.typescriptlang.org/) as programming language.
- [Angular](https://angular.io/) as frontend (build with [@angular/cli](https://cli.angular.io/)).
- [Angular Material](https://material.angular.io/) for material designed components.
- [Metrics Graphics](https://www.metricsgraphicsjs.org/), [Plotly](https://plotly.com/javascript/) & [D3](https://d3js.org/) for charting.
- [LokiJS](https://https://github.com/techfort/LokiJS) as in-memory NoSQL database persisted in IndexedDB.
- [Jest](https://jestjs.io/) as Javascript test runner (instead of "stock" karma one).

#### Desktop project

Holds the container behaviour to provide a cross-platform desktop app under _Windows, Linux & MacOS_. It contains desktop specific features like _connectors synchronization_ (to fetch athlete activities from external).

The `Desktop` main technology stack is:

- [Typescript](https://www.typescriptlang.org/) as programming language.
- [Jest](https://jestjs.io/) as Javascript test runner.
- [Electron](https://electronjs.org/) as cross-platform desktop container.
- [Electron-builder](https://www.electron.build/) to build, sign and publish installers per platform. Also handle app updates process (via `electron-updater`).
- [Rollup.js](https://rollupjs.org/guide/en/) to load & bundle modules.
- [Vue.js](https://vuejs.org/) for splash-screen update window.

### Environments setup

#### Install requirements

You will need to install [NodeJS](https://nodejs.org) (v15+).

```bash
git clone https://github.com/SolidLabResearch/elevate.git
```

or

```bash
git clone git@github.com:SolidLabResearch/elevate.git
```

The new mono-repo including the desktop app is on `develop` branch. So checkout/track this branch to build the desktop app:

```bash
cd ./elevate
git checkout --track origin/develop
```

Then install npm dependencies:

```bash
npm install
```

Run solution tests (`appcore` + `desktop`):

```bash
npm test
```

(_Should be executed with success for any pull request submission_).

#### Desktop development environment

All commands displayed in this section will be executed in `./desktop/` folder. So:

```bash
cd ./desktop/
```

- Run in development:

```bash
npm start
```

> This npm task will create a `./desktop/dist` output folder and re-compile both `appcore` and `desktop` projects on any code changes

To open the desktop app, open another terminal, then run:

```bash
npm run launch:dev:app
```

- Run unit tests:

```bash
npm test
```

- Generate production installers and publish them per platforms:

First switch to desktop directory with `cd desktop/`

- Build `Windows` `x64` `.exe`:

  ```bash
  npm run build:publish:windows
  ```

- Build `Linux` `x64` `.deb`:

  ```bash
  npm run build:publish:linux
  ```

- Build `MacOS` `x64` `.dmg` :

  ```bash
  npm run build:publish:macos
  ```

> Output installers will be located in `./desktop/package/`
> The build targets are defined in `./desktop/package.json` (`build` key section). See [https://www.electron.build](https://www.electron.build) for more info.

- (Optional) To sign the production installers read the [how to sign appendix](#sign-application)

- (Optional) To publish the production installers on github read the [how to publish on github appendix](#publish-to-github-releases)

- Clean outputs:

```bash
npm run clean
```

## Solid OIDC Client Metadata

The Solid connector uses a hosted client metadata document:

`https://solidlabresearch.github.io/elevate/client-id.jsonld`

The source file lives at `docs/client-id.jsonld`.

To publish/update this URL from this repository:

1. Open repository **Settings > Pages**
2. Set **Source** to deploy from branch `main` (or your working branch) and folder `/docs`
3. Save and wait for GitHub Pages deployment to complete
