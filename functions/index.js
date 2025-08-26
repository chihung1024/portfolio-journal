// =========================================================================================
// == Staging 模組（js/staging/index.js）v1.0.0
// == 功能：前端命令佇列（暫存區）實作 - staging / optimistic projection / commitAll
// =========================================================================================

import { getState, setState, pushStagedChange, removeStagedChange, clearStagedChanges, setCommitting, subscribe } from '../js/state.js';

// ---------- 公開 API ----------
// stageChange(command)             : 將一個命令推入暫存區（並選擇性做樂觀投影）
// listStaged()                     : 取得目前暫存命令清單
// discardStaged(id)                : 丟棄單一命令
// discardMany(ids)                 : 丟棄多筆命令
// clearAll()                       : 清空暫存區
// commitAll({batchSize, onProgress}) : 批次提交所有 PENDING 命令，回傳 server snapshot
// applyOptimisticProjection(cmd)   :（內部）把命令投影到前端狀態以提升使用者體驗
// rollbackOptimisticProjection(cmdIds) :（內部）回滾投影（當 commit 失敗或被 server 覆寫）

// ---------- 命令型態（範例） ----------
// {
//   id: 'uuid-v4',
//   op: 'CREATE' | 'UPDATE' | 'DELETE',
//   entity: 'transaction' | 'split' | 'dividend' | 'group_membership' | string,
//   payload: { ... },
//   createdAt: 'ISO',
//   idempotencyKey?: 'string',
//   meta?: { optimistic?: true }
// }

// ---------- 實作 ----------

function nowIso() { return new Date().toISOString(); }

function genId() {
  // 簡單 UUID v4 實作（瀏覽器端足夠）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function ensureCommandShape(cmd) {
  if (!cmd || typeof cmd !== 'object') throw new Error('invalid command');
  const id = cmd.id || genId();
  const createdAt = cmd.createdAt || nowIso();
  const op = cmd.op;
  const entity = cmd.entity;
  if (!op || !entity) throw new Error('command must include op and entity');
  return { ...cmd, id, createdAt };
}

export function stageChange(rawCommand) {
  const cmd = ensureCommandShape(rawCommand);

  // 推入 state 暫存區
  pushStagedChange({ ...cmd, status: 'PENDING' });

  // 樂觀投影（預設啟用，除非 meta.optimistic === false）
  if (cmd.meta && cmd.meta.optimistic === false) return cmd;
  try { applyOptimisticProjection(cmd); } catch (err) {
    console.warn('[staging] optimistic projection failed:', err);
  }
  return cmd;
}

export function listStaged() {
  return (getState().stagedChanges || []).slice();
}

export function discardStaged(id) {
  if (!id) return false;
  // 移除暫存區
  removeStagedChange(id);
  // 若之前做過樂觀投影，試著回滾
  try { rollbackOptimisticProjection([id]); } catch (err) {
    console.warn('[staging] rollback failed for', id, err);
  }
  return true;
}

export function discardMany(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return false;
  for (const id of ids) removeStagedChange(id);
  try { rollbackOptimisticProjection(ids); } catch (err) { console.warn('[staging] rollbackMany failed', err); }
  return true;
}

export function clearAll() {
  clearStagedChanges();
  // 無法精準知道要回滾哪些投影，建議重新同步整個快照
  // 標記需要重新從 server 載入
  setState({ lastSyncedAt: null });
}

// ---------- 樂觀投影（非常重要：這裡僅投影到前端 state, 不會呼叫 server） ----------
// 規則：
// - CREATE: 把 payload 加到對應的集合（若 entity 為 transaction, push 到 transactions）
// - UPDATE: 以 payload.id 為 key，merge 到集合中的對應項目
// - DELETE: 以 payload.id 為 key，從集合中移除
// 若遇到未知 entity，會寫入 state.marketDataForFrontend._debugStagingLog

function applyOptimisticProjection(cmd) {
  const s = getState();
  const { op, entity, payload, id } = cmd;
  // helper: write state safely
  const next = { ...s };

  const writeLog = (msg) => {
    const debug = next.marketDataForFrontend || {};
    const arr = debug._debugStagingLog || [];
    arr.push({ time: nowIso(), msg, cmdId: id });
    debug._debugStagingLog = arr.slice(-200); // keep last 200
    next.marketDataForFrontend = debug;
  };

  switch (entity) {
    case 'transaction': {
      const txs = Array.isArray(next.transactions) ? [...next.transactions] : [];
      if (op === 'CREATE') {
        // ensure payload has an id for client-side reference
        const clientId = payload.id || `client-${genId()}`;
        txs.push({ ...payload, id: clientId, _stagingId: id });
        next.transactions = txs;
        writeLog('optimistic CREATE transaction');
      } else if (op === 'UPDATE') {
        const idx = txs.findIndex(t => t.id === payload.id || t._stagingId === payload._stagingId);
        if (idx !== -1) { txs[idx] = { ...txs[idx], ...payload, _stagingId: id }; next.transactions = txs; writeLog('optimistic UPDATE transaction'); }
      } else if (op === 'DELETE') {
        const filtered = txs.filter(t => t.id !== payload.id);
        next.transactions = filtered; writeLog('optimistic DELETE transaction');
      }
      break;
    }
    case 'split': {
      const splits = Array.isArray(next.userSplits) ? [...next.userSplits] : [];
      if (op === 'CREATE') { splits.push({ ...payload, id: payload.id || `client-${genId()}`, _stagingId: id }); next.userSplits = splits; writeLog('optimistic CREATE split'); }
      else if (op === 'UPDATE') { const idx = splits.findIndex(s => s.id === payload.id); if (idx !== -1) { splits[idx] = { ...splits[idx], ...payload, _stagingId: id }; next.userSplits = splits; writeLog('optimistic UPDATE split'); } }
      else if (op === 'DELETE') { next.userSplits = splits.filter(s => s.id !== payload.id); writeLog('optimistic DELETE split'); }
      break;
    }
    case 'dividend': {
      const p = Array.isArray(next.pendingDividends) ? [...next.pendingDividends] : [];
      if (op === 'CREATE') { p.push({ ...payload, id: payload.id || `client-${genId()}`, _stagingId: id }); next.pendingDividends = p; writeLog('optimistic CREATE dividend'); }
      else if (op === 'UPDATE') { const idx = p.findIndex(d => d.id === payload.id); if (idx !== -1) { p[idx] = { ...p[idx], ...payload, _stagingId: id }; next.pendingDividends = p; writeLog('optimistic UPDATE dividend'); } }
      else if (op === 'DELETE') { next.pendingDividends = p.filter(d => d.id !== payload.id); writeLog('optimistic DELETE dividend'); }
      break;
    }
    case 'group_membership': {
      // assume payload: { groupId, userId, role }
      const notes = { ...(next.stockNotes || {}) };
      // for simplicity log the op
      writeLog(`optimistic ${op} group_membership`);
      next.stockNotes = notes;
      break;
    }
    default: {
      // unknown entity: append debug log
      writeLog(`unknown entity ${entity}`);
      break;
    }
  }

  // commit the derived state
  setState(next);
}

function rollbackOptimisticProjection(cmdIds = []) {
  if (!Array.isArray(cmdIds) || cmdIds.length === 0) return;
  const s = getState();
  const next = { ...s };

  // A pragmatic approach: if we detect any client-generated IDs (_stagingId) matching cmdIds,
  // remove those items or revert their content. This is conservative but simple.

  if (Array.isArray(next.transactions)) {
    next.transactions = next.transactions.filter(t => {
      if (!t._stagingId) return true;
      return !cmdIds.includes(t._stagingId);
    }).map(t => {
      // remove _stagingId if not removed
      const clone = { ...t };
      if (clone._stagingId && !cmdIds.includes(clone._stagingId)) delete clone._stagingId;
      return clone;
    });
  }

  if (Array.isArray(next.userSplits)) {
    next.userSplits = next.userSplits.filter(s => !s._stagingId || !cmdIds.includes(s._stagingId)).map(s => { const c = { ...s }; if (c._stagingId && !cmdIds.includes(c._stagingId)) delete c._stagingId; return c; });
  }

  if (Array.isArray(next.pendingDividends)) {
    next.pendingDividends = next.pendingDividends.filter(d => !d._stagingId || !cmdIds.includes(d._stagingId)).map(d => { const c = { ...d }; if (c._stagingId && !cmdIds.includes(c._stagingId)) delete c._stagingId; return c; });
  }

  // mark lastSyncedAt null to suggest full reload
  next.lastSyncedAt = null;
  setState(next);
}

// ---------- commitAll 實作 ----------

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

/**
 * commitAll options:
 *  - batchSize: number of commands to send per request (default 100)
 *  - onProgress: function({sent, total, lastResponse}) called after each batch
 *  - endpoint: server endpoint (default '/api/staging/commit')
 */
export async function commitAll(options = {}) {
  const { batchSize = 100, onProgress, endpoint = '/api/staging/commit' } = options || {};
  const staged = listStaged();
  if (!staged || staged.length === 0) return { ok: true, message: 'no staged commands', snapshot: null };

  setCommitting(true);
  try {
    // Prepare batches
    const pending = staged.filter(c => c.status !== 'COMMITTED' && c.status !== 'DISCARDED');
    const total = pending.length;
    let sent = 0;
    let lastResp = null;

    // send in batches
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      // create lightweight payload: id, op, entity, payload, idempotencyKey
      const payload = batch.map(c => ({ id: c.id, op: c.op, entity: c.entity, payload: c.payload, idempotencyKey: c.idempotencyKey || c.id }));

      // send to server
      try {
        lastResp = await postJson(endpoint, { commands: payload });
      } catch (err) {
        // if server returns 401/403, bubble up specific error
        setCommitting(false);
        // keep commands in staged area for retry
        throw err;
      }

      // on success: mark those commands committed locally (we rely on server snapshot to be authoritative)
      for (const cmd of batch) {
        // remove them from stagedChanges (server snapshot will be pulled next)
        removeStagedChange(cmd.id);
      }

      sent += batch.length;
      if (typeof onProgress === 'function') onProgress({ sent, total, lastResponse: lastResp });
    }

    // After all batches: request server snapshot (authoritative) to overwrite local state
    // expecting server returns { snapshot: { transactions:[], holdings:{}, ... } }
    // If server didn't return snapshot in lastResp, try fetch
    let snapshot = (lastResp && lastResp.snapshot) ? lastResp.snapshot : null;
    if (!snapshot) {
      // fallback: call a sync endpoint
      try {
        const syncResp = await postJson('/api/staging/snapshot', { reason: 'post_commit_sync' });
        snapshot = syncResp.snapshot || null;
      } catch (err) {
        console.warn('[staging] failed fetch snapshot after commit:', err);
      }
    }

    // If we have snapshot, merge it into state (overwrite authoritative parts)
    if (snapshot) {
      const base = getState();
      const next = { ...base };
      // Overwrite known top-level collections if present in snapshot
      if (snapshot.transactions) next.transactions = snapshot.transactions;
      if (snapshot.userSplits) next.userSplits = snapshot.userSplits;
      if (snapshot.pendingDividends) next.pendingDividends = snapshot.pendingDividends;
      if (snapshot.confirmedDividends) next.confirmedDividends = snapshot.confirmedDividends;
      if (snapshot.holdings) next.holdings = snapshot.holdings;
      if (snapshot.marketDataForFrontend) next.marketDataForFrontend = snapshot.marketDataForFrontend;
      next.lastSyncedAt = nowIso();
      // ensure stagedChanges is refreshed from local (should be empty)
      next.stagedChanges = listStaged();
      setState(next);
    } else {
      // no snapshot: at least mark lastSyncedAt null -> suggest UI to reload
      setState({ lastSyncedAt: null, stagedChanges: listStaged() });
    }

    setCommitting(false);
    return { ok: true, message: 'committed', snapshot };
  } catch (err) {
    setCommitting(false);
    // keep staged changes as-is for retry; bubble error
    throw err;
  }
}

// ---------- 監聽 state.stagedChanges 的變動（例：自動送出或展示） ----------
// 這裡提供一個簡單的 observer hook，可以由 app 在初始化時呼叫
export function initStagingAutoWatcher({ autoCommitOnNetwork = false, networkCheckFn } = {}) {
  // networkCheckFn: async () => boolean
  let unsub = subscribe((next) => {
    // if committing flag set by other tab, ignore
    if (next.isCommitting) return;
    const staged = next.stagedChanges || [];
    if (staged.length === 0) return;
    // optional: auto-commit when online and setting enabled
    if (autoCommitOnNetwork && typeof networkCheckFn === 'function') {
      networkCheckFn().then(online => {
        if (online) {
          // best-effort commit; errors are logged but won't crash
          commitAll().catch(err => console.warn('[staging] autoCommit failed', err));
        }
      }).catch(() => {});
    }
  });
  return () => { if (typeof unsub === 'function') unsub(); };
}

// ---------- 結束 ----------

export default {
  stageChange,
  listStaged,
  discardStaged,
  discardMany,
  clearAll,
  commitAll,
  initStagingAutoWatcher,
};
