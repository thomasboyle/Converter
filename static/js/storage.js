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
}
