import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { HistoryRepository } from './history.js';

describe('migração do histórico local', () => {
  it('preserva registros anteriores e acrescenta motivos separados', () => {
    const directory = mkdtempSync(join(tmpdir(), 'preco-certo-history-'));
    const path = join(directory, 'historico.sqlite');
    try {
      const old = new Database(path);
      old.exec('CREATE TABLE operations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, user_name TEXT NOT NULL, status TEXT NOT NULL, criteria_json TEXT NOT NULL, note TEXT NOT NULL, results_json TEXT NOT NULL)');
      old.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?)').run('old-1', '2026-01-01T00:00:00.000Z', 'antigo', 'simulated', '{}', 'simulado', '[]');
      old.close();

      const history = new HistoryRepository(path);
      expect(history.list()[0]).toMatchObject({ id: 'old-1', issues: [], results: [] });
      history.close();
    } finally {
      // Only files created inside this exact temporary directory are removed.
      for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
      rmdirSync(directory);
    }
  });
});
