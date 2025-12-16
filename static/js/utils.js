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

    // Feature 3: Estimate conversion time based on file size
    static estimateConversionTime(fileSizeMB, format) {
        // Base rates in seconds per MB (approximate)
        const rates = {
            'av1': 8,      // AV1 is slowest
            'avif': 6,     // AVIF is moderately slow
            'mp4': 3,      // MP4 is faster
            'webp': 4,     // WebP is moderate
            'gif': 5       // GIF depends on palette
        };

        const rate = rates[format] || 5;
        const estimatedSeconds = Math.ceil(fileSizeMB * rate);

        if (estimatedSeconds < 60) {
            return `~${estimatedSeconds} sec`;
        } else {
            const minutes = Math.ceil(estimatedSeconds / 60);
            return `~${minutes} min`;
        }
    }

    // Feature 4: Copy text to clipboard with fallback
    static async copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return true;
        } catch (e) {
            console.error('Copy to clipboard failed:', e);
            return false;
        }
    }

    // Feature 4/13: Show toast notification
    static showToast(message, type = 'success', duration = 3000) {
        // Remove existing toast if any
        const existing = document.getElementById('toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.className = `toast-notification toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
            <span class="toast-message">${message}</span>
        `;
        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('toast-visible');
        });

        // Auto-remove
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // Feature 11: Check if format supports audio
    static formatSupportsAudio(format) {
        const audioFormats = ['mp4', 'av1'];
        return audioFormats.includes(format?.toLowerCase());
    }

    // Feature 6: Format file size for display
    static formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Feature 6: Format duration for display
    static formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Feature 2: Create upload progress bar HTML
    static createUploadProgressBar(percent) {
        return `
            <div class="upload-progress-container">
                <div class="upload-progress-bar">
                    <div class="upload-progress-fill" style="width: ${percent}%"></div>
                </div>
                <p class="upload-progress-text">Uploading... ${Math.round(percent)}%</p>
            </div>
        `;
    }

    // Feature 9: Validate file is a video
    static isValidVideoFile(file) {
        if (!file) return { valid: false, error: 'No file selected' };

        const validTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
        const isValidType = file.type.startsWith('video/') || validTypes.includes(file.type);

        if (!isValidType) {
            const ext = file.name.split('.').pop()?.toLowerCase();
            return {
                valid: false,
                error: `"${file.name}" is not a video file. Please upload a video (MP4, WebM, MOV, etc.)`
            };
        }

        return { valid: true };
    }
}

