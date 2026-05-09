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

    <main class="scene-frame">
      <SimulationCanvas
        @load-error="handleLoadError"
        @load-start="handleLoadStart"
        @ready="handleReady"
      />
    </main>

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
import { JulianDate, ReferenceFrame } from "cesium";
import TopBar from "./components/TopBar.vue";
import SimulationCanvas from "./components/SimulationCanvas.vue";
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
  setCoverageMode(coverageMode.value);
  syncClockState();
  startClockMonitor();
  startFpsMonitor();
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
  if (typeof viewer.setCameraMode === "function") {
    viewer.setCameraMode("world");
    activeMode.value = "world";
  }
  viewer.camera.flyHome(0.5);
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
});
</script>
