# Deep School

A real-time underwater fish-school game for iPhone and iPad, built on
[imokya/threejs-fish](https://github.com/imokya/threejs-fish) — a three.js
WebGPU boids simulation with GPU compute, volumetric light shafts and
procedural sardines — and packaged as a native iOS app with
[Capacitor](https://capacitorjs.com).

## Modes

- **Hunt.** You're a reef shark. Drag anywhere to steer and hold **DASH** to
  sprint (it drains the stamina ring). Eat as many sardines as you can in 60
  seconds. Catches in quick succession build a streak, and every 8 in a row
  raises the score multiplier, up to ×5. **Golden fish** are worth 10 points
  and add 3 seconds. The school notices you more as the round goes on.
- **Zen.** The original cinematic experience. Swipe to scatter the school,
  tap for a shockwave, pinch to zoom.

There are haptics on every catch, a synthesized underwater soundscape (no
audio files), and your best score is saved on the device. The round pauses
automatically when the app goes to the background.

Desktop controls for testing: WASD or arrow keys to steer, Space or Shift to
dash, Esc or P to pause.

## Requirements

- **iOS / iPadOS 26 or later.** The simulation runs on WebGPU compute shaders,
  which the iOS web view only supports from iOS 26. The Xcode project's
  deployment target is set to 26.0. The game won't run on older iOS versions:
  WebGL has no equivalent of the atomics and workgroup memory it uses.
- A Mac with **Xcode 26+** and Node.js 22+.
- An Apple ID. A free account can install on your own device. A paid Apple
  Developer account is needed for TestFlight or the App Store.

## Run it on your iPhone

```bash
npm install
npm run ios          # builds the web bundle, syncs it into ios/, opens Xcode
```

In Xcode:

1. Select the **App** target, open **Signing & Capabilities**, and pick your
   Team. If `com.kmans106.deepschool` is taken, change the bundle identifier.
2. Plug in your iPhone (or pick it under wireless devices) and press **Run**.
3. The first time, approve the developer profile on the phone under
   Settings → General → VPN & Device Management.

After changing any web code, run `npm run sync` (build plus copy into the
iOS project) and press Run again.

## Develop in the browser

```bash
npm run dev
```

Open the printed URL in a WebGPU browser: Chrome or Edge 113+, or Safari
26+. Useful URL parameters:

| Parameter | Effect |
| --- | --- |
| `?n=4096` | number of fish (default 3072 on phones, 6144 on desktop) |
| `?panel` | show the original look-tuning panel (H to hide) |
| `?shot=backlit` | lock the Zen camera to one shot (`orbit`, `glide`, `backlit`, `low`) |
| `?debug` | expose internals on `window.__debug` |

## Project layout

| Path | What's there |
| --- | --- |
| `src/game.js` | Hunt mode: shark physics, chase camera, stamina, scoring, combos, GPU readback of catches |
| `src/predator.js` | Procedural shark mesh with a swimming tail wave and a gulp animation |
| `src/controls.js` | Floating thumb-stick, dash button, keyboard |
| `src/audio.js` | Web Audio soundscape and effects |
| `src/native.js` | Capacitor Haptics and Preferences, with browser fallbacks |
| `src/boids.js` | GPU boids, plus the hunt additions: flee from the predator, eat, respawn, atomic catch counters |
| `src/fish.js` | Instanced sardines, plus the golden-fish variant |
| `src/main.js` | Renderer setup, game state machine, Zen-mode interaction |
| `src/{choreography,events,environment,ocean,post,panel}.js` | Upstream scene, camera director, effects |
| `ios/` | Capacitor Xcode project (Swift Package Manager) |

## Credits and license

The simulation, rendering and environment code comes from
[imokya/threejs-fish](https://github.com/imokya/threejs-fish). That repository
doesn't include a license, which means its author keeps all rights. Get the
author's permission before you distribute this app, for example through
TestFlight or the App Store.
