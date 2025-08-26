import { initAuth, checkAuth } from './auth.js';
import { showLoading, hideLoading } from './ui/utils.js';
import { renderDashboard } from './ui/dashboard.js';
import { initializeState } from './state.js';
import { initializeGeneralEventListeners } from './events/general.events.js';
import { initializeTransactionEventListeners } from './events/transaction.events.js';
import { initializeDividendEventListeners } from './events/dividend.events.js';
import { initializeSplitEventListeners } from './events/split.events.js';
import { initializeGroupEventListeners } from './events/group.events.js';
import { initializeStagingEventListeners } from './events/staging.events.js';
import { setupTheme } from './ui/utils.js';
import { stagingService } from './staging.service.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    showLoading();
    setupTheme();
    initAuth();

    const user = await checkAuth();
    if (user) {
      await stagingService.init();
      await initializeState();
      renderDashboard(getState());
      initializeGeneralEventListeners();
      initializeTransactionEventListeners();
      initializeDividendEventListeners();
      initializeSplitEventListeners();
      initializeGroupEventListeners();
      initializeStagingEventListeners();
    }
  } catch (error) {
    console.error('Initialization failed:', error);
  } finally {
    hideLoading();
  }
});