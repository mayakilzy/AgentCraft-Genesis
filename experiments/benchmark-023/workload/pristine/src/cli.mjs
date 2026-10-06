// The worklog command line interface.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { renderTable, toCSV, toJSON } from './format.mjs';
import { parseArgs } from './parse.mjs';
import { formatDuration, summarize } from './report.mjs';
import {
  ValidationError,
  addEntry,
  loadStore,
  serializeStore,
} from './store.mjs';

const USAGE = [
  'worklog — a tiny time-tracking ledger',
  '',
  'usage:',
  '  cli.mjs add <minutes> --project <name> [--note <text>] [--date <YYYY-MM-DD>]',
  '  cli.mjs list [--day <YYYY-MM-DD>] [--project <name>]',
  '  cli.mjs summary [--day <YYYY-MM-DD>]',
  '  cli.mjs export [--format csv|json]',
  '',
  'options:',
  '  --store <path>        ledger file (default: worklog.jsonl)',
  '  --project, -p <name>  project name for add / filter for list',
  '  --note, -n <text>     note attached to an added entry',
  '  --date, -d <date>     date for an added entry (default: today)',
  '  --day <date>          restrict list/summary to one calendar day',
  '  --format, -f <fmt>    export format: csv (default) or json',
  '  --help, -h            show this help',
].join('\n');

function today() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

function readStoreFile(path) {
  if (!existsSync(path)) return { entries: [] };
  return loadStore(readFileSync(path, 'utf8'));
}

/**
 * Run the CLI against an argv array. Filesystem effects go to `storePath`
 * (from --store, default worklog.jsonl) in the process CWD. Returns
 * { stdout, stderr?, exitCode } — pure with respect to the terminal.
 */
export function cliMain(argv) {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { stdout: USAGE, exitCode: 0 };
  }

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    return {
      stdout: '',
      stderr: `${error.message}\n${USAGE}`,
      exitCode: 2,
    };
  }
  const { command, positionals, flags } = parsed;
  const storePath = flags.store ?? 'worklog.jsonl';

  try {
    if (command === 'add') {
      if (positionals.length !== 1) {
        throw new ValidationError('add requires exactly one <minutes> argument');
      }
      const minutes = Number(positionals[0]);
      if (!Number.isInteger(minutes)) {
        throw new ValidationError('minutes must be an integer');
      }
      if (flags.project === undefined) {
        throw new ValidationError('add requires --project <name>');
      }
      const store = readStoreFile(storePath);
      const entry = addEntry(store, {
        minutes,
        project: flags.project,
        ...(flags.note === undefined ? {} : { note: flags.note }),
        date: flags.date ?? today(),
      });
      writeFileSync(storePath, serializeStore(store), 'utf8');
      return { stdout: `added ${entry.id}`, exitCode: 0 };
    }

    if (command === 'list') {
      const store = readStoreFile(storePath);
      let entries = store.entries;
      if (flags.day !== undefined) {
        entries = entries.filter((e) => e.date === flags.day);
      }
      if (flags.project !== undefined) {
        entries = entries.filter((e) => e.project === flags.project);
      }
      if (entries.length === 0) {
        return { stdout: '(no entries)', exitCode: 0 };
      }
      const table = renderTable(
        ['ID', 'DATE', 'MINUTES', 'PROJECT', 'NOTE'],
        entries.map((e) => [e.id, e.date, e.minutes, e.project, e.note ?? '']),
      );
      return { stdout: table, exitCode: 0 };
    }

    if (command === 'summary') {
      const store = readStoreFile(storePath);
      const { rows, total, count } = summarize(store.entries, {
        ...(flags.day === undefined ? {} : { day: flags.day }),
      });
      if (count === 0) {
        return { stdout: '(no entries)', exitCode: 0 };
      }
      const table = renderTable(
        ['PROJECT', 'TIME', 'ENTRIES'],
        rows.map((r) => [r.project, formatDuration(r.minutes), r.entries]),
      );
      return { stdout: `${table}\ntotal: ${formatDuration(total)}`, exitCode: 0 };
    }

    if (command === 'export') {
      if (flags.format !== undefined && flags.format !== 'csv' && flags.format !== 'json') {
        throw new ValidationError('export --format must be csv or json');
      }
      const store = readStoreFile(storePath);
      const format = flags.format ?? 'csv';
      return {
        stdout: format === 'json' ? toJSON(store.entries) : toCSV(store.entries),
        exitCode: 0,
      };
    }

    return {
      stdout: '',
      stderr: `unknown or missing command: ${JSON.stringify(command ?? null)}\n${USAGE}`,
      exitCode: 2,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { stdout: '', stderr: `error: ${error.message}`, exitCode: 2 };
    }
    return {
      stdout: '',
      stderr: `error: ${error.message}`,
      exitCode: 1,
    };
  }
}

// Process entry point — only when executed as a script.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = cliMain(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}
