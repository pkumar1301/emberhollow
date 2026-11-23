// Shared test harness: loads the browser scripts into a Node VM and resolves battles through the Python adapter.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadGame() {
  const context = { structuredClone, Math, Object, Array, Number, String, JSON, console };
  vm.createContext(context);
  for (const file of ['campaign-engine.js', 'campaign-events.js']) {
    const source = readFileSync(path.join(root, file), 'utf8').replace(/^const (\w+) =/m, 'globalThis.$1 =');
    vm.runInContext(source, context, { filename: file });
  }
  return { Campaign: context.Campaign, CampaignEvents: context.CampaignEvents };
}

export class BattleServer {
  constructor() {
    this.process = spawn('python3', [path.join(root, 'tests', 'battle_server.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.pending = new Map();
    this.next = 0;
    createInterface({ input: this.process.stdout }).on('line', line => {
      const message = JSON.parse(line);
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result);
    });
  }
  resolve(snapshot) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify({ id, snapshot }) + '\n');
    });
  }
  close() { this.process.stdin.end(); }
}

// A village at the end of the opening chapter, as VillageEngine hands it to Campaign.start.
export function openingVillage(seed, overrides = {}) {
  return {
    day: 50, residents: 10, spearmen: 3, barracksLevel: 2, wallHealth: 100, grain: 30, food: 30, timber: 30, stone: 30,
    dragon: { reserve: 10, health: 60, favor: 65 }, farmers: 3, bakers: 2, woodcutters: 1, quarrymen: 1,
    result: { status: 'won' }, campaignSeed: seed >>> 0, altarBlessing: 'harvest', ...overrides
  };
}
