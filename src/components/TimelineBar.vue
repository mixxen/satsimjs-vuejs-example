<template>
  <section class="timeline-bar" aria-label="Simulation timeline">
    <div class="timeline-actions">
      <button class="transport-button" type="button" aria-label="Jump to start" title="Jump to start" @click="scrubTo(0)">
        <SkipBack :size="16" />
      </button>
      <button class="transport-button primary" type="button" :aria-label="isPlaying ? 'Pause' : 'Play'" :title="isPlaying ? 'Pause' : 'Play'" @click="$emit('toggle-play')">
        <Pause v-if="isPlaying" :size="16" />
        <Play v-else :size="16" />
      </button>
      <button class="transport-button" type="button" aria-label="Jump to end" title="Jump to end" @click="scrubTo(100)">
        <SkipForward :size="16" />
      </button>
    </div>

    <label class="speed-control">
      <span>{{ speedLabel }}</span>
      <select :value="speed" @change="$emit('set-speed', Number($event.target.value))">
        <option :value="0.25">0.25x</option>
        <option :value="0.5">0.5x</option>
        <option :value="1">1x</option>
        <option :value="5">5x</option>
        <option :value="25">25x</option>
        <option :value="100">100x</option>
      </select>
    </label>

    <div class="time-readout">
      <span>{{ dateText }}</span>
      <strong>{{ timeText }}</strong>
    </div>

    <div class="timeline-track">
      <input
        aria-label="Simulation time"
        class="timeline-range"
        max="100"
        min="0"
        step="0.01"
        type="range"
        :value="percent"
        @input="$emit('scrub', Number($event.target.value))"
      />
      <div class="time-ticks" aria-hidden="true">
        <span v-for="tick in ticks" :key="tick.offset">{{ tick.label }}</span>
      </div>
    </div>

    <button class="now-button" type="button" @click="scrubTo(0)">NOW</button>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { JulianDate } from "cesium";
import { Pause, Play, SkipBack, SkipForward } from "lucide-vue-next";

const props = defineProps({
  currentTime: {
    type: Object,
    default: undefined
  },
  isPlaying: {
    type: Boolean,
    required: true
  },
  percent: {
    type: Number,
    required: true
  },
  speed: {
    type: Number,
    required: true
  },
  startTime: {
    type: Object,
    default: undefined
  },
  stopTime: {
    type: Object,
    default: undefined
  }
});

const emit = defineEmits(["set-speed", "scrub", "toggle-play"]);

const dateText = computed(() => {
  const date = toDate(props.currentTime);
  if (!date) {
    return "Loading";
  }
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric"
  }).format(date);
});

const timeText = computed(() => {
  const date = toDate(props.currentTime);
  if (!date) {
    return "--:--:-- UTC";
  }
  return `${date.toISOString().slice(11, 19)} UTC`;
});

const speedLabel = computed(() => `${props.speed}x`);

const ticks = computed(() => {
  if (!props.startTime || !props.stopTime) {
    return [];
  }

  const labels = [];
  const totalSeconds = JulianDate.secondsDifference(props.stopTime, props.startTime);
  [0, 0.25, 0.5, 0.75, 1].forEach((offset) => {
    const tickTime = JulianDate.addSeconds(props.startTime, totalSeconds * offset, new JulianDate());
    const date = JulianDate.toDate(tickTime);
    labels.push({
      offset,
      label: date.toISOString().slice(5, 16).replace("T", " ")
    });
  });
  return labels;
});

function toDate(value) {
  return value ? JulianDate.toDate(value) : undefined;
}

function scrubTo(percent) {
  emit("scrub", percent);
}
</script>
