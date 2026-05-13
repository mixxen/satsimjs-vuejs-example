import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteStaticCopy } from "vite-plugin-static-copy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const cesiumBuild = "node_modules/cesium/Build/Cesium";
const base = process.env.VITE_BASE ?? "/";
const normalizedBase = base.endsWith("/") ? base : `${base}/`;
const satsimRoot = path.dirname(require.resolve("satsim/package.json"));
const satsimNodeModules = path.join(satsimRoot, "node_modules");

export default defineConfig({
  root: __dirname,
  base: normalizedBase,
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: path.join(cesiumBuild, "Workers/**/*"), dest: "cesium/Workers", rename: { stripBase: 5 } },
        { src: path.join(cesiumBuild, "Assets/**/*"), dest: "cesium/Assets", rename: { stripBase: 5 } },
        { src: path.join(cesiumBuild, "Widgets/**/*"), dest: "cesium/Widgets", rename: { stripBase: 5 } },
        { src: path.join(cesiumBuild, "ThirdParty/**/*"), dest: "cesium/ThirdParty", rename: { stripBase: 5 } }
      ]
    })
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify(`${normalizedBase}cesium/`)
  },
  resolve: {
    alias: [
      { find: /^cesium$/, replacement: path.resolve(__dirname, "node_modules/cesium") }
    ],
    dedupe: ["cesium"]
  },
  server: {
    fs: {
      allow: [__dirname, satsimRoot, satsimNodeModules]
    }
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 5000
  }
});
