<template>
  <section class="canvas-shell" aria-label="SatSimJS scene">
    <div ref="container" class="cesium-host"></div>
  </section>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ClockRange, ClockStep, JulianDate, Math as CesiumMath } from "cesium";
import Universe from "satsim/src/engine/Universe.js";
import { createViewer } from "satsim/src/widgets/Viewer.js";
import { DEFAULT_SATELLITE_LIMIT, loadDemoScene } from "../services/sceneData.js";

const emit = defineEmits(["load-start", "ready", "load-error"]);
const container = ref(null);

let viewer;
let resizeObserver;

onMounted(async () => {
  try {
    emit("load-start");
    CesiumMath.setRandomNumberSeed(42);

    const universe = new Universe();
    viewer = createViewer(container.value, universe, {
      animation: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      infoBox2: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      showNightLayer: false,
      showWeatherLayer: false,
      timeline: false,
      toolbar2: false
    });

    const start = JulianDate.now();
    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = JulianDate.addSeconds(start, 60 * 60 * 24, new JulianDate());
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = ClockRange.LOOP_STOP;
    viewer.clock.clockStep = ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    viewer.clock.multiplier = 1;
    viewer.clock.shouldAnimate = true;

    resizeObserver = new ResizeObserver(() => {
      viewer?.resize();
    });
    resizeObserver.observe(container.value);

    const scene = await loadDemoScene(universe, viewer, {
      maxSatellites: DEFAULT_SATELLITE_LIMIT
    });

    emit("ready", {
      viewer,
      universe,
      ...scene
    });
  } catch (error) {
    emit("load-error", error);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (viewer && !viewer.isDestroyed()) {
    viewer.destroy();
  }
});
</script>
