// =========================================================================================
// == AJAX / API Wrapper (js/api.js) v1.0.0
// == 負責：前端與後端的所有 HTTP 交互；包含 staging 專用 endpoints
// =========================================================================================

import staging from './staging/index.js';
import { getState, setState, pushStagedChange, removeStagedChange } from './state.js';

const DEFAULT_HEADERS = { 'Content-Type': 'application/json' };

async function handleFetchResponse(res) {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (err) { json = null; }
  if (!res.ok) {
    const err = new Error(json && json.message ? json.message : `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

async function postJson(url, body = {}, opts = {}) {
  const { includeCreds = true } = opts;
  const res = await fetch(url, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    credentials: includeCreds ? 'include' : 'same-origin',
    body: JSON.stringify(body),
  });
  return handleFetchResponse(res);
}

// ----------------- 公開 API -----------------
// client-side helper to stage locally and optionally send to server
export async function stageChangeLocal(command, { sendToServer = false, endpoint = '/api/staging/stage' } = {}) {
  // stage locally first
  const cmd = staging.stageChange(command);
  // optionally forward to server-side persistent staging (useful for multi-device)
  if (sendToServer) {
    try {
      const body = { command: { id: cmd.id, op: cmd.op, entity: cmd.entity, payload: cmd.payload, idempotencyKey: cmd.idempotencyKey || cmd.id } };
      await postJson(endpoint, body);
      // we may mark staged command as 'SYNCED' if server acknowledges; for simplicity keep local state and let commit handle final
    } catch (err) {
      // network/server failed: keep local staged command
      console.warn('[api] send staged command failed, kept locally', err);
    }
  }
  return cmd;
}

export async function listStagedServer(endpoint = '/api/staging/list') {
  try {
    const json = await postJson(endpoint, {});
    return json;
  } catch (err) {
    console.warn('[api] listStagedServer failed', err);
    throw err;
  }
}

export async function discardStagedServer(ids = [], endpoint = '/api/staging/discard') {
  try {
    const json = await postJson(endpoint, { ids });
    // also reflect locally
    if (Array.isArray(ids) && ids.length) {
      for (const id of ids) staging.discardStaged(id);
    }
    return json;
  } catch (err) {
    console.warn('[api] discardStagedServer failed', err);
    throw err;
  }
}

// commit staged commands on server
export async function commitStagedServer(options = { batchSize: 100, endpoint: '/api/staging/commit' }, onProgress) {
  const { batchSize = 100, endpoint = '/api/staging/commit' } = options || {};
  // delegate to staging.commitAll which already calls endpoint and manages snapshot merge
  try {
    const result = await staging.commitAll({ batchSize, onProgress, endpoint });
    return result;
  } catch (err) {
    console.warn('[api] commitStagedServer failed', err);
    throw err;
  }
}

export async function fetchSnapshot(endpoint = '/api/staging/snapshot') {
  try {
    const json = await postJson(endpoint, { reason: 'client_sync' });
    // merge minimal known keys
    const snapshot = json && json.snapshot ? json.snapshot : null;
    if (snapshot) {
      const base = getState();
      const next = { ...base };
      if (snapshot.transactions) next.transactions = snapshot.transactions;
      if (snapshot.userSplits) next.userSplits = snapshot.userSplits;
      if (snapshot.pendingDividends) next.pendingDividends = snapshot.pendingDividends;
      if (snapshot.confirmedDividends) next.confirmedDividends = snapshot.confirmedDividends;
      if (snapshot.holdings) next.holdings = snapshot.holdings;
      next.lastSyncedAt = new Date().toISOString();
      // keep stagedChanges intact (client may have unsynced changes)
      setState(next);
    }
    return snapshot;
  } catch (err) {
    console.warn('[api] fetchSnapshot failed', err);
    throw err;
  }
}

// ----------------- Utility helpers -----------------
export function safeStageAndSend(command, opts = {}) {
  // convenience wrapper used by UI: stage locally and try send to server staging bucket
  return stageChangeLocal(command, { sendToServer: true, endpoint: opts.stageEndpoint || '/api/staging/stage' });
}

export default {
  stageChangeLocal,
  safeStageAndSend,
  listStagedServer,
  discardStagedServer,
  commitStagedServer,
  fetchSnapshot,
};
