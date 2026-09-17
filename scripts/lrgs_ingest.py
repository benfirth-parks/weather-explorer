#!/usr/bin/env python3
"""
NOAA LRGS ingestion client for Canadian Rockies FTS weather stations.

Connects to a NOAA LRGS server over DDS v14 protocol (TCP port 16003),
authenticates with SHA-256, requests messages by NESDIS DCP address for
the 26 Parks Canada / Avalanche Canada FTS stations, and writes raw +
partially decoded JSON to data/lrgs/.

Runs standalone (called by .github/workflows/lrgs-ingest.yml every 15
minutes). No third-party runtime dependencies — pure stdlib.

Env vars required:
  LRGS_USER      NOAA-issued username (6+ chars)
  LRGS_PASSWORD  NOAA-issued password
Optional:
  LRGS_SERVER    Default: cdadata.wcda.noaa.gov
  LRGS_PORT      Default: 16003
  LRGS_SINCE     Search-criteria "since" (default: "now - 6 hours" on first
                 run, "now - 30 minutes" thereafter)
  LRGS_OUT       Output dir (default: data/lrgs)

References:
  https://dcs1.noaa.gov/LRGS/DCP-Data-Service-14.pdf   (DDS v14 spec)
  https://opendcs-env.readthedocs.io/en/latest/legacy-lrgs-userguide.html
                                                        (search-crit format)
  https://s3.amazonaws.com/Product_Software/700-AC_AC+-MAN.pdf
                                                        (FTS pseudo-binary)
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

# ---------------------------------------------------------------------------
# Station catalog: NESDIS DCP address -> station-id used in the site.
#
# All 8-hex DCP addresses cross-verified against the NOAA authoritative
# Platform Description Table (PDT) dump at
#   https://dcs1.noaa.gov/pdts_compressed.txt
# on 2026-09-17. PDT description and decoded lat/lon confirmed each mapping.
#
# Ownership breakdown (from PDT owner code, cols 0-6):
#   PCGCCA  — Parks Canada (Government of Canada)
#   ALBERT  — Alberta Environment / Water Supply
#
# TODO — no NESDIS address yet for:
#   * Glacier / Rogers Pass BC MoTI stations: ROGER_60, FID_60, ABB_60,
#     Asulk_60, HTHR_60, HERM_60, MACD_60, ROCKF_60, RHILL_60, KLOTZ_60
#     (Avalanche Canada exposes them by station code, not DCP address)
#   * fts-tangleridge — no matching station in current PDT dump
# ---------------------------------------------------------------------------
STATIONS: dict[str, str] = {
    # --- Avalanche Canada / Parks Canada FTS (PDT owner PCGCCA) --------
    "CBA5910C": "fts-boslo",            # AVI BOSWORTH LOWER - LLYK
    "CBA5B7E0": "fts-bosup",            # AVI BOSWORTH UPPER - LLYK
    "CBA270CA": "fts-vulture",          # AVI VULTURE PEAK - LLYK
    "CBA233C0": "fts-bowsummit",        # AVI BOW SUMMIT - LLYK
    "C2B00882": "fts-maligne",          # MALIGNE - JASPER NP
    "C2B17CE8": "fts-coleman",          # AVI COLEMAN - JASPER NP
    "CBA47004": "fts-boulder",          # BOULDER CREEK - LLYK
    "CBA5E79C": "fts-lookout",          # AVI LOOKOUT - BANFF NP
    "CBA25626": "fts-simplo",           # AVI SIMPSON LOWER - LLYK
    "CBA263BC": "fts-simpup",           # AVI SIMPSON UPPER - LLYK
    "CBA5C170": "fts-stanley",          # AVI STANLEY LOWER - LLYK
    "C2B02E6E": "fts-whymper",          # AVI WHYMPER - BANFF NP
    "C2B01BF4": "fts-lakelouise",       # LAKE LOUISE - LLYK
    "CBA4A66C": "fts-vermillion",       # VERMILLION CROSSING - LLYK
    "C2B14972": "fts-castle",           # CASTLE - BANFF NP
    "CBA15128": "fts-devona",           # DEVONA - JASPER NP
    "C2B058FE": "fts-rangercreek",      # RANGER CREEK - JASPER NP
    # --- Alberta / other FTS (PDT owner ALBERT) ------------------------
    "44548250": "fts-sunshine",         # SUNSHINE VILLAGE
    "4441E7E8": "fts-skoki",            # SKOKI
    "4454C15A": "fts-pikarun",          # PIKA RUN
    "4455A646": "fts-bowprecip",        # BOW SUMMIT (Alberta precip gauge)
    # --- Skip-per-user (kept for LRGS request completeness) ------------
    "C2B16F9E": "fts-bigbend",          # AVI BIG BEND - JASPER NP  (skip)
    "CBA56188": "fts-parkerupper",      # AVI PARKER UPPER - JASPER NP (skip; was mislabeled tangleridge)
    "CBA24550": "fts-saskcrossing",     # SASKATCH CROSSING - LLYK  (skip)
    "C2B0DEEA": "fts-jasperqd1",        # JASPER QD1 - JASPER NP    (skip)
    "CBA164B2": "fts-dorothy",          # DOROTHY - JASPER NP       (skip)
    # --- Not yet in site (Waterton, per-user disregard) ----------------
    "CBA06648": "fts-waterton",         # WATERTON TOWNSITE - WATERTON NP (skip)
    "CBA096CC": "fts-summitlake",       # SUMMIT LAKE - WATERTON NP       (skip)
    "4441041A": "fts-akamina",          # AKAMINA PASS 2                  (skip)
}

# Stations to skip per user instruction:
#   "disregard jasper stations" — 5 baseline-failing
#   "disregard Waterton stations" — Akamina, Summit Lake, Waterton Townsite,
#      plus Bertha Mid/Ridge (no NESDIS)
#   "disregard the five new stations" — Parker Upper, Yoho (EnvCan), Waterton set
SKIP_STATIONS = {
    # Baseline-failing Jasper set
    "fts-jasperqd1", "fts-dorothy", "fts-saskcrossing",
    "fts-bigbend", "fts-tangleridge",
    # New / Waterton set
    "fts-parkerupper", "fts-waterton", "fts-summitlake", "fts-akamina",
}


# ---------------------------------------------------------------------------
# DDS protocol constants
# ---------------------------------------------------------------------------
SYNC = b"FAF0"

# message type codes
MSG_ID_HELLO = b"a"          # unauthenticated hello (fallback only)
MSG_ID_AUTH_HELLO = b"m"     # authenticated hello (v3+)
MSG_ID_CRITERIA = b"g"       # search criteria transfer
MSG_ID_DCP_BLOCK = b"n"      # request next block of DCP messages
MSG_ID_STATUS = b"e"         # server status
MSG_ID_GOODBYE = b"b"        # clean disconnect

# error codes we handle specially
ERR_DMSGTIMEOUT = 11         # no matching messages available (real-time wait)
ERR_DUNTIL = 35              # reached the "until" time
ERR_DAUTHFAILED = 47         # authentication failure
ERR_DSTRONGREQUIRED = 55     # server requires SHA-256


class LRGSError(Exception):
    def __init__(self, server_code: int, system_code: int, explanation: str):
        self.server_code = server_code
        self.system_code = system_code
        self.explanation = explanation
        super().__init__(f"LRGS error {server_code}/{system_code}: {explanation}")


# ---------------------------------------------------------------------------
# Authenticator hash (per DDS v14 §3.2.4)
# ---------------------------------------------------------------------------
def _preliminary_hash(username: str, password: str, algo: str = "sha256") -> bytes:
    """Step 1 shared secret: hash( username + password + username + password ).

    Protocol v14 uses SHA-256 throughout when the server allows it.
    """
    h = hashlib.new(algo)
    ub = username.encode("ascii")
    pb = password.encode("ascii")
    h.update(ub)
    h.update(pb)
    h.update(ub)
    h.update(pb)
    return h.digest()


def _authenticator(username: str, password: str, ts_epoch: int,
                   algo: str = "sha256") -> str:
    """Step 2 authenticator: hash( user + prelim + time4be + user + prelim + time4be ).

    Time is 4-byte big-endian Unix epoch seconds. Returned as UPPERCASE hex.
    """
    prelim = _preliminary_hash(username, password, algo)
    tb = struct.pack(">I", ts_epoch)
    h = hashlib.new(algo)
    ub = username.encode("ascii")
    h.update(ub)
    h.update(prelim)
    h.update(tb)
    h.update(ub)
    h.update(prelim)
    h.update(tb)
    return h.hexdigest().upper()


def _fmt_yy_ddd(ts: int) -> str:
    """YYDDDHHMMSS in UTC per DDS v14 §3.1."""
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return f"{dt.year % 100:02d}{dt.timetuple().tm_yday:03d}{dt.strftime('%H%M%S')}"


# ---------------------------------------------------------------------------
# Framed DDS I/O
# ---------------------------------------------------------------------------
def _send_msg(sock: socket.socket, msg_type: bytes, body: bytes) -> None:
    assert len(msg_type) == 1
    if len(body) > 99999:
        raise ValueError(f"body too large ({len(body)} > 99999)")
    hdr = SYNC + msg_type + f"{len(body):05d}".encode("ascii")
    sock.sendall(hdr + body)


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError(f"connection closed with {len(buf)}/{n} bytes read")
        buf.extend(chunk)
    return bytes(buf)


def _recv_msg(sock: socket.socket) -> tuple[bytes, bytes]:
    """Return (type_byte, body_bytes)."""
    hdr = _recv_exact(sock, 10)
    if hdr[:4] != SYNC:
        raise ConnectionError(f"bad sync: {hdr[:4]!r}")
    msg_type = hdr[4:5]
    length = int(hdr[5:10].decode("ascii"))
    body = _recv_exact(sock, length) if length else b""
    return msg_type, body


def _check_error(body: bytes) -> None:
    """DDS error response body starts with '?'."""
    if body.startswith(b"?"):
        # Format: ?ServerCode,SystemCode,[explanation]
        try:
            parts = body[1:].decode("ascii", errors="replace").split(",", 2)
            sc = int(parts[0].strip())
            syc = int(parts[1].strip())
            expl = parts[2].strip() if len(parts) > 2 else ""
        except (ValueError, IndexError):
            raise LRGSError(-1, -1, body.decode("ascii", errors="replace"))
        raise LRGSError(sc, syc, expl)


# ---------------------------------------------------------------------------
# High-level client
# ---------------------------------------------------------------------------
class LRGSClient:
    def __init__(self, host: str, port: int, username: str, password: str,
                 timeout: float = 60.0):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self.sock: socket.socket | None = None
        self.protocol_version = 0

    def connect(self) -> None:
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        self.sock.settimeout(self.timeout)
        # Try authenticated hello with SHA-256 first (v14 preferred)
        try:
            self._authenticate(algo="sha256")
        except LRGSError as e:
            if e.server_code == ERR_DAUTHFAILED:
                # Some older servers still want SHA-1 — retry once
                self._authenticate(algo="sha")
            else:
                raise

    def _authenticate(self, algo: str) -> None:
        ts = int(time.time())
        auth = _authenticator(self.username, self.password, ts, algo)
        body = f"{self.username} {_fmt_yy_ddd(ts)} {auth}".encode("ascii")
        _send_msg(self.sock, MSG_ID_AUTH_HELLO, body)
        mt, resp = _recv_msg(self.sock)
        _check_error(resp)
        # AuthAcceptResp: username SP time SP ProtocolVersion
        parts = resp.decode("ascii", errors="replace").strip().split()
        if len(parts) >= 3:
            try:
                self.protocol_version = int(parts[-1])
            except ValueError:
                self.protocol_version = 1

    def send_criteria(self, criteria_text: str) -> None:
        # 50 spaces + criteria (LF-terminated lines only)
        body = b" " * 50 + criteria_text.replace("\r\n", "\n").encode("ascii")
        _send_msg(self.sock, MSG_ID_CRITERIA, body)
        mt, resp = _recv_msg(self.sock)
        _check_error(resp)

    def read_all(self, max_seconds: float = 300.0) -> list[bytes]:
        """Read message blocks until DMSGTIMEOUT or DUNTIL or timeout."""
        out: list[bytes] = []
        deadline = time.time() + max_seconds
        while time.time() < deadline:
            _send_msg(self.sock, MSG_ID_DCP_BLOCK, b"")
            try:
                mt, body = _recv_msg(self.sock)
            except socket.timeout:
                break
            try:
                _check_error(body)
            except LRGSError as e:
                if e.server_code in (ERR_DMSGTIMEOUT, ERR_DUNTIL):
                    break
                raise
            # split concatenated messages by their 37-byte DOMSAT header length
            offset = 0
            while offset + 37 <= len(body):
                header = body[offset:offset + 37]
                try:
                    msg_len = int(header[32:37].decode("ascii"))
                except ValueError:
                    break
                total = 37 + msg_len
                if offset + total > len(body):
                    break
                out.append(body[offset:offset + total])
                offset += total
        return out

    def close(self) -> None:
        if self.sock:
            try:
                _send_msg(self.sock, MSG_ID_GOODBYE, b"")
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None


# ---------------------------------------------------------------------------
# DOMSAT header parser (37 bytes)
# ---------------------------------------------------------------------------
def parse_domsat_header(header: bytes) -> dict:
    """Per DDS v14 §5.1."""
    h = header.decode("ascii", errors="replace")
    return {
        "dcp_address": h[0:8],
        "time_yyddd": h[8:19],
        "failure_code": h[19:20],
        "signal_strength": h[20:22],
        "freq_offset": h[22:24],
        "modulation_index": h[24:25],
        "data_quality": h[25:26],
        "goes_channel": h[26:29],
        "spacecraft": h[29:30],
        "uplink_carrier": h[30:32],
        "message_length": h[32:37],
    }


def yyddd_to_iso(yyddd: str) -> str | None:
    """YYDDDHHMMSS (UTC) -> ISO-8601 with Z suffix."""
    try:
        yy = int(yyddd[0:2])
        ddd = int(yyddd[2:5])
        hh = int(yyddd[5:7])
        mm = int(yyddd[7:9])
        ss = int(yyddd[9:11])
    except (ValueError, IndexError):
        return None
    year = 2000 + yy if yy < 70 else 1900 + yy
    # Julian day
    from datetime import timedelta
    base = datetime(year, 1, 1, tzinfo=timezone.utc)
    dt = base + timedelta(days=ddd - 1, hours=hh, minutes=mm, seconds=ss)
    return dt.isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# FTS pseudo-binary body decoder (best-effort)
# ---------------------------------------------------------------------------
# FTS uses NOAA 3-byte pseudo-binary: each 18-bit sensor reading is packed
# into 3 modified-ASCII bytes (each byte = 6 bits, with 0x40 or 0x3F offset).
# Without a per-station channel-order map we cannot label fields — but we
# can extract the raw integers and their timestamps for later decoding.
def decode_pseudo_binary_body(body: bytes) -> list[int]:
    """Return the sequence of raw 18-bit integers from an FTS body."""
    out: list[int] = []
    b = bytes(c & 0x3F for c in body if 0x40 <= c <= 0x7F)
    for i in range(0, len(b) - 2, 3):
        # 3 bytes -> 18 bits; MSB first
        v = (b[i] << 12) | (b[i + 1] << 6) | b[i + 2]
        # sign-extend from 18 bits
        if v & 0x20000:
            v -= 0x40000
        out.append(v)
    return out


def decode_message(raw: bytes) -> dict:
    header = parse_domsat_header(raw[:37])
    body = raw[37:]
    decoded = {
        "dcp_address": header["dcp_address"],
        "station_id": STATIONS.get(header["dcp_address"], None),
        "arrival_time": yyddd_to_iso(header["time_yyddd"]),
        "goes_channel": header["goes_channel"],
        "spacecraft": header["spacecraft"],
        "failure_code": header["failure_code"],
        "signal_strength": header["signal_strength"],
        "data_quality": header["data_quality"],
        "raw_body_hex": body.hex(),
        "raw_body_len": len(body),
    }
    # only attempt pseudo-binary decode for good, printable-looking bodies
    if header["failure_code"] == "G":
        try:
            decoded["raw_values_18bit"] = decode_pseudo_binary_body(body)
        except Exception as ex:  # pragma: no cover - defensive
            decoded["decode_error"] = str(ex)
    return decoded


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def build_search_criteria(dcp_addresses: Iterable[str], since: str) -> str:
    lines = [f"DRS_SINCE: {since}", "DRS_UNTIL: now"]
    for addr in dcp_addresses:
        lines.append(f"DCP_ADDRESS: {addr}")
    return "\n".join(lines) + "\n"


def main() -> int:
    user = os.environ.get("LRGS_USER", "").strip()
    password = os.environ.get("LRGS_PASSWORD", "").strip()
    server = os.environ.get("LRGS_SERVER", "cdadata.wcda.noaa.gov").strip()
    port = int(os.environ.get("LRGS_PORT", "16003"))
    since = os.environ.get("LRGS_SINCE", "now - 30 minutes").strip()
    out_dir = Path(os.environ.get("LRGS_OUT", "data/lrgs"))

    if not user or not password:
        print("ERROR: LRGS_USER and LRGS_PASSWORD must be set", file=sys.stderr)
        print("       Register at NOAA/Wallops: call (757) 824-7450", file=sys.stderr)
        return 2

    # Skip the stations we've explicitly excluded
    dcp_addresses = [
        addr for addr, sid in STATIONS.items() if sid not in SKIP_STATIONS
    ]
    print(f"[lrgs] connecting {server}:{port} as {user}")
    print(f"[lrgs] requesting {len(dcp_addresses)} stations since '{since}'")

    out_dir.mkdir(parents=True, exist_ok=True)
    client = LRGSClient(server, port, user, password)
    try:
        client.connect()
        print(f"[lrgs] authenticated, protocol v{client.protocol_version}")
        crit = build_search_criteria(dcp_addresses, since)
        client.send_criteria(crit)
        print(f"[lrgs] search criteria accepted ({len(crit)} bytes)")
        messages = client.read_all(max_seconds=120)
        print(f"[lrgs] received {len(messages)} messages")
    finally:
        client.close()

    # Group by station, keep the most-recent-per-station in latest.json
    by_station: dict[str, list[dict]] = {}
    for raw in messages:
        d = decode_message(raw)
        sid = d.get("station_id")
        if not sid:
            continue
        by_station.setdefault(sid, []).append(d)

    latest = {}
    for sid, msgs in by_station.items():
        msgs.sort(key=lambda m: m.get("arrival_time") or "", reverse=True)
        latest[sid] = msgs[0]
        # archive every message
        station_dir = out_dir / sid
        station_dir.mkdir(parents=True, exist_ok=True)
        for m in msgs:
            ts = m.get("arrival_time", "unknown").replace(":", "").replace("-", "")
            (station_dir / f"{ts}.json").write_text(json.dumps(m, indent=2))

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "server": server,
        "protocol_version": client.protocol_version,
        "message_count": len(messages),
        "station_count": len(latest),
        "stations": latest,
    }
    (out_dir / "latest.json").write_text(json.dumps(manifest, indent=2))
    print(f"[lrgs] wrote latest.json ({len(latest)} stations)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
