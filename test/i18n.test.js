const test = require('node:test');
const assert = require('node:assert');
const { t, setLocale, normalizeLocale } = require('../js/i18n.js');

test('t() returns the string for the active locale', () => {
  setLocale('pt-BR');
  assert.strictEqual(t('status.adapterOn'), 'Bluetooth ligado');
});

test('t() falls back to English for a key missing from the active locale', () => {
  setLocale('es');
  assert.strictEqual(t('some.key.only.in.english'), 'Fallback English string');
});

test('t() falls back to the key itself when missing from both the active locale and English', () => {
  setLocale('en');
  assert.strictEqual(t('this.key.does.not.exist.anywhere'), 'this.key.does.not.exist.anywhere');
});

test('t() interpolates {vars} into the looked-up string', () => {
  setLocale('en');
  assert.strictEqual(t('discover.connected', { device: 'DualShock 4' }), 'Connected: DualShock 4');
});

test('t() interpolates {vars} in a non-English locale too', () => {
  setLocale('pt-BR');
  assert.strictEqual(t('discover.connected', { device: 'DualShock 4' }), 'Conectado: DualShock 4');
});

test('setLocale normalizes region/underscore variants to a shipped locale', () => {
  assert.strictEqual(normalizeLocale('pt-BR'), 'pt-BR');
  assert.strictEqual(normalizeLocale('pt_BR'), 'pt-BR');
  assert.strictEqual(normalizeLocale('pt'), 'pt-BR');
  assert.strictEqual(normalizeLocale('es-ES'), 'es');
  assert.strictEqual(normalizeLocale('en-US'), 'en');
  assert.strictEqual(normalizeLocale('fr-FR'), 'en');
  assert.strictEqual(normalizeLocale(undefined), 'en');
});

test('setLocale with an unsupported locale falls back to English strings', () => {
  setLocale('fr-FR');
  assert.strictEqual(t('status.adapterOn'), 'Adapter: on');
});
