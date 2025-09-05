import { getCurrentGroupId } from './ui/components/groups.ui';

export const state = {
  // All transactions data
  transactions: [],
  // All dividends data
  dividends: [],
  // All stock splits data
  splits: [],
  // Currently selected group ID
  currentGroupId: null,
  // Detailed data for each stock symbol
  details: {},
  // Is data currently loading?
  isLoading: true,
  // Are all data loaded?
  isLoaded: false,
  // Sort preference for closed positions
  closedPositionsSort: 'profit', // 'profit' or 'date'

  /**
   * Resets the state to its initial values.
   */
  reset() {
    this.transactions = [];
    this.dividends = [];
    this.splits = [];
    this.currentGroupId = getCurrentGroupId();
    this.details = {};
    this.isLoading = true;
    this.isLoaded = false;
    this.closedPositionsSort = 'profit';
  },
};
