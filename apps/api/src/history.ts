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
      status TEXT NOT NULL, criteria_json TEXT NOT NULL, note TEXT NOT NULL, results_json TEXT NOT NULL,
      issues_json TEXT NOT NULL DEFAULT '[]'
    )`);
    const columns = this.db.pragma('table_info(operations)') as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'issues_json')) {
      this.db.exec("ALTER TABLE operations ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]'");
    }
  }
  save(record: OperationRecord) {
    this.db.prepare('INSERT INTO operations (id, created_at, user_name, status, criteria_json, note, results_json, issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.createdAt, record.user, record.status, JSON.stringify(record.criteria), record.note, JSON.stringify(record.results), JSON.stringify(record.issues));
  }
  list(): OperationRecord[] {
    const rows = this.db.prepare('SELECT * FROM operations ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ id:r.id, createdAt:r.created_at, user:r.user_name, status:r.status, criteria:JSON.parse(r.criteria_json), note:r.note, results:JSON.parse(r.results_json), issues:JSON.parse(r.issues_json) }));
  }
  close() { this.db.close(); }
}

