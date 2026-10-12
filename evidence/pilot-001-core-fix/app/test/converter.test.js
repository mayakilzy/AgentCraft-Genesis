import { test } from 'node:test';
import assert from 'node:assert';
import { cToF, fToC } from '../converter.js';

test('celsius to fahrenheit conversion', () => {
  // Test case 1: 0°C should be 32°F
  assert.strictEqual(cToF(0), 32);
  
  // Test case 2: 100°C should be 212°F
  assert.strictEqual(cToF(100), 212);
  
  // Test case 3: -40°C should be -40°F
  assert.strictEqual(cToF(-40), -40);
  
  // Test case 4: 37°C should be approximately 98.6°F
  assert.strictEqual(cToF(37), 98.6);
});

test('fahrenheit to celsius conversion', () => {
  // Test case 1: 32°F should be 0°C
  assert.strictEqual(fToC(32), 0);
  
  // Test case 2: 212°F should be 100°C
  assert.strictEqual(fToC(212), 100);
  
  // Test case 3: -40°F should be -40°C
  assert.strictEqual(fToC(-40), -40);
  
  // Test case 4: 98.6°F should be approximately 37°C
  assert.strictEqual(fToC(98.6), 37);
});