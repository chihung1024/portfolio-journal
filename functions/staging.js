// =========================================================================================
// == Firebase Cloud Function: staging.js v1.0.0
// == 負責：提供 staging APIs，作為前端唯一後端交互窗口
// =========================================================================================

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const STAGING_COL = 'stagingCommands';
const SNAPSHOT_COL = 'snapshots';

// 工具：寫入 staging 指令
async function writeStagedCommand(uid, command) {
  const ref = db.collection(STAGING_COL).doc(command.id);
  const doc = {
    ...command,
    uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'PENDING',
  };
  await ref.set(doc, { merge: true });
  return doc;
}

// 工具：讀取 staging 指令列表
async function listStaged(uid) {
  const snap = await db.collection(STAGING_COL).where('uid', '==', uid).get();
  return snap.docs.map(d => d.data());
}

// 工具：丟棄 staging 指令
async function discardStaged(uid, ids) {
  const batch = db.batch();
  ids.forEach(id => {
    const ref = db.collection(STAGING_COL).doc(id);
    batch.delete(ref);
  });
  await batch.commit();
  return { discarded: ids };
}

// 工具：將 staging 指令 apply 到正式資料庫 (transactions, holdings 等)
async function applyCommand(uid, command) {
  // TODO: 根據 command.op 與 entity 分類應用到不同 collection
  // 這裡示範簡單寫入到 user/{uid}/appliedCommands
  const ref = db.collection('users').doc(uid).collection('appliedCommands').doc(command.id);
  await ref.set(command);
  return true;
}

// 工具：commit staging 指令
async function commitStaged(uid, batchSize = 100) {
  const snap = await db.collection(STAGING_COL).where('uid', '==', uid).limit(batchSize).get();
  const cmds = snap.docs.map(d => d.data());
  const results = [];

  for (const cmd of cmds) {
    try {
      await applyCommand(uid, cmd);
      await db.collection(STAGING_COL).doc(cmd.id).delete();
      results.push({ id: cmd.id, status: 'COMMITTED' });
    } catch (err) {
      results.push({ id: cmd.id, status: 'FAILED', error: err.message });
    }
  }
  return results;
}

// 工具：抓取 snapshot (給前端同步)
async function getSnapshot(uid) {
  // TODO: 改成實際計算 portfolio 狀態
  const userDoc = await db.collection('users').doc(uid).get();
  const data = userDoc.exists ? userDoc.data() : {};
  return { snapshot: data };
}

// ----------------- Cloud Function Exports -----------------

exports.stage = functions.https.onRequest(async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : 'demo';
    const { command } = req.body;
    const doc = await writeStagedCommand(uid, command);
    res.json({ ok: true, staged: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

exports.list = functions.https.onRequest(async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : 'demo';
    const list = await listStaged(uid);
    res.json({ ok: true, staged: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

exports.discard = functions.https.onRequest(async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : 'demo';
    const { ids } = req.body;
    const result = await discardStaged(uid, ids || []);
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

exports.commit = functions.https.onRequest(async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : 'demo';
    const { batchSize } = req.body;
    const result = await commitStaged(uid, batchSize || 100);
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

exports.snapshot = functions.https.onRequest(async (req, res) => {
  try {
    const uid = req.user ? req.user.uid : 'demo';
    const snap = await getSnapshot(uid);
    res.json({ ok: true, ...snap });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
