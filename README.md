# Runasis

Runasis is an unofficial running dashboard for Strava. It brings your running history into a local app, then turns it into clear summaries, personal-best charts, and race-time projections.

It is built for runners who want to understand their own training history without uploading their data to another service. Your Strava API credentials, tokens, and activity data are saved only on your own machine and are not sent to any external server by Runasis.

## What You Can See

- Total distance, runs, moving time, and elevation gain
- Recent running volume for the last 7, 30, 90, 180, or 365 days
- Cumulative progress over time
- Weekly running trends
- Distance distribution, longest runs, and recent activities
- Personal bests by distance from Strava best-effort data
- Personal-best timing and trend charts
- Riegel race projections for comparing 5K, 10K, half-marathon, marathon, and other distances

## Before You Start

You need:

- Node.js 18 or newer
- A Strava account
- A Strava API application

Runasis uses your own Strava API app. This lets the app connect to your account from your computer and save the results locally.

## Start Runasis

On macOS, double-click:

```text
Runasis.command
```

This starts Runasis, opens it in your browser, and keeps it running until you close the terminal window or press `Ctrl+C`.

You can also start it from a terminal:

```bash
npm start
```

Then open the URL printed by the server, usually:

```text
http://localhost:3000
```

If port `3000` is already in use, Runasis automatically tries the next available port.

## Connect Strava

1. Go to Strava `Settings > My API Application`.
2. Create or open your API application.
3. Set `Authorization Callback Domain` to `localhost`.
4. Start Runasis.
5. Enter your Strava Client ID and Client Secret in the setup panel.
6. Click `Save Settings`.
7. Click `Connect Strava` and approve the connection.
8. Click `Sync` to import your activity list.
9. Click `Best Efforts` to fetch the detailed run data used for personal bests and race projections.

The first full sync can take a little while if you have years of activities. `Best Efforts` fetches detailed run records in batches, so you can click it again later if Runasis says there are more remaining.

## Using Runasis

### Dashboard

The dashboard is the main training overview. Use the range selector to switch between all-time, the last year, the last 6 months, the last 90 days, the last 30 days, or the last 7 days.

The metric cards change the main chart between distance, activity count, moving time, and elevation gain. Below that, Runasis shows weekly trends, distance distribution, your longest runs, and your most recent activities.

### Personal Bests

The `Personal Bests` tab compares your best efforts across distances. It shows:

- Pace curve by distance
- When your personal bests happened
- Whether your best efforts at a chosen distance are improving over time
- Ranked efforts for each distance

This page depends on detailed Strava activity data, so run `Best Efforts` after your first sync.

### Analysis

The `Analysis` tab estimates how your performances compare across race distances. It uses the Riegel model, a common race-time projection method, to ask questions like:

- What does my 5K suggest for 10K or half-marathon?
- Which distances are stronger or weaker compared with my other results?
- Am I holding pace well as race distance increases?

You can use the default Riegel exponent, let Runasis estimate one from your own best efforts, or set a custom value.

## Local Data

Runasis saves data in this project folder:

```text
data/strava/
```

This includes your Strava connection token, activity list, detailed run records, and generated personal-best data. These files are ignored by Git.

To remove the saved Strava connection and activity data, click `Clear Data` in the app. You will need to connect Strava and sync again after clearing data.

Your Strava Client ID and Client Secret are saved in:

```text
.env
```

That file is also ignored by Git.

## macOS App Wrapper

Runasis also includes an optional macOS app wrapper. You only need this if you want an app window instead of opening the browser yourself.

Build it with:

```bash
scripts/build-macos-app.sh
```

Then open `Runasis.app` in Finder from this project folder. Closing the app window stops the local server.

Rebuilding the wrapper requires Xcode Command Line Tools.

## Development

Run the app:

```bash
npm start
```

Run tests:

```bash
npm test
```

Runasis currently uses Node.js built-ins only, so there are no package dependencies to install.
