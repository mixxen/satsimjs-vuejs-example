<template>
  <div
    v-if="reticle.visible"
    class="selection-reticle"
    :style="{
      left: `${reticle.x}px`,
      top: `${reticle.y}px`,
      width: `${reticle.size}px`,
      height: `${reticle.size}px`
    }"
    aria-hidden="true"
  >
    <span class="selection-reticle-ring selection-reticle-ring-inner"></span>
    <span class="selection-reticle-ring selection-reticle-ring-outer"></span>
    <span class="selection-reticle-tick selection-reticle-tick-left"></span>
    <span class="selection-reticle-tick selection-reticle-tick-right"></span>
    <span class="selection-reticle-tick selection-reticle-tick-top"></span>
    <span class="selection-reticle-tick selection-reticle-tick-bottom"></span>
  </div>
</template>

<script setup>
import { onBeforeUnmount, reactive, watch } from "vue";
import { Cartesian2, Cartesian3, SceneTransforms } from "cesium";
import { getObjectPositionInCesiumFrame } from "satsim/src/engine/cesium/utils.js";

const props = defineProps({
  target: {
    default: undefined
  },
  universe: {
    default: undefined
  },
  viewer: {
    default: undefined
  }
});

const reticle = reactive({
  visible: false,
  x: 0,
  y: 0,
  size: 34
});

const scratchPosition = new Cartesian3();
const scratchWindow = new Cartesian2();
let removePostRender;

watch(
  () => props.viewer,
  (viewer) => {
    removePostRenderListener();
    if (viewer?.scene?.postRender) {
      removePostRender = viewer.scene.postRender.addEventListener(updateReticle);
      updateReticle();
    }
  },
  { immediate: true }
);

watch(
  () => props.target,
  () => {
    updateReticle();
  }
);

function updateReticle() {
  const viewer = props.viewer;
  const universe = props.universe;
  const object = props.target?.site ?? props.target;
  if (!viewer || !universe || !object || viewer.cameraMode === "up") {
    hideReticle();
    return;
  }

  try {
    const time = viewer.clock.currentTime;
    object.update?.(time, universe, false, true, false);
    const worldPosition = getObjectPositionInCesiumFrame(viewer, universe, object, time, scratchPosition);
    const screenPosition = SceneTransforms.worldToWindowCoordinates(viewer.scene, worldPosition, scratchWindow);
    const canvas = viewer.scene.canvas;

    if (
      !screenPosition ||
      !Number.isFinite(screenPosition.x) ||
      !Number.isFinite(screenPosition.y) ||
      screenPosition.x < -32 ||
      screenPosition.y < -32 ||
      screenPosition.x > canvas.clientWidth + 32 ||
      screenPosition.y > canvas.clientHeight + 32
    ) {
      hideReticle();
      return;
    }

    reticle.x = screenPosition.x;
    reticle.y = screenPosition.y;
    reticle.size = getReticleSize(props.target);
    reticle.visible = true;
  } catch {
    hideReticle();
  }
}

function getReticleSize(target) {
  const entity = target?.visualizer ?? target?.site?.visualizer;
  const pointSize = Number(entity?.point2?.pixelSize ?? 6);
  const radius = Math.max(pointSize / 2, 6);
  return Math.ceil((radius + 12) * 2);
}

function hideReticle() {
  reticle.visible = false;
}

function removePostRenderListener() {
  if (removePostRender) {
    removePostRender();
    removePostRender = undefined;
  }
}

onBeforeUnmount(removePostRenderListener);
</script>
