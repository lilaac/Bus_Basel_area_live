import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PATH = path.join(__dirname, '..', 'data', 'basel-gtfs.json');
const STOP_TIMES_PATH = path.join(__dirname, '..', 'data', 'basel-stoptimes.ndjson');

// stop_times is read line-by-line (NDJSON) instead of one big JSON.parse():
// a single multi-ten-MB parse leaves V8 holding several times that in
// resident memory even after GC, which matters on a memory-capped host.
async function loadStopTimesByTrip() {
  const stopTimesByTrip = new Map();
  const rl = readline.createInterface({
    input: fs.createReadStream(STOP_TIMES_PATH),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const { trip_id, stops } = JSON.parse(line);
    stopTimesByTrip.set(trip_id, stops);
  }
  return stopTimesByTrip;
}

export async function loadStaticGtfs() {
  if (!fs.existsSync(STATIC_PATH) || !fs.existsSync(STOP_TIMES_PATH)) {
    throw new Error(`Missing ${STATIC_PATH} or ${STOP_TIMES_PATH}. Run "npm run prepare-gtfs" first (see README).`);
  }
  const raw = JSON.parse(fs.readFileSync(STATIC_PATH, 'utf8'));
  const stopTimesByTrip = await loadStopTimesByTrip();

  const routesById = new Map(raw.routes.map((r) => [r.route_id, r]));
  const tripsById = new Map(raw.trips.map((t) => [t.trip_id, t]));
  const stopsById = new Map(Object.entries(raw.stops));

  const calendarByService = new Map(raw.calendar.map((c) => [c.service_id, c]));
  const calendarExceptions = new Map(
    raw.calendarDates.map((cd) => [`${cd.service_id}|${cd.date}`, cd.exception_type])
  );

  return {
    generatedAt: raw.generatedAt,
    routesById,
    tripsById,
    stopsById,
    stopTimesByTrip,
    calendarByService,
    calendarExceptions,
  };
}
