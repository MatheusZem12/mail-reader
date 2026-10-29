const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Automation rules ("cleaners"): each rule holds one or more senders and,
// when run, moves to the trash every inbox e-mail RECEIVED from them — the
// sender's address is split on its special characters and some piece has to
// equal the term (a mention in the subject/body doesn't count — the renderer
// filters that out). It is only local metadata — the run itself reuses the
// search + deletion that already exist.
const RULES_FILE = 'automation-rules.json';

function getRulesPath() {
  return path.join(app.getPath('userData'), RULES_FILE);
}

function getRules() {
  try {
    const data = JSON.parse(fs.readFileSync(getRulesPath(), 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRules(rules) {
  fs.writeFileSync(getRulesPath(), JSON.stringify(rules, null, 2));
  return rules;
}

// Equal names make it impossible to tell two rules apart in the list (and in
// "run all"). Compares ignoring case, accents and surrounding spaces.
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Creates (no id) or updates (existing id) — returns the full, already persisted list.
function saveRule(rule) {
  const rules = getRules();
  const index = rule.id ? rules.findIndex((r) => r.id === rule.id) : -1;

  // Only validates when the name is part of the write — partial updates
  // (enabled, lastRunAt) don't send `name` and must not run into this.
  if (rule.name != null) {
    const target = normalizeName(rule.name);
    const clash = rules.some((r, i) => i !== index && normalizeName(r.name) === target);
    if (clash) throw new Error(`An automation named "${String(rule.name).trim()}" already exists.`);
  }

  if (index === -1) {
    rules.push({ ...rule, createdAt: rule.createdAt || Date.now() });
  } else {
    rules[index] = { ...rules[index], ...rule };
  }
  return saveRules(rules);
}

function deleteRule(id) {
  return saveRules(getRules().filter((r) => r.id !== id));
}

module.exports = { getRules, saveRule, deleteRule };
