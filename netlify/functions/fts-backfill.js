const {
  STATIONS,
  syncStation
} = require('./_weather-archive');

exports.handler = async event => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { Allow: 'POST' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const token = event.headers['x-archive-admin-token'];

  if (
    !process.env.ARCHIVE_ADMIN_TOKEN ||
    token !== process.env.ARCHIVE_ADMIN_TOKEN
  ) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const request = event.body
      ? JSON.parse(event.body)
      : {};

    const stationIds = request.station
      ? [request.station]
      : Object.keys(STATIONS);

    // Initial FTS seed is restricted to 30 days.
    const seedHours = Math.min(
      Math.max(Number(request.seedHours || 720), 24),
      720
    );

    const results = [];

    for (const stationId of stationIds) {
      if (!STATIONS[stationId]) {
        results.push({
          stationId,
          ok: false,
          error: 'Unsupported station'
        });
        continue;
      }

      try {
        results.push({
          ok: true,
          ...(await syncStation(stationId, seedHours))
        });
      } catch (error) {
        results.push({
          stationId,
          ok: false,
          error: error.message
        });
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ results })
    };
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'Backfill failed',
        details: error.message
      })
    };
  }
};
