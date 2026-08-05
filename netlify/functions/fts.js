exports.handler = async (event) => {
  try {
    const token = process.env.FTS360_TOKEN;
    if (!token) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing FTS360_TOKEN" }),
      };
    }

    const stationMap = {
      "fts-boslo": "6160c6b964699463087281d9",
      "fts-bosup": "6160c6b964699463087281dc",
      "fts-boulder": "6160c6b964699463087281db",
      "fts-bowsummit": "6160c6b964699463087281ec",
      "fts-bowprecip": "6160c6ba6469946308728202",
      "fts-lookout": "6160c6b964699463087281e7",
      "fts-pikarun": "61e09ba56a379f48b21582f6",
      "fts-simplo": "6160c6b964699463087281fa",
      "fts-simpup": "6160c6ba6469946308728203",
      "fts-stanley": "6160c6b964699463087281ea",
      "fts-sunshine": "6160c6b964699463087281e8",
      "fts-vulture": "6160c6b964699463087281e9",
      "fts-whymper": "6160c6b964699463087281e3",
      "fts-vermillion": "6160c6b964699463087281e0",
      "fts-lakelouise": "6160c6b964699463087281eb",
      "fts-castle": "6160c6b964699463087281ef",
      "fts-skoki": "61e09ba56a379f48b21582f7"
    };

    const qs = event.queryStringParameters || {};
    const station = qs.station;
    const hours = Math.min(Number(qs.hours || 24), 720);
    const CHUNK_DAYS = 30;
const end = new Date();
const start = new Date(end - hours * 3600 * 1000);
let rows = [];
for (let s = new Date(start); s < end; s.setDate(s.getDate() + CHUNK_DAYS)) {
  const e = new Date(Math.min(+new Date(s).setDate(s.getDate() + CHUNK_DAYS), +end));
  rows = rows.concat(await fetchChunk(stationId, s, e));
}

    if (!station || !stationMap[station]) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid station" }),
      };
    }

    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600 * 1000);

    const url = new URL("https://fts360api.com/data/v1/agencies/450/records/csv");
    url.searchParams.set("stationIds", stationMap[station]);
    url.searchParams.set("startDate", start.toISOString());
    url.searchParams.set("endDate", end.toISOString());

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const text = await res.text();

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "FTS request failed", details: text }),
      };
    }

    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300",
        },
        body: JSON.stringify([]),
      };
    }

    const headers = lines[0].split(",").map(h => h.trim());
    const num = (v) => {
      if (v === "" || v == null || v === "/////" || v === "///") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const out = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cols[i] ? cols[i].trim().replace(/^\"|\"$/g, "") : "";
      });

      out.push({
        measurementDateTime: row.Date || null,
        airTempAvg: num(row.Temp),
        snowHeight: num(row.HS),
        newSnow: num(row.Rn_1),
        windSpeedAvg: num(row.Wspd),
        windSpeedGust: num(row.Mx_Spd),
        windDirAvg: num(row.Dir),
        relativeHumidity: num(row.Rh),
      });
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify(out),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Proxy failure", details: err.message }),
    };
  }
};
