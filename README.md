# BuildCart 3D

Android app: type an **item** you want to buy or a **project** you want to build and get

- a shopping list with estimated prices (tick items off as you shop, share it, search stores)
- a **3D model** you can spin, zoom, tap parts, explode and X-ray
- for projects: the build step by step **in 3D** (play the assembly animation)
- "Change it…" to tweak the build with AI (bigger, different material, add a shelf…)
- export the model as `.glb` or save a picture

Uses your own OpenRouter API key with free models (default: `openrouter/free`).

## Get the APK
Every push to `main` builds the APK with GitHub Actions. Download `BuildCart3D.apk` from the latest **Release**.

## Layout
- `web/` — the app UI (HTML/JS, Three.js). `cd web && npm install && ./build.sh` rebuilds `app/src/main/assets/www/`.
- `app/` — Android WebView wrapper (Java) with a native HTTP/share/save bridge.
- `.github/workflows/build-apk.yml` — builds and publishes the signed APK.
