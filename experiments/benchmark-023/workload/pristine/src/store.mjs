// Entry model, validation and JSONL persistence for the worklog ledger.

/** Domain validation error — every rule in this file reports through it. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Strict ISO calendar date: exactly YYYY-MM-DD and a real date. */
export function isValidDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Validate one entry (id excepted — the store assigns ids).
 * Rules: project 1..40 chars; minutes integer 1..1440; date strict
 * YYYY-MM-DD; note optional string of at most 200 chars.
 */
export function validateEntry(entry) {
  if (entry === null || typeof entry !== 'object') {
    throw new ValidationError('entry must be an object');
  }
  if (
    typeof entry.project !== 'string' ||
    entry.project.length < 1 ||
    entry.project.length > 40
  ) {
    throw new ValidationError('project must be a string of 1..40 characters');
  }
  if (!Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > 1440) {
    throw new ValidationError('minutes must be an integer between 1 and 1440');
  }
  if (!isValidDate(entry.date)) {
    throw new ValidationError(
      `date must be a valid YYYY-MM-DD calendar date, got ${JSON.stringify(entry.date)}`,
    );
  }
  if (
    entry.note !== undefined &&
    (typeof entry.note !== 'string' || entry.note.length > 200)
  ) {
    throw new ValidationError('note must be a string of at most 200 characters');
  }
  return true;
}

/** An empty store (an ordered list of entries). */
export function newStore() {
  return { entries: [] };
}

/** The next sequential id for a store: e0001, e0002, ... */
export function nextId(store) {
  return 'e' + String(store.entries.length + 1).padStart(4, '0');
}

/**
 * Validate and append one entry. The store assigns the id; the stored key
 * order is id, date, minutes, project, then note when present.
 */
export function addEntry(store, entry) {
  validateEntry({ ...entry });
  const record = {
    id: nextId(store),
    date: entry.date,
    minutes: entry.minutes,
    project: entry.project,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  };
  store.entries.push(record);
  return record;
}

function shape(entry) {
  return {
    id: entry.id,
    date: entry.date,
    minutes: entry.minutes,
    project: entry.project,
    ...(entry.note === undefined ? {} : { note: entry.note }),
  };
}

/**
 * Parse ledger text (JSON Lines). Blank lines are skipped; every other
 * line must be a valid worklog entry; violations throw ValidationError
 * with the 1-based line number.
 */
export function loadStore(text) {
  const store = newStore();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new ValidationError(`line ${i + 1} is not valid JSON`);
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new ValidationError(`line ${i + 1} is not a worklog entry`);
    }
    validateEntry(parsed);
    store.entries.push(shape(parsed));
  }
  return store;
}

/** Serialize a store back to JSON Lines (trailing newline when nonempty). */
export function serializeStore(store) {
  if (store.entries.length === 0) return '';
  return store.entries.map((e) => JSON.stringify(shape(e))).join('\n') + '\n';
}
