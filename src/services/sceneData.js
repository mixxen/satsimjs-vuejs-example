import { Cartesian3, Color, JulianDate, defined } from "cesium";
import { southEastZenithToAzEl } from "satsim/src/engine/dynamics/gimbal.js";
import {
  generateGroundObservatoryVisualizer,
  generateSatelliteVisualizer
} from "satsim/src/engine/cesium/ObjectVisulaizer.js";
import { getObservatorySensors } from "satsim/src/engine/objects/observatoryUtils.js";

export const DEFAULT_SATELLITE_LIMIT = Number.POSITIVE_INFINITY;

function publicPath(path) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function modelDescription(model) {
  return Object.entries(model)
    .map(([key, value]) => `&bull; ${escapeHtml(key)}: ${escapeHtml(value)}<br>`)
    .join("");
}

function collectSensorOptions(observatories) {
  const sensors = [];
  observatories.forEach((observatory, observatoryIndex) => {
    getObservatorySensors(observatory).forEach((sensor, sensorIndex) => {
      sensors.push({
        id: `${observatoryIndex}-${sensorIndex}`,
        name: sensor.name ?? `${observatory.site?.name ?? "Sensor"} ${sensorIndex + 1}`,
        observatoryName: observatory.site?.name ?? observatory.name ?? "Observatory",
        sensor
      });
    });
  });
  return sensors;
}

export async function loadDemoScene(universe, viewer, options = {}) {
  const maxSatellites = options.maxSatellites ?? DEFAULT_SATELLITE_LIMIT;
  const observatories = await loadSensors(universe, viewer, publicPath("assets/sites.json"));
  const satellites = await loadSatellites(universe, viewer, publicPath("assets/celestrak_sat_elem.txt"), {
    maxSatellites
  });

  universe.update(viewer.clock.currentTime);
  observatories.forEach((observatory) => {
    randomTrack(universe, viewer, observatory, viewer.clock.currentTime);
  });

  return {
    observatoryCount: observatories.length,
    satelliteCount: satellites.length,
    sensors: collectSensorOptions(observatories)
  };
}

async function loadSensors(universe, viewer, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load sensors from ${url}: ${response.status}`);
  }

  const sites = await response.json();
  const observatories = sites.map((site) => {
    const observatory = universe.addGroundElectroOpticalObservatory(
      site.name,
      site.latitude,
      site.longitude,
      site.altitude,
      "AzElGimbal",
      site.height,
      site.width,
      site.y_fov,
      site.x_fov,
      site.field_of_regard
    );
    generateGroundObservatoryVisualizer(universe, viewer, observatory);
    observatory.gimbal.trackMode = "rate";
    return observatory;
  });

  return observatories;
}

async function loadSatellites(universe, viewer, url, options = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load satellites from ${url}: ${response.status}`);
  }

  const maxSatellites = options.maxSatellites ?? DEFAULT_SATELLITE_LIMIT;
  const lines = (await response.text()).split(/\r?\n/);
  const satellites = [];

  for (let i = 0; i + 2 < lines.length && satellites.length < maxSatellites; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1]?.trim();
    const line2 = lines[i + 2]?.trim();

    if (!name || !line1 || !line2 || universe.hasObject(name)) {
      continue;
    }

    const satellite = universe.addSGP4Satellite(name, line1, line2, "nadir", true);
    satellite.tle = { name, line1, line2 };
    satellite.model = {
      mode: "lambertianSphere",
      diameter: 1.0,
      albedo: 0.25
    };

    const description = `TLE:<br>${escapeHtml(line1)}<br>${escapeHtml(line2)}<br><br>Model:<br>${modelDescription(satellite.model)}`;
    generateSatelliteVisualizer(universe, viewer, satellite, description, false, false, Color.fromRandom({ alpha: 1.0 }));
    satellites.push(satellite);
  }

  return satellites;
}

function randomTrack(universe, viewer, observatory, time, maxIterations = 500) {
  const trackables = universe._trackables ?? [];
  if (!trackables.length || !observatory?.gimbal) {
    return;
  }

  showTrackedPath(viewer, observatory.gimbal, false);

  const localPosition = new Cartesian3();
  let iterations = maxIterations;
  while (iterations > 0) {
    const object = trackables[Math.floor(Math.random() * trackables.length)];
    if (defined(object)) {
      observatory.site.transformPointFromWorld(object.worldPosition, localPosition);
      const [, elevation] = southEastZenithToAzEl(localPosition);
      if (object.period < 2000 * 60 && elevation > 30) {
        observatory.gimbal.trackObject = object;
        observatory.gimbal.update(time, universe);
        showTrackedPath(viewer, observatory.gimbal, true);
        return;
      }
    }
    iterations -= 1;
  }
}

function showTrackedPath(viewer, gimbal, show) {
  const trackObject = gimbal?.trackObject;
  if (!defined(trackObject?.visualizer) || !viewer) {
    return;
  }

  if (typeof viewer.setObjectPathEnabled === "function" && viewer.setObjectPathEnabled(trackObject, show)) {
    return;
  }

  const visualizer = trackObject.visualizer;
  if (!defined(visualizer.path) && show) {
    const color = defined(visualizer.point2) ? visualizer.point2.color : Color.WHITE;
    visualizer.path = {
      leadTime: trackObject.period / 2,
      material: color,
      resolution: trackObject.period / (500 / (1 - trackObject.eccentricity)),
      show: true,
      trailTime: trackObject.period / 2,
      width: 1
    };
  } else if (defined(visualizer.path)) {
    visualizer.path.show = show;
  }
}
