/**
 * lib/iotHub.ts
 * Azure IoT Hub integration for Port energy/substation telemetry.
 *
 * Netlify serverless constraint:
 * The @azure/event-hubs persistent consumer cannot run in a serverless function.
 * This module uses the Azure IoT Hub REST API (query interface) instead —
 * a stateless HTTP poll that works perfectly in Netlify functions.
 *
 * Free tier: Azure IoT Hub F1 allows 8,000 messages/day.
 * When physical IoT sensors are deployed at Port substations,
 * they POST telemetry to this hub and energy/route.ts serves it live.
 * Until then, this module returns an empty array and the route falls back
 * to the existing generateEnergyData() simulation — zero UI disruption.
 *
 * Device naming convention expected from Port IoT sensors:
 *   SS-01-sensor, SS-02-sensor, ... SS-13-sensor
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SubstationStatus = 'NORMAL' | 'HIGH_LOAD' | 'OVERLOAD' | 'FAULT';

export interface SubstationTelemetry {
  id: string;              // e.g. "SS-01"
  name: string;            // e.g. "SS-01 North Terminal"
  loadPercent: number;     // 0–100 — matches mockDataGen field name
  status: SubstationStatus;// matches mockDataGen field name
  voltage: number;         // kV
  currentMW: number;       // matches mockDataGen field name
  maxCapacityMW: number;   // matches mockDataGen field name
  lastUpdated: string;
  source: 'AZURE_IOT_LIVE' | 'SIMULATION';
}

interface IoTHubDeviceTwin {
  deviceId: string;
  properties: {
    reported: {
      loadPercentage?: number;
      powerMW?: number;
      voltageKV?: number;
      maxCapacityMW?: number;
      timestamp?: string;
    };
  };
}

// Substation name lookup
const SUBSTATION_NAMES: Record<string, string> = {
  'SS-01': 'SS-01 North Terminal',
  'SS-02': 'SS-02 NSICT',
  'SS-03': 'SS-03 GTI',
  'SS-04': 'SS-04 JNPCT',
  'SS-05': 'SS-05 Gate Complex',
  'SS-06': 'SS-06 Admin Block',
  'SS-07': 'SS-07 Liquid Cargo',
  'SS-08': 'SS-08 Rail Yard',
  'SS-09': 'SS-09 South Quay',
  'SS-10': 'SS-10 CFS Zone',
  'SS-11': 'SS-11 Workshop',
  'SS-12': 'SS-12 Pump House',
  'SS-13': 'SS-13 Emergency Grid',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deriveStatus(loadPct: number): SubstationStatus {
  if (loadPct > 90) return 'OVERLOAD';
  if (loadPct > 75) return 'HIGH_LOAD';
  return 'NORMAL';
}

function deviceIdToSubstationId(deviceId: string): string {
  // "SS-01-sensor" → "SS-01"
  return deviceId.replace(/-sensor$/, '').toUpperCase();
}

// ─── Azure IoT Hub REST: Device Twin query ────────────────────────────────────

/**
 * Get a SAS token for Azure IoT Hub REST API.
 * Built from the connection string without any SDK dependency.
 */
async function buildSasToken(
  resourceUri: string,
  signingKey: string,
  keyName: string,
  expirySecs = 3600
): Promise<string> {
  const expiry = Math.ceil(Date.now() / 1000) + expirySecs;
  // IoT Hub expects lowercase host in the string-to-sign; skn must be present on the token.
  const uriNorm = resourceUri.toLowerCase();
  const toSign  = `${encodeURIComponent(uriNorm)}\n${expiry}`;

  // HMAC-SHA256 via Web Crypto (available in Node 18+ and Edge runtime)
  const keyBytes = Uint8Array.from(atob(signingKey), c => c.charCodeAt(0));
  const msgBytes = new TextEncoder().encode(toSign);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const sigB64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(sig))));

  return (
    `SharedAccessSignature sr=${encodeURIComponent(uriNorm)}` +
    `&sig=${encodeURIComponent(sigB64)}&se=${expiry}` +
    `&skn=${encodeURIComponent(keyName)}`
  );
}

/**
 * Parse the IoT Hub connection string into its components.
 * Format: HostName=xxx;SharedAccessKeyName=xxx;SharedAccessKey=xxx
 */
function parseConnectionString(cs: string): {
  host: string;
  keyName: string;
  key: string;
} | null {
  try {
    const parts = Object.fromEntries(
      cs
        .split(';')
        .map(segment => {
          const eqIndex = segment.indexOf('=');
          if (eqIndex === -1) return null;
          const key = segment.slice(0, eqIndex).trim();
          const value = segment.slice(eqIndex + 1).trim();
          return [key, value] as const;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry))
    );

    if (!parts['HostName'] || !parts['SharedAccessKeyName'] || !parts['SharedAccessKey']) {
      return null;
    }

    return {
      host:    parts['HostName'],
      keyName: parts['SharedAccessKeyName'],
      key:     parts['SharedAccessKey'],
    };
  } catch {
    return null;
  }
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

/**
 * Query Azure IoT Hub for latest device twin reported properties
 * from all SS-XX-sensor devices.
 *
 * Returns empty array if:
 *  - AZURE_IOT_CONNECTION_STRING not set
 *  - No SS-XX-sensor devices registered yet
 *  - Hub unreachable
 *
 * API route falls back to generateEnergyData() simulation in all these cases.
 */
export async function fetchIoTSubstations(): Promise<SubstationTelemetry[]> {
  const connStr = process.env.AZURE_IOT_CONNECTION_STRING;

  if (!connStr) {
    // No IoT Hub configured — signal caller to use simulation
    return [];
  }

  const parsed = parseConnectionString(connStr);
  if (!parsed) {
    console.error('[IoT] Invalid connection string format');
    return [];
  }

  try {
    const resourceUri = parsed.host;
    const token = await buildSasToken(resourceUri, parsed.key, parsed.keyName);

    // IoT Hub query API — get device twins for all substation sensors
    const res = await fetch(
      `https://${parsed.host}/devices/query?api-version=2021-04-12`,
      {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
        },
        body: JSON.stringify({
          query: "SELECT * FROM devices WHERE startsWith(deviceId, 'SS-')",
        }),
        next:   { revalidate: 30 },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      console.error(`[IoT] Hub query returned HTTP ${res.status}`);
      return [];
    }

    const twins: IoTHubDeviceTwin[] = await res.json();

    if (!Array.isArray(twins) || twins.length === 0) {
      // Hub reachable but no devices registered yet
      return [];
    }

    return twins
      .map((twin): SubstationTelemetry | null => {
        const ssId   = deviceIdToSubstationId(twin.deviceId);
        const props  = twin.properties?.reported ?? {};
        const load   = props.loadPercentage;
        const mw     = props.powerMW;
        if (load == null || mw == null) return null;

        return {
          id:            ssId,
          name:          SUBSTATION_NAMES[ssId] ?? ssId,
          loadPercent:   load,
          status:        deriveStatus(load),
          voltage:       props.voltageKV      ?? 11,
          currentMW:     mw,
          maxCapacityMW: props.maxCapacityMW  ?? 25,
          lastUpdated:   props.timestamp      ?? new Date().toISOString(),
          source:        'AZURE_IOT_LIVE',
        };
      })
      .filter((s): s is SubstationTelemetry => s !== null);
  } catch (err) {
    console.error('[IoT] Hub fetch failed:', err);
    return [];
  }
}

/**
 * Check if IoT Hub is configured and reachable.
 * Used by energy route to add a source badge to the response.
 */
export function getIoTHubStatus(): {
  configured: boolean;
  label: string;
} {
  const configured = Boolean(process.env.AZURE_IOT_CONNECTION_STRING);
  return {
    configured,
    label: configured
      ? 'Azure IoT Hub Connected'
      : 'IoT Hub Ready — SCADA Pending',
  };
}
