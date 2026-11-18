# BuildCart 3D

Android app: type, say or photograph an **item** you want to buy or a **project** you want to build and get a priced shopping list plus an interactive **3D model**. Uses your own OpenRouter key with free models.

## Features
- **Input:** text, voice (mic), photo (camera/gallery), "surprise me" ideas, Auto/Item/Project mode, details + budget
- **AI:** live streaming progress, automatic fallback across free models, daily free-request counter
- **3D:** spin/zoom, tap parts, recolour parts, isolate, parts list, camera views (front/side/top), measuring tape, X-ray, explode, realistic lighting
- **Build steps in 3D:** step slider, play animation, ghost future parts, camera follows each step
- **Shopping list:** tick off, edit/add/delete items, hide got items, cost breakdown by category, store search, share/copy
- **Cut list** for timber projects (+ total lengths with waste allowance)
- **All-builds shopping tab** that merges every build's remaining items
- **Change it** with AI + **Undo** and version history; **Improve 3D model** button
- **Ask tab:** chat with AI about the build
- **Steps:** mark done, progress, screen stays awake
- **Info:** rename, notes, duplicate, send build file to a friend, STL (3D print) and GLB export
- **Settings:** paste key, test key, free model picker (📷 = photo-capable), backup/restore builds

## Get the APK
Every push to `main` builds the APK with GitHub Actions — download `BuildCart3D.apk` from the latest **Release**.

## Layout
- `web/` — app UI (HTML/JS, Three.js). `cd web && npm install && ./build.sh` rebuilds `app/src/main/assets/www/`.
- `app/` — Android WebView wrapper (Java) with native bridge (HTTP streaming, camera/photo picker, voice input, share, save, keep-awake).
- `.github/workflows/build-apk.yml` — builds and publishes the APK.
