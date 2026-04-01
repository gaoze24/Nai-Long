# Nai-Long

Responsive web app that mimics a mobile-style portrait player UI with a centered character video, a large play/pause action button, and optional external audio synchronization.

## Architecture (GitHub Pages Friendly)

All deployable web files now live under `docs/`, which makes this repository easy to publish with GitHub Pages.

```
.
├── .github/workflows/deploy-pages.yml
├── README.md
└── docs/
	├── index.html
	├── styles.css
	├── app.js
	├── .nojekyll
	└── assets/
```

## Files

- `docs/index.html`: app structure and controls.
- `docs/styles.css`: responsive portrait layout and polished visual styling.
- `docs/app.js`: media playback logic, loading/error states, settings behavior, and video/audio sync.
- `docs/assets/`: place media files here.
- `.github/workflows/deploy-pages.yml`: automatic deploy workflow for GitHub Pages.

## Run Locally

Use any static server from the repository root. Example with Python:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/docs/` in your browser.

## Deploy to GitHub Pages

### Option 1 (Recommended): GitHub Actions Workflow

1. Push this repo to GitHub.
2. Go to **Settings > Pages**.
3. In **Build and deployment**, set **Source** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from the Actions tab).

The workflow publishes the `docs/` folder automatically.

### Option 2: Branch + /docs Folder

1. Go to **Settings > Pages**.
2. Set **Source** to **Deploy from a branch**.
3. Select branch `main` and folder `/docs`.
4. Save.

## Replace Media Assets

Put your files in `docs/assets/` and keep these names, or update paths in `docs/app.js`:

- `./assets/character.mp4`
- `./assets/character-audio.mp3`

The paths are configured in `MEDIA_CONFIG` at the top of `docs/app.js`.

## Behavior

- No autoplay on page load.
- Main button toggles play/pause.
- If external audio is enabled, the app mutes video audio and syncs the separate track.
- If external audio fails, playback gracefully falls back to video audio.

## Quick Test Checklist

1. Load page and confirm media does not autoplay.
2. Click/tap Play and confirm video starts.
3. Click/tap again and confirm pause state.
4. Scrub/seek video and confirm sync remains stable when separate audio is enabled.
5. Temporarily break media path to confirm fallback error messaging.