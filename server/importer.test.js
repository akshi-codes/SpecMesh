import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { appConfig } from './config.js';
import { allRows, closeDbForTests, getDb } from './db.js';
import { runHistoricalIngest } from './importer.js';

let tempRoot;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'token-monitor-'));
  appConfig.codexHome = path.join(tempRoot, '.codex');
  appConfig.dbPath = path.join(tempRoot, 'monitor.sqlite');
  fs.mkdirSync(path.join(appConfig.codexHome, 'sessions', '2026', '07', '02'), { recursive: true });
});

afterEach(() => {
  closeDbForTests();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('historical importer', () => {
  it('imports token metrics without persisting prompt or assistant content', async () => {
    const secretPrompt = 'PLEASE_DO_NOT_STORE_THIS_PROMPT';
    const secretAnswer = 'PLEASE_DO_NOT_STORE_THIS_ANSWER';
    const file = path.join(appConfig.codexHome, 'sessions', '2026', '07', '02', 'rollout-2026-07-02T01-02-03-019d8b00-bee1-7672-96f0-721b8672714d.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'thread.started', thread_id: '019d8b00-bee1-7672-96f0-721b8672714d', payload: { cwd: 'C:\\Projects\\Token Monitor', model: 'gpt-test' } }),
      JSON.stringify({ type: 'response_item', item: { type: 'message', text: secretPrompt } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5 }, text: secretAnswer })
    ].join('\n'));

    const result = await runHistoricalIngest();
    assert.equal(result.turnsImported, 1);

    const turns = allRows('SELECT * FROM turns');
    assert.equal(turns.length, 1);
    assert.equal(turns[0].input_tokens, 100);
    assert.equal(turns[0].output_tokens, 30);

    closeDbForTests();
    const dbBytes = fs.readFileSync(appConfig.dbPath, 'utf8');
    assert.equal(dbBytes.includes(secretPrompt), false);
    assert.equal(dbBytes.includes(secretAnswer), false);
  });

  it('skips denied token-like files', async () => {
    const denied = path.join(appConfig.codexHome, 'sessions', 'token-dump.jsonl');
    fs.writeFileSync(denied, JSON.stringify({ usage: { input_tokens: 999 } }));
    await runHistoricalIngest();
    getDb();
    assert.equal(allRows('SELECT * FROM turns').length, 0);
  });
});