import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { loadStaticGtfs } from './gtfsStatic.js';
import { fetchTripDelays } from './gtfsRealtime.js';
import { computeVehiclePositions } from './interpolate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.OTD_API_KEY;

// opentransportdata.swiss GTFS-RT is rate-limited to 2 requests/minute;
// polling every 40s keeps us comfortably under that.
const REALTIME_POLL_INTERVAL_MS = 40_000;

if (!API_KEY) {
  console.error('Missing OTD_API_KEY. Copy .env.example to .env and fill in your API key.');
  process.exit(1);
}

const staticData = await loadStaticGtfs();
console.log(
  `Loaded static GTFS (generated ${staticData.generatedAt}): ` +
    `${staticData.routesById.size} routes, ${staticData.tripsById.size} trips`
);

let delaysByTripId = new Map();
let lastPolledAt = 0;
let inFlightPoll = null;

// Refresh on demand (triggered by an incoming request) rather than on a
// background setInterval: free-tier hosts suspend the process between
// requests when idle, which would silently stop a background timer.
async function ensureFreshDelays() {
  if (Date.now() - lastPolledAt < REALTIME_POLL_INTERVAL_MS) return;
  if (inFlightPoll) return inFlightPoll;

  inFlightPoll = fetchTripDelays(API_KEY)
    .then((delays) => {
      delaysByTripId = delays;
      lastPolledAt = Date.now();
      console.log(`Polled GTFS-RT: delay info for ${delaysByTripId.size} trips`);
    })
    .catch((err) => {
      console.error('GTFS-RT poll failed:', err.message);
    })
    .finally(() => {
      inFlightPoll = null;
    });
  return inFlightPoll;
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/vehicles', async (req, res) => {
  await ensureFreshDelays();
  const vehicles = computeVehiclePositions(new Date(), staticData, delaysByTripId);
  res.json({ generatedAt: new Date().toISOString(), vehicles });
});

app.get('/api/routes', (req, res) => {
  const routes = [...staticData.routesById.values()]
    .map((r) => ({ routeShortName: r.route_short_name, routeLongName: r.route_long_name }))
    .sort((a, b) => a.routeShortName.localeCompare(b.routeShortName, undefined, { numeric: true }));
  res.json({ routes });
});

app.listen(PORT, () => {
  console.log(`Basel bus tracker running at http://localhost:${PORT}`);
});
