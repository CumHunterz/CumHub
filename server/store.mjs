import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(dataDir, 'hub.sqlite'));
    try { chmodSync(path.join(dataDir, 'hub.sqlite'), 0o600); } catch {}
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);`);
  }
  projects() { return this.db.prepare('SELECT data FROM projects').all().map(row => JSON.parse(row.data)); }
  project(id) { const row = this.db.prepare('SELECT data FROM projects WHERE id = ?').get(id); return row ? JSON.parse(row.data) : null; }
  saveProject(project) { this.db.prepare('INSERT OR REPLACE INTO projects VALUES (?, ?)').run(project.id, JSON.stringify(project)); return project; }
  deleteProject(id) { this.db.prepare('DELETE FROM projects WHERE id = ?').run(id); }
  runs() { return this.db.prepare('SELECT data FROM runs ORDER BY created_at DESC').all().map(row => JSON.parse(row.data)); }
  run(id) { const row = this.db.prepare('SELECT data FROM runs WHERE id = ?').get(id); return row ? JSON.parse(row.data) : null; }
  saveRun(run) { this.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?, ?)').run(run.id, run.projectId, run.createdAt, JSON.stringify(run)); return run; }
  log(type, message, projectId = null) {
    const entry = { type, message, projectId, time: new Date().toISOString() };
    this.db.prepare('INSERT INTO activity(data) VALUES (?)').run(JSON.stringify(entry));
    this.db.exec('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 300)');
  }
  activity() { return this.db.prepare('SELECT id, data FROM activity ORDER BY id DESC LIMIT 100').all().map(row => ({ id: row.id, ...JSON.parse(row.data) })); }
  transaction(fn) { this.db.exec('BEGIN'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close() { this.db.close(); }
}
