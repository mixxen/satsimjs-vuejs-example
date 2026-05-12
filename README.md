# SatSimJS Vue Prototype

Standalone Vue 3 + Vite prototype for SatSimJS. It imports the local SatSimJS
source from this repository and keeps all Vue controls outside the Cesium
canvas.

```sh
npm install
npm run dev -- --host 0.0.0.0
```

The demo loads all bundled sites and TLE satellites from `public/assets`.

## Developer Map

The Vue prototype has three main integration points:

- `src/components/SimulationCanvas.vue` owns Cesium/SatSimJS startup and emits
  the initialized `{ viewer, universe, sensors, satelliteCount }`.
- `src/App.vue` owns app-level state: toolbar mode, layer toggles, coverage
  mode, timeline, FPS, and shell layout.
- `src/composables/useObjectSelection.js` owns selected-object behavior:
  picking, sidebar view-model data, focus tracking, trace toggles, label
  toggles, and camera tracking release.

The sidebar and reticle are intentionally Vue components outside the Cesium
canvas:

- `src/components/ObjectDetailsSidebar.vue` renders the selected-object
  view model. It does not read SatSimJS objects directly.
- `src/components/SelectionReticle.vue` projects the selected object into
  window coordinates on Cesium `postRender`.

## Public App Contracts

### `loadDemoScene(universe, viewer, options)`

Defined in `src/services/sceneData.js`.

Loads bundled `sites.json` and `celestrak_sat_elem.txt`, attaches SatSimJS
visualizers, initializes random sensor tracks, and returns:

```js
{
  observatoryCount,
  satelliteCount,
  sensors,
  stopRandomTracking
}
```

`options.maxSatellites` defaults to `DEFAULT_SATELLITE_LIMIT`, currently all
bundled satellites. `options.randomTrackIntervalSeconds` defaults to `15`,
matching the original JavaScript demo. Call `stopRandomTracking()` before
destroying the viewer.

### `useObjectSelection({ viewerRef, universeRef, activeMode, layerState })`

Defined in `src/composables/useObjectSelection.js`.

This is the public selection controller for the Vue app. It returns:

- `selectedObject`: the selected SatSimJS object for reticle placement.
- `selectedObjectDetails`: normalized sidebar data for Vue rendering.
- `installObjectPicker(viewer)`: wires SatSimJS picking into Vue state.
- `clearSelectedObject()`: clears Vue and Cesium selection state.
- `refreshSelectedObjectDetails()`: rebuilds sidebar data for the current clock
  time.
- `focusTrackSelectedObject()`: switches to world view and tracks the selected
  entity.
- `releaseTrackedCamera()`: clears Cesium entity tracking before normal globe
  camera actions.
- `setSelectedObjectTrace(enabled)`: toggles the selected object path.
- `setSelectedObjectLabel(enabled)`: creates/toggles the selected object label.

### Component Events

`SimulationCanvas.vue` emits:

- `load-start`
- `load-error(error)`
- `ready(payload)`

`ObjectDetailsSidebar.vue` emits:

- `close`
- `focus-track`
- `toggle-label(enabled)`
- `toggle-trace(enabled)`

## High-Value Code Paths

When changing object details, start with `useObjectSelection.js`:

- `buildObjectSections` controls sidebar section order and data shape.
- `buildStateRows` controls ECI position, altitude, and velocity display.
- `estimateWorldVelocity` derives velocity from nearby interpolated positions.
  This avoids forcing SGP4 propagation for Lagrange-wrapped satellites.
- `buildVisibilityDetails` mirrors SatSimJS visibility calculation into a Vue
  table.
- `ensureObjectLabel` bridges the Vue label toggle to SatSimJS/Cesium label
  primitives.

When changing scene data, start with `sceneData.js`:

- `loadSensors` maps demo sensor JSON into SatSimJS observatories.
- `loadSatellites` maps TLE triples into Lagrange-interpolated SGP4 satellites
  and stores the source TLE on each satellite for Vue display.
- `randomTrack` seeds each observatory with a visible low-orbit target.
- `startRandomTracking` rotates one observatory to a new visible target every
  configured simulation-time interval.

## GitHub Pages

This app can be deployed by `.github/workflows/deploy-pages.yml` after this
folder is pushed as its own GitHub repository. The workflow checks out the
SatSimJS source beside the Vue app, then builds with:

```sh
SATSIMJS_ROOT=.satsimjs VITE_BASE=/${GITHUB_REPOSITORY#*/}/ npm run build
```

That keeps Vite and Cesium asset URLs valid for a repository Pages URL.
