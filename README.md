# Transportation Cost Calculator

Sydney-focused commute comparison app with no API key required.

## What the finalized project does

- Compares `car vs public transport`
- Includes a second in-app page that shows the fixed toll and transit assumptions
- Suggests Sydney suburbs as you type for home and work
- Uses live browser-side services for:
  - address geocoding via `Nominatim`
  - driving distance and travel time via `OSRM`
- Estimates:
  - Sydney toll costs from detected toll roads and current public Class A toll caps
  - public transport fare, time, transfers, and walking using Sydney-specific heuristics
- Lets you tune:
  - fuel efficiency
  - fuel price
  - parking cost
  - workdays per week
  - departure time

## Why there is no Google key anymore

The project has been finalized as a zero-setup browser app. That means:

- no `.env` file
- no API key
- no paid third-party dependency

The tradeoff is that public transport is now an estimate rather than a live timetable result.

## Stack

- `React`
- `TypeScript`
- `Vite`
- `Nominatim`
- `OSRM`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Start the dev server:

```bash
npm run dev
```

3. Build for production:

```bash
npm run build
```

4. Preview the production build:

```bash
npm run preview
```

## Accuracy notes

- Driving distance and travel time are live.
- Toll totals are estimates, not official trip-by-trip billing.
- Public transport results are estimates, not live TfNSW trip plans.
- This app is best used for rough comparison and budgeting.
- The assumptions page in the app shows the exact fixed numbers currently used.

## Toll estimate basis

Sydney toll estimates are based on detected toll-road names within returned driving route steps, then matched to current public passenger-vehicle toll caps published by Linkt.

## Hosting

The app is static and GitHub Pages-friendly.

- `GitHub Pages`: simplest option
- `Netlify` or `Vercel`: also fine
- local only: run with `npm run dev`

`vite.config.ts` already uses a relative base path, which helps for GitHub Pages deployments.

## GitHub Pages deployment

This repo includes a GitHub Actions workflow at `.github/workflows/deploy.yml`.

After pushing the project to a public GitHub repository:

1. Open the repository on GitHub.
2. Go to `Settings` > `Pages`.
3. Set the source to `GitHub Actions`.
4. Push to `main`.

The workflow will build the app and publish it to GitHub Pages automatically.
