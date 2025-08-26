// =========================================================================================
// == 前端管理 UI: StagingConsole.jsx v1.0.0
// == 提供開發者或管理員檢視、操作 staging 區的控制台
// =========================================================================================

import React, { useEffect, useState } from 'react';
import { stagingService } from '../src/stagingService';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function StagingConsole() {
  const [commands, setCommands] = useState([]);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await stagingService.list();
      setCommands(list);
      const snap = await stagingService.snapshot();
      setSnapshot(snap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleCommit = async () => {
    await stagingService.commit();
    await refresh();
  };

  const handleDiscard = async () => {
    const ids = commands.map(c => c.id);
    await stagingService.discard(ids);
    await refresh();
  };

  return (
    <div className="p-4 grid gap-4">
      <Card className="shadow-lg">
        <CardContent>
          <h2 className="text-xl font-bold mb-2">Staging Console</h2>
          <div className="flex gap-2 mb-4">
            <Button onClick={refresh} disabled={loading}>Refresh</Button>
            <Button onClick={handleCommit} disabled={loading || commands.length === 0}>Commit</Button>
            <Button onClick={handleDiscard} disabled={loading || commands.length === 0}>Discard</Button>
          </div>

          <h3 className="text-lg font-semibold mb-2">Queued Commands</h3>
          <ul className="list-disc ml-6 mb-4">
            {commands.map(c => (
              <li key={c.id}>
                [{c.action}] {c.type} → {JSON.stringify(c.payload)}
              </li>
            ))}
          </ul>

          <h3 className="text-lg font-semibold mb-2">Snapshot</h3>
          <pre className="bg-gray-100 p-2 rounded text-sm overflow-x-auto">
            {snapshot ? JSON.stringify(snapshot, null, 2) : 'No snapshot'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
