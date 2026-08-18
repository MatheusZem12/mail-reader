const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// Regras de automação ("limpadores"): cada regra guarda um ou mais remetentes
// e, quando executada, move para a lixeira todos os e-mails da caixa de
// entrada RECEBIDOS deles — o e-mail de quem enviou é quebrado nos caracteres
// especiais e algum pedaço tem que ser igual ao termo (menção no assunto/corpo
// não conta — quem filtra isso é o renderer). É só metadado local — a execução
// em si reaproveita a busca + exclusão que já existem.
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

// Nomes iguais tornam impossível distinguir duas regras na lista (e no
// "executar todas"). Compara ignorando caixa, acento e espaço nas pontas.
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Cria (sem id) ou atualiza (com id existente) — devolve a lista completa já persistida.
function saveRule(rule) {
  const rules = getRules();
  const index = rule.id ? rules.findIndex((r) => r.id === rule.id) : -1;

  // Só valida quando o nome faz parte da gravação — atualizações parciais
  // (enabled, lastRunAt) não mandam `name` e não devem esbarrar nisso.
  if (rule.name != null) {
    const target = normalizeName(rule.name);
    const clash = rules.some((r, i) => i !== index && normalizeName(r.name) === target);
    if (clash) throw new Error(`Já existe uma automação chamada "${String(rule.name).trim()}".`);
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
