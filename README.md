# SatSimJS Vue Prototype

Standalone Vue 3 + Vite prototype for SatSimJS. It imports the local SatSimJS
source from this repository and keeps all Vue controls outside the Cesium
canvas.

```sh
npm install
npm run dev -- --host 0.0.0.0
```

The demo loads all bundled sites and TLE satellites from `public/assets`.

## GitHub Pages

This app can be deployed by `.github/workflows/deploy-pages.yml` after this
folder is pushed as its own GitHub repository. The workflow checks out the
SatSimJS source beside the Vue app, then builds with:

```sh
SATSIMJS_ROOT=.satsimjs VITE_BASE=/${GITHUB_REPOSITORY#*/}/ npm run build
```

That keeps Vite and Cesium asset URLs valid for a repository Pages URL.
