# AsiaHCP

Simple Electron app that captures webcam images and prints them on click.
## Requirements (macOS)

- Node.js (recommended >= 18)
- npm
- Electron (installed via npm install)
- CUPS printing commands available (`lp`, `lpstat`) — included by default on macOS. If missing, install CUPS or enable printing services.
- Allow camera access: System Settings → Privacy & Security → Camera — give the app (when running) permission.

## Setup

1. Clone or copy the project to your machine.

2. Open terminal and go to project folder:
   cd /path/to/project

3. Install dependencies:
   npm install

4. Run the app in development:
   npm start

   The app will open a window showing the camera preview. Use "Change Settings" to select printer and camera. Click anywhere (except settings/pause) to capture and print.

## Packaging

Build a macOS DMG / ZIP (requires electron-builder):
1. Install dev dependencies (already listed in package.json).
2. Run:
   npm run build

Note: For distribution on macOS you may need to codesign and notarize the app.

## Troubleshooting

- No printers detected:
  - Ensure CUPS is available. Run `lpstat -p` and `lpstat -d` in Terminal to verify.
  - You can enter a printer name manually (exact queue name).

- Camera error / permission:
  - Grant camera permission in macOS System Settings.
  - If the camera doesn't show a friendly label, try running once and check System Settings → Privacy.

- If printing fails, inspect the app terminal output. The native printing uses `lp -d "<printer>" -o fit-to-page <file>`.

## Files of interest

- main.js — Electron main process (printer detection, native print)
- renderer.js — UI, webcam capture, B/W toggle, print flow
- index.html — UI
- .gitignore — ignores node_modules and build artifacts