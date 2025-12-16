// Storage utilities for job persistence and result caching
export class StorageManager {
    static STORAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours

    static saveToStorage(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
        } catch (e) {
            console.warn(`Failed to save ${key} to localStorage:`, e);
        }
    }

    static getFromStorage(key, clearFn) {
        try {
            const saved = localStorage.getItem(key);
            if (!saved) return null;
            const data = JSON.parse(saved);
            if (Date.now() - data.timestamp > this.STORAGE_TTL) {
                clearFn();
                return null;
            }
            return data;
        } catch (e) {
            console.warn(`Failed to get ${key} from localStorage:`, e);
            clearFn();
            return null;
        }
    }

    static clearFromStorage(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn(`Failed to clear ${key} from localStorage:`, e);
        }
    }

    // Job persistence functions
    static saveActiveJob(jobId, format) {
        this.saveToStorage('activeJob', { jobId, format });
    }

    static getActiveJob() {
        return this.getFromStorage('activeJob', this.clearActiveJob.bind(this));
    }

    static clearActiveJob() {
        this.clearFromStorage('activeJob');
    }

    // Completed result persistence functions
    static saveCompletedResult(gifUrl, params, format) {
        this.saveToStorage('completedResult', { gifUrl, params: params || null, format });
        this.clearActiveJob();
    }

    static getCompletedResult() {
        return this.getFromStorage('completedResult', this.clearCompletedResult.bind(this));
    }

    static clearCompletedResult() {
        this.clearFromStorage('completedResult');
    }

    // Conversion history functions (Feature 8)
    static MAX_HISTORY_ITEMS = 5;

    static saveToHistory(url, format, params) {
        try {
            const history = this.getHistory() || [];
            const newEntry = {
                url,
                format,
                params: params || null,
                timestamp: Date.now(),
                date: new Date().toLocaleString()
            };

            // Add to beginning, limit to MAX_HISTORY_ITEMS
            history.unshift(newEntry);
            if (history.length > this.MAX_HISTORY_ITEMS) {
                history.pop();
            }

            localStorage.setItem('conversionHistory', JSON.stringify(history));
        } catch (e) {
            console.warn('Failed to save to history:', e);
        }
    }

    static getHistory() {
        try {
            const saved = localStorage.getItem('conversionHistory');
            if (!saved) return [];

            const history = JSON.parse(saved);
            // Filter out expired entries (24 hours)
            const validHistory = history.filter(entry =>
                Date.now() - entry.timestamp < this.STORAGE_TTL
            );

            // Update storage if items were filtered out
            if (validHistory.length !== history.length) {
                localStorage.setItem('conversionHistory', JSON.stringify(validHistory));
            }

            return validHistory;
        } catch (e) {
            console.warn('Failed to get history:', e);
            return [];
        }
    }

    static clearHistory() {
        this.clearFromStorage('conversionHistory');
    }

    // Auto-download preference (Feature 5)
    static getAutoDownload() {
        try {
            return localStorage.getItem('autoDownload') === 'true';
        } catch (e) {
            return false;
        }
    }

    static setAutoDownload(enabled) {
        try {
            localStorage.setItem('autoDownload', enabled ? 'true' : 'false');
        } catch (e) {
            console.warn('Failed to save auto-download preference:', e);
        }
    }
}
