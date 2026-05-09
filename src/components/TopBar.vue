<template>
  <header class="top-bar">
    <div class="top-bar-row">
      <details class="layers-control">
        <summary class="toolbar-button layers-summary">
          <Layers :size="16" />
          <span>Layers</span>
          <span class="count-pill">{{ activeLayerCount }}</span>
          <ChevronDown :size="14" />
        </summary>
        <div class="layers-panel" aria-label="Layer controls">
          <label v-for="layer in layers" :key="layer.key" class="layer-toggle">
            <input
              type="checkbox"
              :checked="layerState[layer.key]"
              @change="emitLayerChange(layer.key, $event.target.checked)"
            />
            <span>{{ layer.label }}</span>
          </label>
        </div>
      </details>

      <div class="segmented-control" role="tablist" aria-label="Camera view">
        <button
          v-for="mode in cameraModes"
          :key="mode.value"
          class="segment-button"
          :class="{ active: activeMode === mode.value }"
          :disabled="mode.needsSensor && !hasSensors"
          type="button"
          @click="$emit('mode-change', mode.value)"
        >
          {{ mode.label }}
        </button>
      </div>

      <label class="select-control sensor-select">
        <span>Sensor</span>
        <select
          :disabled="!hasSensors"
          :value="selectedSensorId"
          @change="$emit('sensor-change', $event.target.value)"
        >
          <option v-if="!hasSensors" value="">No sensors loaded</option>
          <option
            v-for="sensor in sensorOptions"
            :key="sensor.id"
            :value="sensor.id"
          >
            {{ sensor.name }}
          </option>
        </select>
      </label>

      <label class="select-control coverage-select">
        <span>Coverage</span>
        <select :value="coverageMode" @change="$emit('coverage-change', $event.target.value)">
          <option value="none">No Coverage Map</option>
          <option value="LEO">LEO Coverage Map</option>
          <option value="MEO">MEO Coverage Map</option>
          <option value="GEO">GEO Coverage Map</option>
          <option value="LUNAR">Lunar Coverage Map</option>
        </select>
      </label>

      <div class="top-spacer"></div>

      <span class="scene-status">{{ statusText }}</span>

      <button class="icon-button" type="button" aria-label="Fly home" title="Fly home" @click="$emit('fly-home')">
        <Home :size="18" />
      </button>
      <button class="icon-button" type="button" aria-label="Toggle fullscreen" title="Toggle fullscreen" @click="$emit('fullscreen')">
        <Maximize :size="18" />
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from "vue";
import { ChevronDown, Home, Layers, Maximize } from "lucide-vue-next";

const props = defineProps({
  activeMode: {
    type: String,
    required: true
  },
  coverageMode: {
    type: String,
    required: true
  },
  layerState: {
    type: Object,
    required: true
  },
  sensorOptions: {
    type: Array,
    required: true
  },
  selectedSensorId: {
    type: String,
    required: true
  },
  statusText: {
    type: String,
    required: true
  }
});

const emit = defineEmits([
  "coverage-change",
  "fly-home",
  "fullscreen",
  "layer-change",
  "mode-change",
  "sensor-change"
]);

const cameraModes = [
  { value: "world", label: "World", needsSensor: false },
  { value: "sensor", label: "Sensor", needsSensor: true },
  { value: "up", label: "What's Up", needsSensor: true }
];

const layers = [
  { key: "sensors", label: "Sensors" },
  { key: "satellites", label: "Satellites" },
  { key: "labels", label: "Labels" },
  { key: "shadows", label: "Shadow" },
  { key: "ecrGrid", label: "ECR Grid" },
  { key: "fieldOfRegard", label: "FoR" },
  { key: "fieldOfView", label: "FoV" },
  { key: "geoBelt", label: "GEO Ring" }
];

const hasSensors = computed(() => props.sensorOptions.length > 0);
const activeLayerCount = computed(() => layers.filter((layer) => props.layerState[layer.key]).length);

function emitLayerChange(key, value) {
  emit("layer-change", { key, value });
}
</script>
