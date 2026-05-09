<template>
  <aside class="status-strip" aria-label="Scene status">
    <span class="fps">{{ fps }} FPS</span>
    <span class="divider"></span>
    <span>{{ satelliteCount }} sats</span>
  </aside>
</template>

<script setup>
defineProps({
  fps: {
    type: Number,
    required: true
  },
  satelliteCount: {
    type: Number,
    required: true
  }
});
</script>
