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

```
npm install
npm run prepare-gtfs
```

This filters the national GTFS down to just BVB/BLT routes/trips/stops and
writes `data/basel-gtfs.json`. Re-run this whenever you download a fresh
`gtfs.zip`.

### 4. Run it

```
npm start
```

Open http://localhost:3000 — you should see markers moving along Basel's
tram/bus routes, estimated from schedule + live delay.

## How it works

- `src/prepareGtfs.js` — filters the national static GTFS zip to Basel-area
  (BVB/BLT) data only.
- `src/gtfsRealtime.js` — polls the GTFS-RT TripUpdates feed (rate-limited
  to 2 requests/minute by the provider; we poll every 40s).
- `src/interpolate.js` — for each currently-active trip, finds which pair of
  scheduled stops "now" falls between (adjusted for live delay) and
  linearly interpolates a position between them.
- `src/server.js` — Express server exposing `GET /api/vehicles` and serving
  the frontend.
- `public/` — Leaflet map that polls `/api/vehicles` every 5s.

## Known limitations (it's a prototype)

- Positions are estimated, not GPS — a vehicle stuck in unexpected traffic
  will still be shown "on schedule" until the next delay update arrives.
- Straight-line interpolation between stops, not the actual street/track
  shape.
- No vehicle-to-vehicle disambiguation if a trip briefly has no active
  service.
