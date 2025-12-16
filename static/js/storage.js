const CACHE = new Map();
const TTL = 864e5; // 24 hours
const LIM = 3;

// Invalidate cache when other tabs modify storage
window.addEventListener('storage', e => CACHE.delete(e.key));

export class StorageManager {
    static STORAGE_TTL = TTL;
    static MAX_HISTORY_ITEMS = LIM;

    static _save(key, val) {
        try {
            const data = { ...val, timestamp: Date.now() };
            CACHE.set(key, data);
            localStorage.setItem(key, JSON.stringify(data));
        } catch (e) { }
    }

    static _get(key, clearFromStorage = false) {
        try {
            let data = CACHE.get(key);
            if (!data) {
                const raw = localStorage.getItem(key);
                if (!raw) return null;
                data = JSON.parse(raw);
                CACHE.set(key, data);
            }
            if (Date.now() - data.timestamp > TTL) {
                this._clear(key);
                return null;
            }
            return data;
        } catch (e) {
            if (clearFromStorage) this._clear(key);
            return null;
        }
    }

    static _clear(key) {
        try {
            CACHE.delete(key);
            localStorage.removeItem(key);
        } catch (e) { }
    }

    static saveActiveJob(jobId, format) {
        this._save('activeJob', { jobId, format });
    }

    static getActiveJob() {
        return this._get('activeJob', true);
    }

    static clearActiveJob() {
        this._clear('activeJob');
    }

    static saveCompletedResult(gifUrl, params, format) {
        this._save('completedResult', { gifUrl, params: params || null, format });
        this.clearActiveJob();
    }

    static getCompletedResult() {
        return this._get('completedResult', true);
    }

    static clearCompletedResult() {
        this._clear('completedResult');
    }

    static saveToHistory(url, format, params) {
        const history = this.getHistory();
        history.unshift({
            url,
            format,
            params: params || null,
            timestamp: Date.now(),
            date: new Date().toLocaleString()
        });
        if (history.length > LIM) history.length = LIM;

        // Custom serialization for history array to match generic structure expected by readers
        // or just store the array directly?
        // Original code: localStorage.setItem('conversionHistory', JSON.stringify(history));
        // Original getHistory: JSON.parse -> filter -> return
        // Our _save wraps in { timestamp, ...val }. 
        // THIS IS A BEHAVIOR CHANGE RISK. 
        // Original saveToHistory saved ARRAY directly, not wrapped object.
        // We must handle history differently or adapt _save.

        try {
            localStorage.setItem('conversionHistory', JSON.stringify(history));
            CACHE.set('conversionHistory', history); // Cache the array directly
        } catch (e) { }
    }

    static getHistory() {
        try {
            let history = CACHE.get('conversionHistory');
            if (!history) {
                const raw = localStorage.getItem('conversionHistory');
                if (!raw) return [];
                history = JSON.parse(raw);
            }

            const now = Date.now();
            const valid = history.filter(e => now - e.timestamp < TTL);

            if (valid.length !== history.length) {
                localStorage.setItem('conversionHistory', JSON.stringify(valid));
                CACHE.set('conversionHistory', valid);
                return valid;
            }

            CACHE.set('conversionHistory', history);
            return history;
        } catch (e) {
            return [];
        }
    }

    static clearHistory() {
        this._clear('conversionHistory');
    }

    static getAutoDownload() {
        return localStorage.getItem('autoDownload') === 'true';
    }

    static setAutoDownload(enabled) {
        localStorage.setItem('autoDownload', enabled);
    }
}
