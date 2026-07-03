import { renderTermsScreen } from './screens/terms-screen.js';
import { renderSettingsScreen } from './screens/settings-screen.js';
import { renderLoginScreen } from './screens/login-screen.js';
import { renderListScreen } from './screens/list-screen.js';
import { getTerms, getOAuthStatus } from './services/email-api.js';

const app = document.getElementById('app');

const state = {
  screen: 'login',
  params: {},
};

export function navigate(screen, params = {}) {
  state.screen = screen;
  state.params = params;
  render();
}

// Depois do aceite dos termos: sem provedor configurado → tela de configuração.
export async function routeAfterTerms() {
  const status = await getOAuthStatus();
  navigate(!status.google && !status.microsoft ? 'settings' : 'login');
}

async function init() {
  const terms = await getTerms();
  if (!terms.accepted) {
    navigate('terms', { terms });
    return;
  }
  await routeAfterTerms();
}

function render() {
  app.innerHTML = '';
  switch (state.screen) {
    case 'terms':
      renderTermsScreen(app, state.params.terms);
      break;
    case 'settings':
      renderSettingsScreen(app);
      break;
    case 'login':
      renderLoginScreen(app);
      break;
    case 'list':
      renderListScreen(app);
      break;
    default:
      renderLoginScreen(app);
  }
}

init();
