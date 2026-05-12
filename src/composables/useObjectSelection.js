import { ref, shallowRef } from "vue";
import { Cartesian3, Color, Ellipsoid, JulianDate, ReferenceFrame } from "cesium";
import { getObjectPositionInCesiumFrame } from "satsim/src/engine/cesium/utils.js";
import { getVisibility } from "satsim/src/engine/geometry/visibility.js";

const EARTH_MEAN_RADIUS_METERS = 6371008.8;
const LABEL_FONT = "14px sans-serif";
const MIN_DISPLAY_VELOCITY_MPS = 0.01;
const VELOCITY_SAMPLE_SECONDS = 0.5;

/**
 * Public selected-object controller for the Vue shell.
 *
 * This is the only module that should translate SatSimJS/Cesium object state
 * into Vue sidebar state. Keep raw SatSimJS objects out of presentational
 * components; pass them the normalized `selectedObjectDetails` model instead.
 */
export function useObjectSelection({ viewerRef, universeRef, activeMode, layerState }) {
  const selectedObject = shallowRef(null);
  const selectedObjectDetails = ref(undefined);

  function installObjectPicker(viewer) {
    viewer.objectPickListener = (picked) => {
      if (!picked) {
        clearSelectedObject();
        return;
      }

      selectObject(picked);
    };
  }

  function selectObject(object) {
    const viewer = viewerRef.value;
    const entity = getObjectEntity(object);
    selectedObject.value = object;

    if (viewer) {
      viewer.selectedEntity = entity;
      viewer.pickedObject = object;
      viewer.lastPicked = object;
    }

    refreshSelectedObjectDetails();
  }

  function clearSelectedObject() {
    const viewer = viewerRef.value;
    selectedObject.value = null;
    selectedObjectDetails.value = undefined;

    if (viewer) {
      viewer.selectedEntity = undefined;
      viewer.pickedObject = undefined;
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

    const label = ensureObjectLabel(object, entity, viewer, universe);
    label.show = enabled;
    label.position = getObjectPositionInCesiumFrame(viewer, universe, object, viewer.clock.currentTime);
    refreshSelectedObjectDetails();
  }

  function releaseTrackedCamera() {
    const viewer = viewerRef.value;
    if (viewer) {
      viewer.trackedEntity = undefined;
    }
  }

  function refreshSelectedObjectState(object, time) {
    const universe = universeRef.value;
    if (!universe || !time) {
      return;
    }

    for (const candidate of [object, object?.site]) {
      candidate?.update?.(time, universe, true, true, true);
    }
  }

  function isTrackableObject(object) {
    return (universeRef.value?._trackables ?? []).includes(object);
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

  /**
   * Sidebar view-model shape. Add new object facts here, not in the component.
   */
  function buildObjectSections(object, time) {
    return [
      createRowsSection("Orbit", buildOrbitRows(object)),
      createRowsSection("State Vector", buildStateRows(object, time)),
      createRowsSection("Location", buildLocationRows(object)),
      createRowsSection("Model", buildModelRows(object?.model)),
      createLinesSection("Source TLE", buildTleLines(object))
    ].filter(Boolean);
  }

  /**
   * State-vector rows are computed from the physical object, not the display
   * wrapper, so observatories use their site and satellites use their orbiting
   * object.
   */
  function buildStateRows(object, time) {
    const rows = [];
    const positionObject = getPhysicalObject(object);
    const worldPosition = readCartesian(() => positionObject.worldPosition);

    if (worldPosition) {
      rows.push({ label: "ECI Position", value: formatCartesianKm(worldPosition) });
      if (isOrbitingObject(positionObject)) {
        rows.push({ label: "Altitude", value: formatAltitudeMeters(calculateAltitudeMeters(worldPosition, time)) });
      }
    }

    const worldVelocity = readWorldVelocity(positionObject, time);
    if (worldVelocity) {
      rows.push({ label: "ECI Velocity", value: formatCartesianKm(worldVelocity, "km/s", 3) });
    }

    return rows;
  }

  function readWorldVelocity(object, time) {
    const directVelocity = normalizeVelocityMetersPerSecond(readCartesian(() => object.worldVelocity), object);
    if (directVelocity && Cartesian3.magnitude(directVelocity) > MIN_DISPLAY_VELOCITY_MPS) {
      return directVelocity;
    }

    return estimateWorldVelocity(object, time) ?? directVelocity;
  }

  /**
   * Lagrange-wrapped satellites interpolate position but do not expose velocity.
   * Derive velocity from nearby interpolated ECI positions instead of forcing
   * SGP4 propagation.
   */
  function estimateWorldVelocity(object, time) {
    const universe = universeRef.value;
    if (!universe || !time || !isOrbitingObject(object) || typeof object?.update !== "function") {
      return undefined;
    }

    const beforeTime = JulianDate.addSeconds(time, -VELOCITY_SAMPLE_SECONDS, new JulianDate());
    const afterTime = JulianDate.addSeconds(time, VELOCITY_SAMPLE_SECONDS, new JulianDate());
    const beforePosition = new Cartesian3();
    const afterPosition = new Cartesian3();

    try {
      object.update(beforeTime, universe, true, true, false);
      Cartesian3.clone(object.worldPosition, beforePosition);
      object.update(afterTime, universe, true, true, false);
      Cartesian3.clone(object.worldPosition, afterPosition);

      return Cartesian3.divideByScalar(
        Cartesian3.subtract(afterPosition, beforePosition, new Cartesian3()),
        VELOCITY_SAMPLE_SECONDS * 2,
        new Cartesian3()
      );
    } finally {
      object.update(time, universe, true, true, true);
    }
  }

  /**
   * Prefer WGS84 altitude through the current Earth transform; fall back to mean
   * spherical Earth only when the transform path is unavailable.
   */
  function calculateAltitudeMeters(worldPosition, time) {
    const universe = universeRef.value;
    if (universe?.earth && time) {
      universe.earth.update(time, universe, true, true, false);
      const fixedPosition = universe.earth.transformPointFromWorld(worldPosition, new Cartesian3());
      const cartographic = Ellipsoid.WGS84.cartesianToCartographic(fixedPosition);
      if (Number.isFinite(cartographic?.height)) {
        return cartographic.height;
      }
    }

    return Cartesian3.magnitude(worldPosition) - EARTH_MEAN_RADIUS_METERS;
  }

  /**
   * Keeps the Vue sidebar aligned with SatSimJS' visibility model without
   * rendering legacy Cesium InfoBox HTML.
   */
  function buildVisibilityDetails(object, time) {
    const viewer = viewerRef.value;
    const universe = universeRef.value;
    const observatories = universe?._observatories ?? [];
    if (!viewer || !universe || !isTrackableObject(object) || !observatories.length) {
      return undefined;
    }

    refreshVisibilityContext(time);
    const rows = getVisibility(universe, viewer, observatories, object);
    const visibleCount = rows.filter((row) => row.visible).length;
    return {
      summary: `${visibleCount} / ${rows.length} sensors visible`,
      rows: rows.map(formatVisibilityRow)
    };
  }

  function refreshVisibilityContext(time) {
    const universe = universeRef.value;
    if (!universe || !time) {
      return;
    }

    for (const object of [universe.earth, universe.sun]) {
      object?.update?.(time, universe, true, true, false);
    }

    for (const observatory of universe._observatories ?? []) {
      observatory?.site?.update?.(time, universe, true, true, false);
    }
  }

  return {
    selectedObject,
    selectedObjectDetails,
    clearSelectedObject,
    focusTrackSelectedObject,
    installObjectPicker,
    refreshSelectedObjectDetails,
    releaseTrackedCamera,
    setSelectedObjectLabel,
    setSelectedObjectTrace
  };
}

function getObjectEntity(object) {
  return object?.visualizer ?? object?.site?.visualizer;
}

function getPhysicalObject(object) {
  return object?.site ?? object;
}

function getObjectType(object) {
  if (object?.displayType) {
    return object.displayType;
  }
  if (object?.tle || isOrbitingObject(object)) {
    return "Satellite";
  }
  if (object?.site && object?.gimbal) {
    return "Ground Observatory";
  }
  if (Number.isFinite(object?.latitude) && Number.isFinite(object?.longitude)) {
    return "Ground Site";
  }

  const constructorName = object?.constructor?.name;
  return constructorName ? constructorName.replace(/([a-z])([A-Z])/g, "$1 $2") : "Object";
}

function hasObjectPathCapability(object) {
  const entity = object?.visualizer;
  return !!entity && (!!entity.path || !!entity._satsimDeferredPathOptions);
}

/**
 * SatSimJS can defer label creation for performance. The Vue toggle creates the
 * same label primitive lazily, then lets normal object update listeners move it.
 */
function ensureObjectLabel(object, entity, viewer, universe) {
  if (object.visualizer.label2) {
    return object.visualizer.label2;
  }

  const label = viewer.labels.add({
    text: object.name,
    font: LABEL_FONT
  });
  label.id = entity;
  label.update = (time, activeUniverse) => {
    label.position = getObjectPositionInCesiumFrame(viewer, activeUniverse, object, time);
    updateLabelOpacity(label, viewer);
  };

  object.visualizer.label2 = label;
  object.updateListeners.push(label);
  label.position = getObjectPositionInCesiumFrame(viewer, universe, object, viewer.clock.currentTime);
  return label;
}

function updateLabelOpacity(label, viewer) {
  if (!viewer.labelsOn || viewer.cameraMode === "up" || !viewer.camera.positionWC || !label.position) {
    return;
  }

  const distanceSquared = Cartesian3.distanceSquared(viewer.camera.positionWC, label.position);
  const inRange = distanceSquared < viewer.labelDistanceThresholdMetersSq;
  label.show = inRange;

  if (!inRange) {
    return;
  }

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

function createRowsSection(title, rows) {
  return rows.length ? { title, rows } : undefined;
}

function createLinesSection(title, lines) {
  return lines.length ? { title, lines } : undefined;
}

function buildOrbitRows(object) {
  return [
    Number.isFinite(object?.period)
      ? { label: "Period", value: `${(object.period / 60).toFixed(2)} min` }
      : undefined,
    Number.isFinite(object?.eccentricity)
      ? { label: "Eccentricity", value: object.eccentricity.toFixed(7) }
      : undefined
  ].filter(Boolean);
}

function buildLocationRows(object) {
  const geoObject = getPhysicalObject(object);
  return [
    Number.isFinite(geoObject?.latitude)
      ? { label: "Latitude", value: `${geoObject.latitude.toFixed(4)} deg` }
      : undefined,
    Number.isFinite(geoObject?.longitude)
      ? { label: "Longitude", value: `${geoObject.longitude.toFixed(4)} deg` }
      : undefined,
    Number.isFinite(geoObject?.altitude)
      ? { label: "Altitude", value: `${geoObject.altitude.toFixed(0)} m` }
      : undefined
  ].filter(Boolean);
}

function buildModelRows(model) {
  if (!model || typeof model !== "object") {
    return [];
  }

  return Object.entries(model).map(([key, value]) => ({
    label: toTitleLabel(key),
    value: Number.isFinite(value) ? String(value) : String(value ?? "--")
  }));
}

function buildTleLines(object) {
  const tle = object?.tle;
  return tle?.line1 && tle?.line2 ? [tle.line1, tle.line2] : [];
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

function isOrbitingObject(object) {
  return Number.isFinite(object?.period) || !!object?.tle;
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
  const value = getter();
  return Number.isFinite(value?.x) && Number.isFinite(value?.y) && Number.isFinite(value?.z)
    ? value
    : undefined;
}

function formatCartesianKm(cartesian, units = "km", decimals = 1) {
  return [cartesian.x / 1000, cartesian.y / 1000, cartesian.z / 1000]
    .map((value) => value.toFixed(decimals))
    .join(", ") + ` ${units}`;
}

function formatFinite(value, decimals, suffix = "", divisor = 1) {
  return Number.isFinite(value) ? `${(value / divisor).toFixed(decimals)}${suffix}` : "--";
}

function formatAltitudeMeters(value) {
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value.toFixed(0)} m`;
}

function toTitleLabel(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
