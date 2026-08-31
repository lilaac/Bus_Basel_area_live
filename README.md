# Basel Bus/Tram Tracker (prototype)

Shows estimated live positions of Basel BVB/BLT trams and buses on a map.

**Important caveat:** Switzerland's national real-time feed (GTFS-RT, from
[opentransportdata.swiss](https://opentransportdata.swiss)) does **not**
publish raw GPS vehicle positions — only trip delay updates and service
alerts. So this app estimates each vehicle's position by combining the
static published schedule (stop times, straight-line between consecutive
stops) with the live delay for that trip. It's a reasonable approximation,
not true GPS tracking.

## Setup

### 1. Get an API key

1. Register at the [opentransportdata.swiss API Manager](https://api-manager.opentransportdata.swiss/).
2. Subscribe to the GTFS-RT API product to get an API key.
3. Copy `.env.example` to `.env` and set `OTD_API_KEY` to your key.

### 2. Download the static GTFS schedule

The static timetable is a large national dataset, updated twice a week, and
must be downloaded manually (no stable direct-download URL):

1. Go to the [current timetable dataset page](https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020).
2. Click the download button for the most recent `GTFS_FP2026_*.zip` file.
3. Save it as `data/gtfs.zip` in this project (create the `data/` folder if needed).

### 3. Build the filtered Basel dataset

This repo uses [Git LFS](https://git-lfs.com) for the large output file
(`data/basel-stoptimes.ndjson`, ~125MB — over GitHub's 100MB per-file
limit for a normal commit). Install it once (`brew install git-lfs && git
lfs install`) before cloning/pulling, otherwise you'll get a small pointer
file instead of the real data.

```
npm install
npm run prepare-gtfs
```

This filters the national GTFS down to just BVB/BLT routes/trips/stops
active in the next 45 days (see "Known limitations" below for why it's a
rolling window, not the full year) and writes `data/basel-gtfs.json` +
`data/basel-stoptimes.ndjson`. Re-run this whenever you download a fresh
`gtfs.zip`, and periodically (at least every ~45 days) to keep the window
current — commit the two output files afterward if you're running a
deployed copy (see below).

### 4. Run it

```
npm start
```

Open http://localhost:3000 — you should see markers moving along Basel's
tram/bus routes, estimated from schedule + live delay. Click the "Line"
dropdown top-left to filter to a single route; hover a marker for its
direction and current delay.

## Deploying (to share a public link)

The repo already includes a prepared `data/basel-gtfs.json` +
`data/basel-stoptimes.ndjson` (small enough to commit directly — see
"Known limitations" for why they're a rolling window, not the full year),
so a host just needs to `npm install && npm start` — no need to re-run
`prepare-gtfs` on the server itself.

Using [Render](https://render.com) (free tier, no credit card required):

1. Create a Render account and connect your GitHub.
2. New → Blueprint → pick this repo (it'll pick up `render.yaml`
   automatically) — or New → Web Service if you'd rather configure by hand
   (build command `npm install`, start command `npm start`).
3. When prompted, set the `OTD_API_KEY` environment variable to your key.
4. Deploy. You'll get a public URL like `https://basel-bus-tracker.onrender.com`.

Free-tier services sleep after 15 minutes idle and take a few seconds to
wake on the next visit — fine for an occasional-use demo link.

**Remember to refresh the data periodically** (re-run `npm run
prepare-gtfs` locally, commit the two output files, push) or the map will
stop showing vehicles once the rolling window expires.

## How it works

- `src/prepareGtfs.js` — filters the national static GTFS zip to Basel-area
  (BVB/BLT) data only, narrowed to a rolling window of upcoming days to
  keep memory usage low on a free host.
- `src/gtfsStatic.js` — loads that data at startup; stop_times (by far the
  largest part) is stream-parsed line-by-line (NDJSON) rather than one big
  `JSON.parse()`, which otherwise leaves several times the data's actual
  size resident in memory even after garbage collection.
- `src/gtfsRealtime.js` — fetches the GTFS-RT TripUpdates feed (rate-limited
  to 2 requests/minute by the provider).
- `src/interpolate.js` — for each currently-active trip, finds which pair of
  scheduled stops "now" falls between (adjusted for live delay) and
  linearly interpolates a position between them.
- `src/server.js` — Express server exposing `GET /api/vehicles` and
  `GET /api/routes`, polling the realtime feed on demand (per request,
  rate-limited) rather than on a background timer, since free-tier hosts
  suspend the process between requests when idle.
- `public/` — Leaflet map that polls `/api/vehicles` every 5s, with a
  route-badge per vehicle, a hover tooltip (direction + delay), and a line
  filter dropdown backed by `/api/routes`.

## Known limitations (it's a prototype)

- Positions are estimated, not GPS — a vehicle stuck in unexpected traffic
  will still be shown "on schedule" until the next delay update arrives.
- Straight-line interpolation between stops, not the actual street/track
  shape.
- No vehicle-to-vehicle disambiguation if a trip briefly has no active
  service.
- Only a rolling window of upcoming days is kept (`WINDOW_DAYS` in
  `prepareGtfs.js`, default 45) rather than the full year — the full year
  is ~750MB in memory, too much for a free hosting tier's 512MB limit.
  Regenerate periodically (at least every 45 days) to keep the window
  current. 45 was chosen empirically: trip count (and so memory) jumps in
  a staircase as new calendar periods enter the window rather than
  growing smoothly, and 45 days sits right before a jump to a
  meaningfully larger tier (~63k trips / ~370MB RSS vs. ~81k+ trips /
  ~420MB+ RSS beyond ~60 days) — so it's close to the best
  runway-per-MB tradeoff in this dataset, not just a round number.
