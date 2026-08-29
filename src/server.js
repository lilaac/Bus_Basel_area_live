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

const staticData = loadStaticGtfs();
console.log(
  `Loaded static GTFS (generated ${staticData.generatedAt}): ` +
    `${staticData.routesById.size} routes, ${staticData.tripsById.size} trips`
);

let delaysByTripId = new Map();

async function pollRealtime() {
  try {
    delaysByTripId = await fetchTripDelays(API_KEY);
    console.log(`Polled GTFS-RT: delay info for ${delaysByTripId.size} trips`);
  } catch (err) {
    console.error('GTFS-RT poll failed:', err.message);
  }
}
pollRealtime();
setInterval(pollRealtime, REALTIME_POLL_INTERVAL_MS);

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/vehicles', (req, res) => {
  const vehicles = computeVehiclePositions(new Date(), staticData, delaysByTripId);
  res.json({ generatedAt: new Date().toISOString(), vehicles });
});

app.listen(PORT, () => {
  console.log(`Basel bus tracker running at http://localhost:${PORT}`);
});
