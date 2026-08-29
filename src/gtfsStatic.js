import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PATH = path.join(__dirname, '..', 'data', 'basel-gtfs.json');

export function loadStaticGtfs() {
  if (!fs.existsSync(STATIC_PATH)) {
    throw new Error(
      `Missing ${STATIC_PATH}. Run "npm run prepare-gtfs" first (see README).`
    );
  }
  const raw = JSON.parse(fs.readFileSync(STATIC_PATH, 'utf8'));

  const routesById = new Map(raw.routes.map((r) => [r.route_id, r]));
  const tripsById = new Map(raw.trips.map((t) => [t.trip_id, t]));
  const stopsById = new Map(Object.entries(raw.stops));
  const stopTimesByTrip = new Map(Object.entries(raw.stopTimesByTrip));

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
