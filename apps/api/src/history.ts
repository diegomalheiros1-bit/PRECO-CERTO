import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OperationRecord } from '@preco-certo/domain';

export class HistoryRepository {
  private db: Database.Database;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, user_name TEXT NOT NULL,
      status TEXT NOT NULL, criteria_json TEXT NOT NULL, note TEXT NOT NULL, results_json TEXT NOT NULL
    )`);
  }
  save(record: OperationRecord) {
    this.db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?)').run(record.id, record.createdAt, record.user, record.status, JSON.stringify(record.criteria), record.note, JSON.stringify(record.results));
  }
  list(): OperationRecord[] {
    const rows = this.db.prepare('SELECT * FROM operations ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ id:r.id, createdAt:r.created_at, user:r.user_name, status:r.status, criteria:JSON.parse(r.criteria_json), note:r.note, results:JSON.parse(r.results_json) }));
  }
  close() { this.db.close(); }
}

