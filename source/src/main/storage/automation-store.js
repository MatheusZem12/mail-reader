const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Regras de automação ("limpadores"): cada regra guarda um termo de busca e,
// quando executada, move para a lixeira todos os e-mails da caixa de entrada
// que casem com esse termo (remetente/assunto/conteúdo). É só metadado local —
// a execução em si reaproveita a busca + exclusão que já existem.
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

// Cria (sem id) ou atualiza (com id existente) — devolve a lista completa já persistida.
function saveRule(rule) {
  const rules = getRules();
  const index = rule.id ? rules.findIndex((r) => r.id === rule.id) : -1;
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
