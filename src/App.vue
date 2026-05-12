<template>
  <div class="app-shell" ref="appShell">
    <TopBar
      :active-mode="activeMode"
      :coverage-mode="coverageMode"
      :layer-state="layerState"
      :sensor-options="sensorOptions"
      :selected-sensor-id="selectedSensorId"
      :status-text="statusText"
      @coverage-change="setCoverageMode"
      @fly-home="flyHome"
      @fullscreen="toggleFullscreen"
      @layer-change="setLayerState"
      @mode-change="setCameraMode"
      @sensor-change="setSelectedSensor"
    />

    <div class="workspace-frame">
      <main class="scene-frame">
        <SimulationCanvas
          @load-error="handleLoadError"
          @load-start="handleLoadStart"
          @ready="handleReady"
        />
        <SelectionReticle
          :target="selectedObject"
          :universe="universeRef"
          :viewer="viewerRef"
        />
      </main>

      <ObjectDetailsSidebar
        :selection="selectedObjectDetails"
        @close="clearSelectedObject"
        @focus-track="focusTrackSelectedObject"
        @toggle-label="setSelectedObjectLabel"
        @toggle-trace="setSelectedObjectTrace"
      />
    </div>

    <footer class="control-deck">
      <StatusStrip :fps="fps" :satellite-count="satelliteCount" />
      <TimelineBar
        :current-time="clockState.currentTime"
        :is-playing="clockState.isPlaying"
        :percent="clockState.percent"
        :speed="clockState.speed"
        :start-time="clockState.startTime"
        :stop-time="clockState.stopTime"
        @set-speed="setSpeed"
        @scrub="scrubClock"
        @toggle-play="togglePlay"
      />
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from "vue";
import { Cartesian3, Color, Ellipsoid, JulianDate, ReferenceFrame } from "cesium";
import { getObjectPositionInCesiumFrame } from "satsim/src/engine/cesium/utils.js";
import { getVisibility } from "satsim/src/engine/geometry/visibility.js";
import TopBar from "./components/TopBar.vue";
import SimulationCanvas from "./components/SimulationCanvas.vue";
import ObjectDetailsSidebar from "./components/ObjectDetailsSidebar.vue";
import SelectionReticle from "./components/SelectionReticle.vue";
import StatusStrip from "./components/StatusStrip.vue";
import TimelineBar from "./components/TimelineBar.vue";

const appShell = ref(null);
const viewerRef = shallowRef(null);
const universeRef = shallowRef(null);
const sensorOptions = ref([]);
const selectedSensorId = ref("");
const activeMode = ref("world");
const coverageMode = ref("none");
const satelliteCount = ref(0);
const fps = ref(0);
const loadState = ref("Loading scene");
const selectedObject = shallowRef(null);
const selectedObjectDetails = ref(undefined);

const layerState = reactive({
  sensors: true,
  satellites: true,
  labels: false,
  ecrGrid: true,
  fieldOfRegard: false,
  fieldOfView: true,
  beams: true,
  geoBelt: true,
  shadows: false
});

const clockState = reactive({
  currentTime: undefined,
  startTime: undefined,
  stopTime: undefined,
  percent: 0,
  isPlaying: true,
  speed: 1
});

let removeClockListener;
let animationFrameId;
let fpsFrameCount = 0;
let fpsWindowStart = performance.now();

const statusText = computed(() => {
  if (!viewerRef.value) {
    return loadState.value;
  }
  return `${sensorOptions.value.length} sensors loaded`;
});

function getSelectedSensor() {
  return sensorOptions.value.find((entry) => entry.id === selectedSensorId.value)?.sensor;
}

function handleLoadStart() {
  loadState.value = "Loading scene";
}

function handleLoadError(error) {
  console.error(error);
  loadState.value = error instanceof Error ? error.message : "Scene failed to load";
}

function handleReady(payload) {
  viewerRef.value = payload.viewer;
  universeRef.value = payload.universe;
  sensorOptions.value = payload.sensors;
  selectedSensorId.value = payload.sensors[0]?.id ?? "";
  satelliteCount.value = payload.satelliteCount;
  loadState.value = "Scene ready";

  applyAllLayerState();
  installObjectPicker(payload.viewer);
  setCoverageMode(coverageMode.value);
  syncClockState();
  startClockMonitor();
  startFpsMonitor();
}

function installObjectPicker(viewer) {
  viewer.objectPickListener = (picked) => {
    if (!picked) {
      clearSelectedObject();
      return;
    }

    viewer.selectedEntity = getObjectEntity(picked);
    selectedObject.value = picked;
    refreshSelectedObjectDetails();
  };
}

function clearSelectedObject() {
  const viewer = viewerRef.value;
  selectedObject.value = null;
  selectedObjectDetails.value = undefined;
  if (viewer) {
    viewer.selectedEntity = undefined;
    viewer.lastPicked = undefined;
  }
}

function refreshSelectedObjectDetails() {
  const object = selectedObject.value;
  const viewer = viewerRef.value;
  if (!object || !viewer) {
    return;
  }

  const currentTime = viewer.clock.currentTime;
  refreshSelectedObjectState(object, currentTime);

  const entity = getObjectEntity(object);
  selectedObjectDetails.value = {
    name: String(object.name ?? object.site?.name ?? "Selected Object"),
    type: getObjectType(object),
    sections: buildObjectSections(object, currentTime),
    visibility: buildVisibilityDetails(object, currentTime),
    canFocus: !!entity,
    canTrace: hasObjectPathCapability(object),
    canLabel: isTrackableObject(object),
    traceEnabled: getObjectPathShowValue(entity),
    labelEnabled: !!entity?.label2?.show
  };
}

function refreshSelectedObjectState(object, time) {
  const universe = universeRef.value;
  if (!universe || !time) {
    return;
  }

  [object, object?.site].forEach((candidate) => {
    if (typeof candidate?.update !== "function") {
      return;
    }

    try {
      candidate.update(time, universe, true, true, true);
    } catch (error) {
      console.warn("Failed to refresh selected object state", error);
    }
  });
}

function getObjectEntity(object) {
  return object?.visualizer ?? object?.site?.visualizer;
}

function getObjectType(object) {
  const constructorName = object?.constructor?.name;
  if (!constructorName) {
    return "Object";
  }
  return constructorName.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isTrackableObject(object) {
  return (universeRef.value?._trackables ?? []).includes(object);
}

function hasObjectPathCapability(object) {
  const entity = object?.visualizer;
  return !!entity && (!!entity.path || !!entity._satsimDeferredPathOptions);
}

function getObjectPathShowValue(entity) {
  if (!entity?.path) {
    return false;
  }

  const show = entity.path.show;
  if (show === undefined || show === null) {
    return true;
  }
  if (typeof show.getValue === "function") {
    return !!show.getValue(viewerRef.value?.clock.currentTime);
  }
  return !!show;
}

function focusTrackSelectedObject() {
  const object = selectedObject.value;
  const viewer = viewerRef.value;
  const entity = getObjectEntity(object);
  if (!viewer || !entity) {
    return;
  }

  if (viewer.cameraMode !== "world" && typeof viewer.setCameraMode === "function") {
    viewer.setCameraMode("world", undefined, { skipFlyHome: true });
  }
  activeMode.value = "world";
  layerState.ecrGrid = true;
  viewer.referenceFrameView = ReferenceFrame.FIXED;
  viewer.selectedEntity = entity;
  viewer.pickedObject = object;
  viewer.lastPicked = object;

  if (entity.position) {
    viewer.trackedEntity = entity;
  } else {
    viewer.zoomTo(entity);
  }

  refreshSelectedObjectDetails();
}

function setSelectedObjectTrace(enabled) {
  const object = selectedObject.value;
  const viewer = viewerRef.value;
  if (!viewer || !object || typeof viewer.setObjectPathEnabled !== "function") {
    return;
  }
  viewer.setObjectPathEnabled(object, enabled);
  refreshSelectedObjectDetails();
}

function setSelectedObjectLabel(enabled) {
  const object = selectedObject.value;
  const viewer = viewerRef.value;
  const universe = universeRef.value;
  const entity = getObjectEntity(object);
  if (!object || !viewer || !universe || !entity || !isTrackableObject(object)) {
    return;
  }

  if (!object.visualizer.label2) {
    const label = viewer.labels.add({
      text: object.name,
      font: "14px sans-serif"
    });
    label.id = entity;
    label.update = function (time, activeUniverse) {
      label.position = getObjectPositionInCesiumFrame(viewer, activeUniverse, object, time);
      if (viewer.labelsOn && viewer.cameraMode !== "up") {
        try {
          const cameraPosition = viewer.camera.positionWC;
          if (!cameraPosition || !label.position) {
            return;
          }
          const distanceSquared = Cartesian3.distanceSquared(cameraPosition, label.position);
          const inRange = distanceSquared < viewer.labelDistanceThresholdMetersSq;
          label.show = inRange;
          if (inRange) {
            const fadeStart = viewer.labelDistanceThresholdMeters;
            const fadeEnd = Math.max(0, viewer.labelFadeOpaqueMeters || 4000000);
            const fadeSpan = Math.max(1e-6, fadeStart - fadeEnd);
            const distance = Math.sqrt(distanceSquared);
            let alpha = 1.0;
            if (distance >= fadeStart) {
              alpha = 0.0;
            } else if (distance > fadeEnd) {
              alpha = (fadeStart - distance) / fadeSpan;
            }
            label.fillColor = Color.WHITE.withAlpha(alpha);
          }
        } catch {
          // Camera state can be transient during mode changes.
        }
      }
    };
    object.visualizer.label2 = label;
    object.updateListeners.push(label);
  }

  object.visualizer.label2.show = enabled;
  try {
    object.visualizer.label2.position = getObjectPositionInCesiumFrame(viewer, universe, object, viewer.clock.currentTime);
  } catch {
    // Position will update on the next simulation tick.
  }
  refreshSelectedObjectDetails();
}

function buildObjectSections(object, time) {
  const sections = [];
  addRowsSection(sections, "Orbit", buildOrbitRows(object));
  addRowsSection(sections, "State Vector", buildStateRows(object, time));
  addRowsSection(sections, "Location", buildLocationRows(object));
  addRowsSection(sections, "Model", buildModelRows(object?.model));

  const tleLines = buildTleLines(object);
  if (tleLines.length) {
    sections.push({ title: "Source TLE", lines: tleLines });
  }

  return sections;
}

function addRowsSection(sections, title, rows) {
  if (rows.length) {
    sections.push({ title, rows });
  }
}

function buildOrbitRows(object) {
  const rows = [];

  if (Number.isFinite(object?.period)) {
    rows.push({ label: "Period", value: `${(object.period / 60).toFixed(2)} min` });
  }

  if (Number.isFinite(object?.eccentricity)) {
    rows.push({ label: "Eccentricity", value: object.eccentricity.toFixed(7) });
  }

  return rows;
}

function buildStateRows(object, time) {
  const rows = [];
  const positionObject = object?.site ?? object;
  const worldPosition = readCartesian(() => positionObject.worldPosition);
  if (worldPosition) {
    rows.push({ label: "ECI Position", value: formatCartesianKm(worldPosition) });
    if (isOrbitingObject(positionObject)) {
      const altitude = calculateAltitudeMeters(worldPosition, time);
      if (Number.isFinite(altitude)) {
        rows.push({ label: "Altitude", value: formatAltitudeMeters(altitude) });
      }
    }
  }

  const worldVelocity = readWorldVelocity(positionObject, time);
  if (worldVelocity) {
    rows.push({ label: "ECI Velocity", value: formatCartesianKm(worldVelocity, "km/s", 3) });
  }

  return rows;
}

function readWorldVelocity(object, time) {
  const directVelocity = normalizeVelocityMetersPerSecond(
    readCartesian(() => object.worldVelocity),
    object
  );

  if (directVelocity && Cartesian3.magnitude(directVelocity) > 0.01) {
    return directVelocity;
  }

  const estimatedVelocity = estimateWorldVelocity(object, time);
  return estimatedVelocity ?? directVelocity;
}

function normalizeVelocityMetersPerSecond(velocity, object) {
  if (!velocity) {
    return undefined;
  }

  const magnitude = Cartesian3.magnitude(velocity);
  if (isOrbitingObject(object) && magnitude > 0 && magnitude < 100) {
    return Cartesian3.multiplyByScalar(velocity, 1000, new Cartesian3());
  }

  return velocity;
}

function estimateWorldVelocity(object, time) {
  const universe = universeRef.value;
  if (!universe || !time || !isOrbitingObject(object) || typeof object?.update !== "function") {
    return undefined;
  }

  const halfStepSeconds = 0.5;
  const beforeTime = JulianDate.addSeconds(time, -halfStepSeconds, new JulianDate());
  const afterTime = JulianDate.addSeconds(time, halfStepSeconds, new JulianDate());
  const beforePosition = new Cartesian3();
  const afterPosition = new Cartesian3();

  try {
    object.update(beforeTime, universe, true, true, false);
    Cartesian3.clone(object.worldPosition, beforePosition);
    object.update(afterTime, universe, true, true, false);
    Cartesian3.clone(object.worldPosition, afterPosition);
    return Cartesian3.divideByScalar(
      Cartesian3.subtract(afterPosition, beforePosition, new Cartesian3()),
      halfStepSeconds * 2,
      new Cartesian3()
    );
  } catch (error) {
    console.warn("Failed to estimate selected object velocity", error);
    return undefined;
  } finally {
    try {
      object.update(time, universe, true, true, true);
    } catch {
      // The next simulation tick will restore object state if this fails.
    }
  }
}

function isOrbitingObject(object) {
  return Number.isFinite(object?.period) || !!object?.tle;
}

function calculateAltitudeMeters(worldPosition, time) {
  const universe = universeRef.value;
  if (universe?.earth && time) {
    try {
      universe.earth.update(time, universe, true, true, false);
      const fixedPosition = universe.earth.transformPointFromWorld(worldPosition, new Cartesian3());
      const cartographic = Ellipsoid.WGS84.cartesianToCartographic(fixedPosition);
      if (Number.isFinite(cartographic?.height)) {
        return cartographic.height;
      }
    } catch {
      // Fall through to spherical altitude below.
    }
  }

  return Cartesian3.magnitude(worldPosition) - 6371008.8;
}

function buildLocationRows(object) {
  const rows = [];
  const geoObject = object?.site ?? object;

  if (Number.isFinite(geoObject?.latitude) && Number.isFinite(geoObject?.longitude)) {
    rows.push({ label: "Latitude", value: `${geoObject.latitude.toFixed(4)} deg` });
    rows.push({ label: "Longitude", value: `${geoObject.longitude.toFixed(4)} deg` });
  }

  if (Number.isFinite(geoObject?.altitude)) {
    rows.push({ label: "Altitude", value: `${geoObject.altitude.toFixed(0)} m` });
  }

  return rows;
}

function buildModelRows(model) {
  if (!model || typeof model !== "object") {
    return [];
  }

  return Object.entries(model).map(([key, value]) => ({
    label: toTitleLabel(key),
    value: formatModelValue(value)
  }));
}

function buildTleLines(object) {
  const tle = object?.tle;
  if (!tle?.line1 || !tle?.line2) {
    return [];
  }
  return [tle.line1, tle.line2];
}

function buildVisibilityDetails(object, time) {
  const viewer = viewerRef.value;
  const universe = universeRef.value;
  const observatories = universe?._observatories ?? [];
  if (!viewer || !universe || !isTrackableObject(object) || !observatories.length) {
    return undefined;
  }

  try {
    refreshVisibilityContext(time);
    const rows = getVisibility(universe, viewer, observatories, object);
    const visibleCount = rows.filter((row) => row.visible).length;
    return {
      summary: `${visibleCount} / ${rows.length} sensors visible`,
      rows: rows.map(formatVisibilityRow)
    };
  } catch (error) {
    console.warn("Failed to calculate selected object visibility", error);
    return undefined;
  }
}

function refreshVisibilityContext(time) {
  const universe = universeRef.value;
  if (!universe || !time) {
    return;
  }

  [universe.earth, universe.sun].forEach((candidate) => {
    candidate?.update?.(time, universe, true, true, false);
  });

  (universe._observatories ?? []).forEach((observatory) => {
    observatory?.site?.update?.(time, universe, true, true, false);
  });
}

function formatVisibilityRow(row) {
  return {
    sensor: String(row.sensor ?? "Sensor"),
    visible: !!row.visible,
    visibleText: row.visible ? "Yes" : "No",
    azimuth: formatFinite(row.az, 1, " deg"),
    elevation: formatFinite(row.el, 1, " deg"),
    range: formatFinite(row.range ?? row.r, 1, " km", 1000),
    phase: formatFinite(row.phaseAngle, 1, " deg"),
    magnitude: formatFinite(row.mv, 1),
    rate: formatFinite(row.angRateArcsecPerSec, 1, " arcsec/s")
  };
}

function readCartesian(getter) {
  try {
    const value = getter();
    if (
      Number.isFinite(value?.x) &&
      Number.isFinite(value?.y) &&
      Number.isFinite(value?.z)
    ) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function formatCartesianKm(cartesian, units = "km", decimals = 1) {
  return [
    cartesian.x / 1000,
    cartesian.y / 1000,
    cartesian.z / 1000
  ].map((value) => value.toFixed(decimals)).join(", ") + ` ${units}`;
}

function formatFinite(value, decimals, suffix = "", divisor = 1) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  return `${(value / divisor).toFixed(decimals)}${suffix}`;
}

function formatAltitudeMeters(value) {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)} km`;
  }
  return `${value.toFixed(0)} m`;
}

function formatModelValue(value) {
  if (Number.isFinite(value)) {
    return String(value);
  }
  return String(value ?? "--");
}

function toTitleLabel(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function applyAllLayerState() {
  Object.entries(layerState).forEach(([key, value]) => {
    applyLayer(key, value);
  });
}

function setLayerState({ key, value }) {
  if (!(key in layerState)) {
    return;
  }
  layerState[key] = value;
  applyLayer(key, value);
}

function applyLayer(key, value) {
  const viewer = viewerRef.value;
  if (!viewer) {
    return;
  }

  if (key === "satellites" && viewer.points) {
    viewer.points.show = value;
  } else if (key === "sensors") {
    const observatories = universeRef.value?._observatories ?? [];
    observatories.forEach((observatory) => {
      if (observatory?.site?.visualizer) {
        observatory.site.visualizer.show = value;
      }
    });
  } else if (key === "labels" && typeof viewer.setAllLabelsEnabled === "function") {
    viewer.setAllLabelsEnabled(value);
  } else if (key === "ecrGrid") {
    viewer.referenceFrameView = value ? ReferenceFrame.FIXED : ReferenceFrame.INERTIAL;
  } else if (key === "fieldOfRegard" && typeof viewer.showVisual === "function") {
    viewer.showVisual(viewer.sensorForVisualizers, value);
  } else if (key === "fieldOfView" && typeof viewer.showVisual === "function") {
    viewer.showVisual(viewer.sensorFovVisualizers, value);
  } else if (key === "beams" && typeof viewer.showVisual === "function") {
    viewer.showVisual(viewer.beamVisualizers, value);
  } else if (key === "geoBelt" && typeof viewer.showVisual === "function") {
    viewer.showVisual(viewer.geoBeltVisualizer, value);
  } else if (key === "shadows" && typeof viewer.enableShadowColoring === "function") {
    viewer.enableShadowColoring(value);
  }
}

function setCoverageMode(mode) {
  coverageMode.value = mode;
  const viewer = viewerRef.value;
  if (!viewer?.coverageVisualizer) {
    return;
  }

  if (mode === "none") {
    viewer.coverageVisualizer.show = false;
    return;
  }

  viewer.coverageVisualizer.orbit = mode;
  viewer.coverageVisualizer.show = true;
  viewer.coverageVisualizer.update(viewer.clock.currentTime);
}

function setCameraMode(mode) {
  const viewer = viewerRef.value;
  if (!viewer || typeof viewer.setCameraMode !== "function") {
    activeMode.value = mode;
    return;
  }

  if (mode === "world") {
    viewer.setCameraMode("world");
    activeMode.value = "world";
    return;
  }

  const sensor = getSelectedSensor();
  if (!sensor) {
    activeMode.value = "world";
    return;
  }

  viewer.setCameraMode(mode, sensor);
  activeMode.value = mode;
}

function setSelectedSensor(sensorId) {
  selectedSensorId.value = sensorId;
  if (activeMode.value === "sensor" || activeMode.value === "up") {
    setCameraMode(activeMode.value);
  }
}

function flyHome() {
  const viewer = viewerRef.value;
  if (!viewer) {
    return;
  }
  releaseTrackedCamera(viewer);
  if (typeof viewer.setCameraMode === "function") {
    viewer.setCameraMode("world", undefined, { skipFlyHome: true });
    activeMode.value = "world";
  }
  layerState.ecrGrid = true;
  viewer.referenceFrameView = ReferenceFrame.FIXED;
  releaseTrackedCamera(viewer);
  viewer.camera.flyHome(0.5);
}

function releaseTrackedCamera(viewer) {
  viewer.trackedEntity = undefined;
}

function toggleFullscreen() {
  const target = appShell.value ?? document.documentElement;
  if (document.fullscreenElement) {
    document.exitFullscreen();
    return;
  }
  target.requestFullscreen?.();
}

function togglePlay() {
  const viewer = viewerRef.value;
  clockState.isPlaying = !clockState.isPlaying;
  if (viewer) {
    viewer.clock.shouldAnimate = clockState.isPlaying;
  }
}

function setSpeed(speed) {
  const numericSpeed = Number(speed);
  clockState.speed = Number.isFinite(numericSpeed) ? numericSpeed : 1;
  const viewer = viewerRef.value;
  if (viewer) {
    viewer.clock.multiplier = clockState.speed;
  }
}

function scrubClock(percent) {
  const viewer = viewerRef.value;
  if (!viewer || !clockState.startTime || !clockState.stopTime) {
    return;
  }
  const clampedPercent = Math.max(0, Math.min(100, Number(percent)));
  const totalSeconds = JulianDate.secondsDifference(clockState.stopTime, clockState.startTime);
  viewer.clock.currentTime = JulianDate.addSeconds(
    clockState.startTime,
    totalSeconds * (clampedPercent / 100),
    new JulianDate()
  );
  syncClockState();
}

function syncClockState() {
  const viewer = viewerRef.value;
  if (!viewer) {
    return;
  }

  clockState.currentTime = JulianDate.clone(viewer.clock.currentTime, clockState.currentTime ?? new JulianDate());
  clockState.startTime = JulianDate.clone(viewer.clock.startTime, clockState.startTime ?? new JulianDate());
  clockState.stopTime = JulianDate.clone(viewer.clock.stopTime, clockState.stopTime ?? new JulianDate());
  clockState.isPlaying = viewer.clock.shouldAnimate;
  clockState.speed = viewer.clock.multiplier;

  const elapsed = JulianDate.secondsDifference(clockState.currentTime, clockState.startTime);
  const total = JulianDate.secondsDifference(clockState.stopTime, clockState.startTime);
  clockState.percent = total > 0 ? Math.max(0, Math.min(100, (elapsed / total) * 100)) : 0;
  refreshSelectedObjectDetails();
}

function startClockMonitor() {
  if (removeClockListener) {
    removeClockListener();
  }
  const viewer = viewerRef.value;
  removeClockListener = viewer?.clock.onTick.addEventListener(syncClockState);
}

function startFpsMonitor() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  const updateFps = (timestamp) => {
    fpsFrameCount += 1;
    const elapsed = timestamp - fpsWindowStart;
    if (elapsed >= 500) {
      fps.value = Math.round((fpsFrameCount * 1000) / elapsed);
      fpsFrameCount = 0;
      fpsWindowStart = timestamp;
    }
    animationFrameId = requestAnimationFrame(updateFps);
  };

  fpsWindowStart = performance.now();
  fpsFrameCount = 0;
  animationFrameId = requestAnimationFrame(updateFps);
}

onBeforeUnmount(() => {
  if (removeClockListener) {
    removeClockListener();
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  clearSelectedObject();
});
</script>
