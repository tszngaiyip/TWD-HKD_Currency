// static/js/history_manager.js

const HISTORY_KEY = 'currencyPairHistory';
const MAX_HISTORY_ITEMS = 20;

class UserHistoryManager {
  constructor() {
    this.history = this.getHistory();
  }

  getHistory() {
    try {
      const historyJson = localStorage.getItem(HISTORY_KEY);
      return historyJson ? JSON.parse(historyJson) : [];
    } catch (e) {
      console.error('Error reading history from localStorage', e);
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch (e) {
      console.error('Error saving history to localStorage', e);
    }
  }

  addPair(buyCurrency, sellCurrency) {
    if (!buyCurrency || !sellCurrency) return;

    // Remove existing entry of the same pair to move it to the front
    this.history = this.history.filter(
      p => !(p.buy_currency === buyCurrency && p.sell_currency === sellCurrency)
    );

    // Add the new pair to the beginning of the array
    this.history.unshift({ buy_currency: buyCurrency, sell_currency: sellCurrency });

    // Enforce the history limit
    if (this.history.length > MAX_HISTORY_ITEMS) {
      this.history = this.history.slice(0, MAX_HISTORY_ITEMS);
    }

    this.saveHistory();
  }
}

export const userHistoryManager = new UserHistoryManager(); 