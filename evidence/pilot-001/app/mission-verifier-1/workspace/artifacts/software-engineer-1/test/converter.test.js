import test from 'node:test';
import { strictEqual } from 'node:assert';
import { cToF, fToC } from '../converter.js';

test('cToF function converts correctly', () => {
  strictEqual(cToF(0), 32); // 0°C is 32°F
  strictEqual(cToF(100), 212); // 100°C is 212°F
  strictEqual(cToF(-40), -40); // -40°C is -40°F
});

test('fToC function converts correctly', () => {
  strictEqual(fToC(32), 0); // 32°F is 0°C
  strictEqual(fToC(212), 100); // 212°F is 100°C
  strictEqual(fToC(-40), -40); // -40°F is -40°C
});