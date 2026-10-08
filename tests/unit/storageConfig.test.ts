import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { storageConfiguration } from '../../server/storageConfig.ts'

test('Node storage defaults durable and accepts configurable database, assets, backup and temporary mode', () => {
  const cwd = resolve(tmpdir(), 'dnd-config'), defaults = storageConfiguration([], {}, cwd)
  assert.deepEqual(defaults, { mode: 'durable', databasePath: join(cwd, '.dnd-data', 'rooms.sqlite'), assetsDirectory: join(cwd, '.dnd-data', 'assets'), backupDirectory: join(cwd, '.dnd-backups') })
  const configured = storageConfiguration(['--data-dir', 'saved', '--database', 'db/custom.sqlite', '--assets-dir', 'images', '--backup-dir', 'copies'], {}, cwd)
  assert.deepEqual(configured, { mode: 'durable', databasePath: join(cwd, 'db', 'custom.sqlite'), assetsDirectory: join(cwd, 'images'), backupDirectory: join(cwd, 'copies') })
  assert.equal(storageConfiguration(['--temporary'], {}, cwd).mode, 'temporary')
  assert.equal(storageConfiguration([], { DND_STORAGE_MODE: 'temporary', DND_DATA_DIR: 'saved' }, cwd).databasePath, join(cwd, 'saved', 'rooms.sqlite'))
  assert.throws(() => storageConfiguration(['--database'], {}, cwd), /Falta el valor/)
  assert.throws(() => storageConfiguration([], { DND_STORAGE_MODE: 'unknown' }, cwd), /temporary o durable/)
  assert.throws(() => storageConfiguration(['--assets-dir', 'saved', '--database', 'saved/db.sqlite'], {}, cwd), /fuera/)
  assert.throws(() => storageConfiguration(['--assets-dir', 'images', '--backup-dir', 'images/copies'], {}, cwd), /fuera/)
})
