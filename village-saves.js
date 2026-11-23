const VillageSaves = (() => {
  const prefix = 'theLastHearth.profile.';
  const legacyKeys = ['theLastHearth.villageEngine.2', 'emberhollow.villageEngine.2'];
  const backupKind = 'emberhollow-save';
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const numberFields = (value, fields) => fields.every(field => Number.isFinite(value[field]));

  function validateProgress(progress) {
    const state = progress?.village;
    const invalid = () => { throw new Error('This is not a supported Emberhollow save.'); };
    if (!isRecord(state) || state.version !== 2 || !Array.isArray(progress.visited)
        || !progress.visited.every(place => place === null || typeof place === 'string')
        || !count(state.day) || state.day < 1 || !count(state.seed) || state.seed > 0xffffffff
        || !['guide', 'residents', 'farmers', 'bakers', 'spearmen', 'defenders'].every(field => count(state[field]))
        || !numberFields(state, ['grain', 'food', 'timber', 'stone', 'wallHealth', 'barracksLevel'])) invalid();

    if (state.opening && (!isRecord(state.opening) || !Object.hasOwn(OPENING_LESSONS, state.opening.phase)
        && state.opening.phase !== 'chapter-complete')) invalid();
    if (state.opening && (!isRecord(state.opening.plots) || !Object.entries(state.opening.plots)
        .every(([place, plot]) => Object.hasOwn(OPENING_BUILDINGS, place) && isRecord(plot)
          && count(plot.due) && typeof plot.ready === 'boolean'))) invalid();
    if (state.campaign != null) Campaign.normalize(state.campaign);
    if (state.campaign != null && (!state.opening || state.level !== 2 || !Campaign.validate(state.campaign))) invalid();
    if (state.dragon != null && (!isRecord(state.dragon) || !numberFields(state.dragon, ['health', 'reserve', 'favor']))) invalid();
    if (state.hunger != null && (!isRecord(state.hunger) || !numberFields(state.hunger, ['civilians', 'soldiers', 'dragon']))) invalid();
    if (state.result != null) {
      const result = state.result;
      if (!isRecord(result) || !['won', 'defeat', 'stall'].includes(result.status)
          || !numberFields(result, ['day', 'seed', 'attackerStrength', 'spearmen', 'casualties', 'wallBefore', 'wallAfter', 'dragonBefore', 'dragonAfter', 'dragonMax'])
          || typeof result.engine !== 'string' || !isRecord(result.plunder)
          || !numberFields(result.plunder, ['grain', 'provisions', 'timber', 'stone'])
          || !Array.isArray(result.rounds) || !result.rounds.every(round => isRecord(round)
            && numberFields(round, ['round', 'spearmen', 'dragonPower', 'wall'])
            && ['damage', 'dragonDamage', 'enemyAfter'].every(field => round[field] === undefined || Number.isFinite(round[field])))
          || (result.retreatAt !== undefined && !Number.isFinite(result.retreatAt))
          || (result.unprepared && (!isRecord(result.unprepared) || !numberFields(result.unprepared, ['wallAfter', 'rounds'])))) invalid();
    }

    const village = VillageEngine.restore(structuredClone(state));
    village.chiefName = typeof village.chiefName === 'string' ? village.chiefName.slice(0, 32) : 'Chief';
    village.villageName = typeof village.villageName === 'string' ? village.villageName.slice(0, 32) : DEFAULT_VILLAGE_NAME;
    for (const field of ['otherWorkers', 'woodcutters', 'quarrymen', 'level']) {
      village[field] ??= field === 'level' ? 1 : 0;
      if (!count(village[field])) invalid();
    }
    for (const field of ['raidDay', 'trainingDay', 'repairDay', 'upgradeDay', 'advancementDay']) {
      if (village[field] != null && !count(village[field])) invalid();
    }
    return { village, visited: [...progress.visited], speed: [1, 2, 3].includes(progress.speed) ? progress.speed : 1 };
  }

  function makeProfile(name, progress = null, id = crypto.randomUUID()) {
    const cleaned = typeof name === 'string' ? name.trim().slice(0, 32) : '';
    if (!cleaned) throw new Error('Enter a profile name.');
    return { id, name: cleaned, progress, savedAt: progress ? new Date().toISOString() : null, revision: crypto.randomUUID() };
  }

  function read(id) {
    const raw = localStorage.getItem(prefix + id);
    if (raw === null) return null;
    const profile = JSON.parse(raw);
    if (profile?.id !== id || typeof profile.name !== 'string' || typeof profile.revision !== 'string') {
      throw new Error('This profile could not be read.');
    }
    return profile;
  }

  function write(profile) {
    localStorage.setItem(prefix + profile.id, JSON.stringify(profile));
    return profile;
  }

  function migrateLegacy() {
    // Keep both original keys so updating the game never removes the prior save.
    if (localStorage.getItem(prefix + 'legacy') !== null) return;
    for (const key of legacyKeys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let progress;
      try {
        progress = validateProgress(JSON.parse(raw));
      } catch {
        continue;
      }
      write(makeProfile('Previous village', progress, 'legacy'));
      return;
    }
  }

  function list() {
    migrateLegacy();
    const profiles = [];
    let unreadable = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      try {
        const profile = read(key.slice(prefix.length));
        if (profile) profiles.push(profile);
      } catch {
        unreadable++;
      }
    }
    profiles.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '') || a.name.localeCompare(b.name));
    return { profiles, unreadable };
  }

  function save(profile, progress) {
    if (read(profile.id)?.revision !== profile.revision) {
      const error = new Error('This profile changed in another tab. Export this session to keep a copy.');
      error.name = 'SaveConflict';
      throw error;
    }
    return write({ ...profile, progress, savedAt: new Date().toISOString(), revision: crypto.randomUUID() });
  }

  function encode(name, progress) {
    return JSON.stringify({ kind: backupKind, version: 1, name, progress }, null, 2);
  }

  function importBackup(text) {
    const backup = JSON.parse(text);
    if (backup?.kind !== backupKind || backup.version !== 1) throw new Error('Unsupported backup.');
    const progress = validateProgress(backup.progress);
    const name = typeof backup.name === 'string' ? backup.name.trim().slice(0, 21) : '';
    return write(makeProfile(name ? `${name} (imported)` : 'Imported village', progress));
  }

  return { list, read, create: name => write(makeProfile(name)), save, validateProgress, encode, importBackup };
})();
