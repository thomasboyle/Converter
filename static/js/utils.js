// Utility functions and HTML templates
export class Utils {
    // Mobile device detection
    static get isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // HTML template utilities
    static createLoadingContainer(text) {
        return `
            <div class="loading-container">
                <div class="loader"></div>
                <p class="loading-text">${text}</p>
            </div>
        `;
    }

    static createErrorMessage(message, emoji = '❌') {
        return `
            <div style="text-align: center; color: #dc3545; font-weight: bold;">
                ${emoji} ${message}
            </div>
        `;
    }

    static createSuccessMessage(message, emoji = '✅') {
        return `
            <div style="text-align: center; color: #28a745; font-weight: bold;">
                ${emoji} ${message}
            </div>
        `;
    }

    // Format utilities
    static getExtensionForFormat(format) {
        const extensions = {
            'avif': '.avif',
            'webp': '.webp', 
            'mp4': '.mp4',
            'av1': '.mp4',
            'gif': '.gif'
        };
        return extensions[format] || '.avif';
    }

    static getFormatLabel(format) {
        const labels = {
            'gif': 'GIF',
            'webp': 'WebP',
            'mp4': 'MP4', 
            'av1': 'AV1',
            'avif': 'AVIF'
        };
        return labels[format] || 'AVIF';
    }

    // Emergency memory cleanup
    static emergencyCleanup() {
        try {
            console.log('Emergency memory cleanup initiated');

            // Clear all media elements with relevant sources
            const mediaElements = document.querySelectorAll('img, video');
            mediaElements.forEach(media => {
                if (media.src && (media.src.includes('/gifs/') || media.src.includes('.avif') || media.src.includes('.gif') || media.src.includes('.mp4'))) {
                    if (media.tagName === 'VIDEO') {
                        media.pause();
                        media.removeAttribute('src');
                        media.load();
                    } else {
                        media.src = '';
                    }
                    media.style.display = 'none';
                }
            });
            
            // Force garbage collection if available
            if (window.gc) {
                window.gc();
            }
            
            console.log('Emergency cleanup completed');
        } catch (e) {
            console.error('Emergency cleanup failed:', e);
        }
    }

    // Enhanced error handling for mobile memory management
    static handleCriticalError(error, context = 'Unknown') {
        console.error(`Critical error in ${context}:`, error);
        try {
            // Hide any displayed media elements that might be causing memory issues
            const mediaElements = document.querySelectorAll('img, video');
            mediaElements.forEach(media => {
                if (media.src && (media.src.includes('/gifs/') || media.src.includes('.mp4'))) {
                    if (media.tagName === 'VIDEO') {
                        media.pause();
                        media.removeAttribute('src');
                        media.load();
                    } else {
                        media.src = '';
                    }
                    media.style.display = 'none';
                }
            });
        } catch (e) {
            console.error('Error during critical error cleanup:', e);
        }
    }

    // Check AVIF support
    static checkAVIFSupport() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return canvas.toDataURL('image/avif').indexOf('data:image/avif') === 0;
        } catch (e) {
            return false;
        }
    }

    // Fetch with timeout wrapper
    static async fetchWithTimeout(url, options = {}, timeout = 15000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
}
