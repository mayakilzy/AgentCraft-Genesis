// Strict CLI argument parsing for worklog.
//
// Grammar: one optional command word, then any mix of values and flags.
// Long flags accept both "--name value" and "--name=value"; short flags
// accept "-x value" and inline "-xvalue". Every flag defined below takes
// a value; a valueless flag is an error. Unknown flags are errors.

import { ValidationError } from './store.mjs';

const LONG_FLAGS = new Set(['project', 'note', 'date', 'day', 'format', 'store']);
const SHORT_FLAGS = new Map([
  ['p', 'project'],
  ['n', 'note'],
  ['d', 'date'],
  ['f', 'format'],
  ['s', 'store'],
]);

/**
 * Parse an argv array into { command, positionals, flags }.
 * Throws ValidationError on unknown flags or missing flag values.
 */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      for (const rest of argv.slice(i + 1)) positionals.push(rest);
      break;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        const name = arg.slice(2, eq);
        if (!LONG_FLAGS.has(name)) {
          throw new ValidationError(`unknown flag --${name}`);
        }
        flags[name] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        if (!LONG_FLAGS.has(name)) {
          throw new ValidationError(`unknown flag --${name}`);
        }
        const next = argv[i + 1];
        if (next === undefined) {
          throw new ValidationError(`--${name} requires a value`);
        }
        flags[name] = next;
        i += 1;
      }
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const name = SHORT_FLAGS.get(arg.slice(1, 2));
      if (name === undefined) {
        throw new ValidationError(`unknown flag ${arg}`);
      }
      const inline = arg.slice(2);
      if (inline.length > 0) {
        flags[name] = inline;
      } else {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new ValidationError(`${arg} requires a value`);
        }
        flags[name] = next;
        i += 1;
      }
      continue;
    }

    if (command === null) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}
