// Mobile-specific optimizations and preview handling
import { Utils } from './utils.js';

export class MobileManager {
    // Enhanced image error handling for mobile crashes
    static handleImageError(img) {
        console.warn('Image failed to load:', img.src);
        try {
            img.style.display = 'none';
            img.src = ''; // Clear src to free memory
            const wrapper = img.parentElement;
            if (wrapper) {
                wrapper.innerHTML = `
                    <div style="padding: 20px; text-align: center; background: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 8px;">
                        <p>⚠️</p>
                        <p>AV1 Preview unavailable</p>
                        <p style="font-size: 14px; color: #6c757d;">File ready for download below</p>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error handling image error:', e);
        }
    }

    // Enhanced image load handling for mobile memory management
    static handleImageLoad(img) {
        try {
            // Mobile optimization to prevent memory crashes
            if (Utils.isMobile) {
                // Aggressive size limiting for mobile devices
                const maxWidth = Math.min(300, window.innerWidth - 60);
                const maxHeight = Math.min(300, window.innerHeight * 0.4);
                
                Object.assign(img.style, {
                    maxWidth: `${maxWidth}px`,
                    maxHeight: `${maxHeight}px`,
                    width: '100%',
                    height: 'auto',
                    objectFit: 'contain',
                    borderRadius: '12px'
                });

                // For very large images on mobile, apply more aggressive optimization
                if (img.naturalWidth > 600 || img.naturalHeight > 600) {
                    img.loading = 'lazy';
                    console.log('Large image detected on mobile, applied aggressive optimization');
                }
            }
        } catch (e) {
            console.error('Error in handleImageLoad:', e);
            // Fallback: hide image if there's an error
            if (img) {
                this.handleImageError(img);
            }
        }
    }

    // Enhanced mobile preview with AVIF safety measures
    static showMobilePreview(gifUrl, fmtLabel, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Check if this is an AVIF file
        const isAVIF = fmtLabel.toLowerCase() === 'avif' || gifUrl.toLowerCase().includes('.avif');
        const isMP4 = fmtLabel.toLowerCase() === 'mp4' || gifUrl.toLowerCase().includes('.mp4');

        // Check AVIF browser support
        if (isAVIF && !Utils.checkAVIFSupport()) {
            container.innerHTML = `
                <div style="padding: 15px; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
                    <p>❌ AVIF not supported</p>
                    <p style="font-size: 12px;">Your browser doesn't support AVIF previews</p>
                    <p style="font-size: 12px; margin-top: 8px;">Your file is ready for download below</p>
                </div>
            `;
            return;
        }
        
        // Show loading state with AVIF/MP4 specific messages
        const loadingMessage = isMP4 ? 'Loading MP4 video...' : isAVIF ? 'Loading AVIF preview (experimental)...' : 'Loading preview...';
        const warningMessage = isAVIF ? '<p style="font-size: 11px; color: #856404; margin: 5px 0 0 0;">AVIF previews may not work on all mobile browsers</p>' : '';

        container.innerHTML = `
            <div class="loading-container">
                <div class="loader" style="width: 30px;"></div>
                <p class="loading-text">${loadingMessage}</p>
                ${warningMessage}
            </div>
        `;

        // For AVIF, use more aggressive size limits; MP4 uses standard limits
        const maxSize = isAVIF ? 200 : 300;
        const timeout = isAVIF ? 8000 : isMP4 ? 20000 : 15000; // Longer timeout for MP4 videos

        // Set a timeout for loading
        const loadTimeout = setTimeout(() => {
            container.innerHTML = `
                <div style="padding: 15px; text-align: center; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; color: #856404;">
                    <p>⏱️ Preview loading timed out</p>
                    <p style="font-size: 12px;">${isAVIF ? 'AVIF' : 'Media'} files can be slow to load on mobile</p>
                    <p style="font-size: 12px; margin-top: 8px;">Your file is ready for download below</p>
                </div>
            `;
        }, timeout);

        // Create image with enhanced safety measures
        const img = new Image();
        
        img.onload = function() {
            clearTimeout(loadTimeout);
            try {
                // Extra safety for AVIF files
                if (isAVIF && (this.naturalWidth > 1000 || this.naturalHeight > 1000)) {
                    console.warn('AVIF file too large for mobile preview');
                    container.innerHTML = `
                        <div style="padding: 15px; text-align: center; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; color: #856404;">
                            <p>⚠️ AVIF too large for mobile preview</p>
                            <p style="font-size: 12px;">File dimensions: ${this.naturalWidth}×${this.naturalHeight}</p>
                            <p style="font-size: 12px; margin-top: 8px;">Your file is ready for download below</p>
                        </div>
                    `;
                    return;
                }

                // Apply appropriate styling based on format
                const mediaStyle = `
                    max-width: ${maxSize}px;
                    max-height: ${maxSize}px;
                    width: 100%;
                    height: auto;
                    object-fit: contain;
                    border-radius: 12px;
                    border: 1px solid #d2d2d7;
                    ${isAVIF ? 'image-rendering: -webkit-optimize-contrast;' : ''}
                `;

                // Use video element for MP4, img element for others
                const mediaElement = isMP4 ?
                    `<video src="${gifUrl}" controls style="${mediaStyle} opacity: 0; transition: opacity 0.3s;" onloadeddata="this.style.opacity='1'"></video>` :
                    `<img src="${gifUrl}" alt="${fmtLabel}" style="${mediaStyle} opacity: 0; transition: opacity 0.3s;" onload="this.style.opacity='1'"/>`;

                const extraText = isAVIF ? '<p style="font-size: 10px; color: #6c757d; margin: 0; width: 100%; text-align: center;">AVIF preview may use more memory</p>' :
                    isMP4 ? '<p style="font-size: 10px; color: #6c757d; margin: 0; width: 100%; text-align: center;">MP4 video preview</p>' : '';

                container.innerHTML = `
                    ${mediaElement}
                    <div style="margin-top: 10px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
                        <button onclick="window.mobileManager.hideMobilePreview('${containerId}', '${gifUrl}', '${fmtLabel}')" style="padding: 8px 12px; background: #dc3545; border: none; border-radius: 6px; color: white; font-size: 11px; cursor: pointer;">
                            🗑️ Hide & Free Memory
                        </button>
                        ${extraText}
                    </div>
                `;

                // Force a small delay to ensure the media is rendered properly
                setTimeout(() => {
                    const mediaElement = container.querySelector('img, video');
                    if (mediaElement) {
                        mediaElement.style.opacity = '1';
                    }
                }, 100);

            } catch (e) {
                clearTimeout(loadTimeout);
                console.error('Error displaying mobile preview:', e);
                container.innerHTML = `
                    <div style="padding: 15px; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
                        <p>💥 Preview crashed</p>
                        <p style="font-size: 12px;">This can happen with large ${fmtLabel} files on mobile</p>
                        <p style="font-size: 12px; margin-top: 8px;">Your file is ready for download below</p>
                    </div>
                `;
            }
        };
        
        img.onerror = function() {
            clearTimeout(loadTimeout);
            const errorReason = isAVIF ? 'AVIF not supported by your browser' : isMP4 ? 'MP4 video preview failed' : 'Preview unavailable';
            container.innerHTML = `
                <div style="padding: 15px; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
                    <p>❌ ${errorReason}</p>
                    <p style="font-size: 12px;">Your file is ready for download below</p>
                </div>
            `;
        };

        // Add crossOrigin to handle potential CORS issues
        img.crossOrigin = 'anonymous';
        
        // Set source to trigger load with error handling
        try {
            img.src = gifUrl;
        } catch (e) {
            clearTimeout(loadTimeout);
            console.error('Error setting media source:', e);
            const errorTitle = isMP4 ? 'Failed to load video preview' : 'Failed to load preview';
            container.innerHTML = `
                <div style="padding: 15px; text-align: center; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; color: #721c24;">
                    <p>💥 ${errorTitle}</p>
                    <p style="font-size: 12px;">Your file is ready for download below</p>
                </div>
            `;
        }
    }

    // Hide mobile preview to free memory
    static hideMobilePreview(containerId, gifUrl, fmtLabel) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Clear any media elements in the container first
        const mediaElements = container.querySelectorAll('img, video');
        mediaElements.forEach(media => {
            if (media.tagName === 'VIDEO') {
                media.pause();
                media.removeAttribute('src');
                media.load(); // Reset video element
            } else {
                media.src = '';
            }
        });

        const isAVIF = fmtLabel.toLowerCase() === 'avif';
        container.innerHTML = `
            <div style="padding: 15px; text-align: center; background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px;">
                <p>✅ Preview hidden to save memory</p>
                <button onclick="window.mobileManager.showMobilePreview('${gifUrl}', '${fmtLabel}', '${containerId}')" style="margin-top: 8px; padding: 8px 16px; background: #007bff; border: none; border-radius: 8px; color: white; font-size: 12px; cursor: pointer;">
                    Show Preview
                </button>
                ${isAVIF ? `<button onclick="window.mobileManager.emergencyCleanup()" style="margin-top: 8px; margin-left: 8px; padding: 8px 12px; background: #dc3545; border: none; border-radius: 8px; color: white; font-size: 11px; cursor: pointer;">🆘 Emergency Cleanup</button>` : ''}
            </div>
        `;
    }

    // Set up mobile error handlers
    static setupMobileErrorHandlers() {
        if (!Utils.isMobile) return;

        // Global error handler for mobile crashes
        window.addEventListener('error', (event) => {
            console.error('Global error caught:', event.error);
            // Don't let errors crash the page on mobile
            event.preventDefault();
        });

        // Handle unhandled promise rejections on mobile
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection caught:', event.reason);
            event.preventDefault();
            // If it's related to image loading, trigger emergency cleanup
            if (event.reason && event.reason.toString().includes('image')) {
                setTimeout(() => {
                    Utils.emergencyCleanup();
                }, 100);
            }
        });
    }

    // Initialize mobile manager
    static init() {
        this.setupMobileErrorHandlers();
        
        // Export methods to global scope for onclick handlers
        window.mobileManager = {
            showMobilePreview: this.showMobilePreview.bind(this),
            hideMobilePreview: this.hideMobilePreview.bind(this),
            emergencyCleanup: Utils.emergencyCleanup
        };
    }
}
