// Main application entry point
import { UIManager } from './ui.js';
import { ConversionManager } from './conversion.js';
import { MobileManager } from './mobile.js';

class App {
    constructor() {
        this.uiManager = new UIManager();
        this.conversionManager = new ConversionManager(this.uiManager);
        this.mobileManager = MobileManager;
    }

    init() {
        // Initialize mobile optimizations first
        this.mobileManager.init();
        
        // Initialize UI manager
        this.uiManager.init();
        
        // Initialize conversion manager
        this.conversionManager.init();
        
        // Export managers to global scope for onclick handlers
        window.uiManager = this.uiManager;
        window.conversionManager = this.conversionManager;
        
        console.log('8MB Video Converter App initialized');
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
