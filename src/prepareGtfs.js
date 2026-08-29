// One-off/occasional script: filters the (huge, national) static GTFS zip
// down to just Basel-area (BVB/BLT) routes/trips/stops and writes a compact
// JSON file the server loads at startup. Re-run whenever data/gtfs.zip is
// refreshed with a newer download.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'csv-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const ZIP_PATH = path.join(DATA_DIR, 'gtfs.zip');
const EXTRACT_DIR = path.join(DATA_DIR, 'gtfs-extracted');
const OUTPUT_PATH = path.join(DATA_DIR, 'basel-gtfs.json');
const STOP_TIMES_PATH = path.join(DATA_DIR, 'basel-stoptimes.ndjson');

const AGENCY_NAME_PATTERN = /BVB|Basler Verkehrs|BLT|Baselland Transport/i;

// Full-year national trip data is ~750MB parsed in memory — too big for a
// free hosting tier. We only ever need "today"/"yesterday"'s trips at
// runtime (see interpolate.js), so keep just a rolling window and
// regenerate periodically (see README).
const WINDOW_DAYS = 10;
const WEEKDAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function isServiceActiveOnDate(serviceId, dateObj, calendarByService, exceptionsByKey) {
  const dateStr = formatDateYYYYMMDD(dateObj);
  const exception = exceptionsByKey.get(`${serviceId}|${dateStr}`);
  if (exception === '1') return true;
  if (exception === '2') return false;

  const cal = calendarByService.get(serviceId);
  if (!cal) return false;
  if (dateStr < cal.start_date || dateStr > cal.end_date) return false;
  return cal[WEEKDAY_FIELDS[dateObj.getDay()]] === '1';
}

function parseCsvFile(filePath, onRecord) {
  return new Promise((resolve, reject) => {
    const parser = fs
      .createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }));
    parser.on('readable', () => {
      let record;
      while ((record = parser.read()) !== null) onRecord(record);
    });
    parser.on('error', reject);
    parser.on('end', resolve);
  });
}

async function main() {
  if (!fs.existsSync(ZIP_PATH)) {
    console.error(
      `Missing ${ZIP_PATH}.\n` +
        'Download the latest GTFS zip from ' +
        'https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020 ' +
        'and save it as data/gtfs.zip'
    );
    process.exit(1);
  }

  console.log('Extracting GTFS zip (via system unzip — some entries, like stop_times.txt, exceed the 2GB buffer limit of pure-JS zip libraries)...');
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  execFileSync('unzip', ['-o', '-q', ZIP_PATH, '-d', EXTRACT_DIR], { stdio: 'inherit' });

  console.log('Finding Basel agencies...');
  const baselAgencyIds = new Set();
  await parseCsvFile(path.join(EXTRACT_DIR, 'agency.txt'), (row) => {
    if (AGENCY_NAME_PATTERN.test(row.agency_name)) baselAgencyIds.add(row.agency_id);
  });
  if (baselAgencyIds.size === 0) {
    console.error(
      'No agencies matched BVB/BLT name pattern in agency.txt. ' +
        'Open the file and adjust AGENCY_NAME_PATTERN in this script.'
    );
    process.exit(1);
  }
  console.log('Basel agency IDs:', [...baselAgencyIds]);

  console.log('Filtering routes...');
  const routes = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'routes.txt'), (row) => {
    if (baselAgencyIds.has(row.agency_id)) {
      routes.set(row.route_id, {
        route_id: row.route_id,
        route_short_name: row.route_short_name,
        route_long_name: row.route_long_name,
        route_type: row.route_type,
      });
    }
  });
  console.log(`${routes.size} Basel routes`);

  console.log('Filtering trips...');
  const trips = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'trips.txt'), (row) => {
    if (routes.has(row.route_id)) {
      trips.set(row.trip_id, {
        trip_id: row.trip_id,
        route_id: row.route_id,
        service_id: row.service_id,
        trip_headsign: row.trip_headsign,
        direction_id: row.direction_id,
      });
    }
  });
  console.log(`${trips.size} Basel trips (full year)`);

  const allUsedServiceIds = new Set([...trips.values()].map((t) => t.service_id));

  console.log('Filtering calendar / calendar_dates...');
  const calendarByService = new Map();
  const calendarPath = path.join(EXTRACT_DIR, 'calendar.txt');
  if (fs.existsSync(calendarPath)) {
    await parseCsvFile(calendarPath, (row) => {
      if (allUsedServiceIds.has(row.service_id)) calendarByService.set(row.service_id, row);
    });
  }
  const exceptionsByKey = new Map();
  const calendarDatesPath = path.join(EXTRACT_DIR, 'calendar_dates.txt');
  if (fs.existsSync(calendarDatesPath)) {
    await parseCsvFile(calendarDatesPath, (row) => {
      if (allUsedServiceIds.has(row.service_id)) {
        exceptionsByKey.set(`${row.service_id}|${row.date}`, row.exception_type);
      }
    });
  }

  console.log(`Narrowing trips to the next ${WINDOW_DAYS} days (rolling window)...`);
  const windowActiveServiceIds = new Set();
  const today = new Date();
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = new Date(today.getTime() + i * 86400000);
    for (const serviceId of allUsedServiceIds) {
      if (windowActiveServiceIds.has(serviceId)) continue;
      if (isServiceActiveOnDate(serviceId, date, calendarByService, exceptionsByKey)) {
        windowActiveServiceIds.add(serviceId);
      }
    }
  }
  for (const [tripId, trip] of trips) {
    if (!windowActiveServiceIds.has(trip.service_id)) trips.delete(tripId);
  }
  console.log(`${trips.size} Basel trips active in the next ${WINDOW_DAYS} days`);

  console.log('Filtering stop_times (largest file, may take a while)...');
  const stopTimesByTrip = new Map();
  const usedStopIds = new Set();
  await parseCsvFile(path.join(EXTRACT_DIR, 'stop_times.txt'), (row) => {
    if (!trips.has(row.trip_id)) return;
    usedStopIds.add(row.stop_id);
    let list = stopTimesByTrip.get(row.trip_id);
    if (!list) stopTimesByTrip.set(row.trip_id, (list = []));
    list.push({
      stop_id: row.stop_id,
      arrival_time: row.arrival_time,
      departure_time: row.departure_time,
      stop_sequence: Number(row.stop_sequence),
    });
  });
  for (const list of stopTimesByTrip.values()) list.sort((a, b) => a.stop_sequence - b.stop_sequence);
  console.log(`stop_times kept for ${stopTimesByTrip.size} trips, ${usedStopIds.size} stops referenced`);

  console.log('Filtering stops...');
  const stops = new Map();
  await parseCsvFile(path.join(EXTRACT_DIR, 'stops.txt'), (row) => {
    if (usedStopIds.has(row.stop_id)) {
      stops.set(row.stop_id, {
        stop_id: row.stop_id,
        stop_name: row.stop_name,
        stop_lat: Number(row.stop_lat),
        stop_lon: Number(row.stop_lon),
      });
    }
  });

  // Narrow the already-filtered calendar data down to just the service_ids
  // that survived the rolling-window trip filter above.
  const calendar = [...calendarByService.values()].filter((c) => windowActiveServiceIds.has(c.service_id));
  const calendarDates = [];
  for (const [key, exceptionType] of exceptionsByKey) {
    const serviceId = key.slice(0, key.indexOf('|'));
    if (windowActiveServiceIds.has(serviceId)) {
      calendarDates.push({ service_id: serviceId, date: key.slice(key.indexOf('|') + 1), exception_type: exceptionType });
    }
  }

  const windowEnd = new Date(today.getTime() + (WINDOW_DAYS - 1) * 86400000);
  const output = {
    generatedAt: new Date().toISOString(),
    windowEndDate: formatDateYYYYMMDD(windowEnd),
    routes: [...routes.values()],
    trips: [...trips.values()],
    stops: Object.fromEntries(stops),
    calendar,
    calendarDates,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`Wrote ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(1)} MB)`);

  // stop_times is by far the largest section (millions of rows). Writing it
  // as one line per trip (NDJSON) lets the server stream-parse it at
  // startup instead of one giant JSON.parse() — a single big parse leaves
  // V8 holding onto ~3x the peak memory even after GC, which is what was
  // blowing past a 512MB free-hosting-tier limit.
  const stopTimesStream = fs.createWriteStream(STOP_TIMES_PATH);
  for (const [tripId, stops_] of stopTimesByTrip) {
    stopTimesStream.write(JSON.stringify({ trip_id: tripId, stops: stops_ }) + '\n');
  }
  stopTimesStream.end();
  await new Promise((resolve) => stopTimesStream.on('finish', resolve));
  console.log(`Wrote ${STOP_TIMES_PATH} (${(fs.statSync(STOP_TIMES_PATH).size / 1024 / 1024).toFixed(1)} MB)`);

  console.log('Cleaning up extracted files...');
  fs.rmSync(EXTRACT_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
