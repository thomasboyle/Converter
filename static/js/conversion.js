// Conversion job management and polling
import { Utils } from './utils.js';
import { StorageManager } from './storage.js';

export class ConversionManager {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    // Reusable polling function for job status with enhanced mobile optimizations
    async pollJobStatus(jobId, format, isResume = false) {
        const baseInterval = Utils.isMobile ? 5000 : 1500; // Increased mobile interval to reduce load
        let pollInterval = baseInterval;
        let consecutiveErrors = 0;
        const maxErrors = Utils.isMobile ? 3 : 5; // Fewer retries on mobile
        let currentStatus = null;

        const poll = async () => {
            if (!this.uiManager.pageVisible) {
                setTimeout(poll, pollInterval);
                return;
            }

            try {
                const response = await Utils.fetchWithTimeout(`/progress/${jobId}`, {
                    headers: { 'Cache-Control': 'no-cache' }
                }, Utils.isMobile ? 20000 : 15000);

                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                const data = await response.json();

                // Reset error count on successful response
                consecutiveErrors = 0;
                pollInterval = baseInterval;

                // Only update DOM if status changed
                if (currentStatus !== data.status || data.status === 'running') {
                    this.updateProgressDisplay(data, currentStatus);
                }

                currentStatus = data.status;

                if (data.status === 'done') {
                    this.handleJobComplete(data, format);
                    return;
                } else if (data.status === 'error' || data.status === 'cancelled') {
                    this.handleJobError(data);
                    return;
                }
            } catch (e) {
                consecutiveErrors++;
                console.warn(`Job polling error (${consecutiveErrors}/${maxErrors}):`, e.message);

                // Exponential backoff on errors
                pollInterval = Math.min(pollInterval * 1.5, 30000); // Cap at 30 seconds

                if (consecutiveErrors >= maxErrors) {
                    this.handleConnectionLost();
                    return;
                }

                // Show user-friendly error messages for first few errors
                this.showRetryMessage(consecutiveErrors, currentStatus);
            }
            setTimeout(poll, pollInterval);
        };
        poll();
    }

    // Update progress display based on job status
    updateProgressDisplay(data, currentStatus) {
        if (data.status === 'queued' && currentStatus !== 'queued') {
            this.uiManager.elements.progressBox.innerHTML = Utils.createLoadingContainer('Queued...');
        } else if (data.status === 'running') {
            const text = data.message || 'Processing...';
            const existingText = this.uiManager.elements.progressBox.querySelector('.loading-text');

            if (currentStatus !== 'running' || !existingText) {
                this.uiManager.elements.progressBox.innerHTML = Utils.createLoadingContainer(text);
            } else if (existingText.textContent !== text) {
                existingText.textContent = text;
            }
        }
    }

    // Handle job completion
    handleJobComplete(data, format) {
        StorageManager.clearActiveJob();
        this.uiManager.elements.progressBox.innerHTML = Utils.createSuccessMessage('Done!');

        const fmt = (data.format || format).toLowerCase();
        const fmtLabel = Utils.getFormatLabel(fmt);
        const details = data.params ? ` (fps ${data.params.fps}, ${data.params.width}×${data.params.height}, ${data.params.output_size_mb} MB)` : '';

        this.displayResult(data.gif_url, fmtLabel, details, data.params, fmt);

        // Clean up UI state
        this.resetUIAfterCompletion();
        StorageManager.saveCompletedResult(data.gif_url, data.params, fmt);

        // Feature 8: Save to history
        StorageManager.saveToHistory(data.gif_url, fmt, data.params);

        // Feature 5: Auto-download if enabled
        if (StorageManager.getAutoDownload()) {
            this.triggerAutoDownload(data.gif_url, fmtLabel);
        }

        // Refresh history display
        if (window.uiManager && window.uiManager.loadAndDisplayHistory) {
            window.uiManager.loadAndDisplayHistory();
        }
    }

    // Feature 5: Trigger automatic download
    triggerAutoDownload(url, formatLabel) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `converted_video.${Utils.getExtensionForFormat(formatLabel.toLowerCase()).replace('.', '')}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Utils.showToast('Download started automatically', 'success', 2000);
    }

    // Handle job error or cancellation
    handleJobError(data) {
        StorageManager.clearActiveJob();
        const isCancelled = data.status === 'cancelled';
        this.uiManager.elements.progressBox.innerHTML = Utils.createErrorMessage(
            isCancelled ? `Cancelled: ${data.message || 'Conversion cancelled by user'}` : `Error: ${data.message || 'Unknown error'}`
        );
        this.resetUIAfterError();
    }

    // Handle connection lost
    handleConnectionLost() {
        StorageManager.clearActiveJob();
        this.uiManager.elements.progressBox.innerHTML = Utils.createErrorMessage('Connection lost. Please refresh the page.');
        this.resetUIAfterError();
    }

    // Show retry message during connection issues
    showRetryMessage(consecutiveErrors, currentStatus) {
        const errorMessages = {
            1: 'Connection issue... retrying...',
            3: 'Having trouble connecting... still trying...'
        };

        if (errorMessages[consecutiveErrors] && currentStatus !== `error-${consecutiveErrors}`) {
            this.uiManager.elements.progressBox.innerHTML = Utils.createLoadingContainer(errorMessages[consecutiveErrors]);
        }
    }

    // Reset UI state after successful completion
    resetUIAfterCompletion() {
        this.uiManager.elements.submitBtn.disabled = false;
        this.uiManager.setResetButtonProcessing(false);
        this.uiManager.setFormatSelectionDisabled(false);
        this.uiManager.setUploadAreaDisabled(false);
        this.uiManager.elements.form.style.display = 'none';

        // Hide sections when result appears
        document.getElementById('uploadArea').style.display = 'none';
        document.querySelector('.smart-settings').style.display = 'none';
        document.querySelector('.output-section').style.display = 'none';
    }

    // Reset UI state after error or cancellation
    resetUIAfterError() {
        this.uiManager.elements.submitBtn.disabled = false;
        this.uiManager.setResetButtonProcessing(false);
        this.uiManager.setFormatSelectionDisabled(false);
        this.uiManager.setUploadAreaDisabled(false);
    }

    // Display conversion result with mobile-optimized preview
    displayResult(gifUrl, fmtLabel, details, params, format) {
        const previewContainerId = `preview-container-${Date.now()}`;
        const isAVIF = fmtLabel.toLowerCase() === 'avif';
        const isMP4 = fmtLabel.toLowerCase() === 'mp4';
        const isAV1 = fmtLabel.toLowerCase() === 'av1';
        const isVideo = isMP4 || isAV1;
        const fullUrl = window.location.origin + gifUrl;

        const imageHtml = this.createPreviewHtml(gifUrl, fmtLabel, previewContainerId, isAVIF, isVideo);

        this.uiManager.elements.resultBox.innerHTML = `
            ${imageHtml}
            <div class="result-actions">
                <a class="button download-btn" href="${gifUrl}" download>⬇️ Download ${fmtLabel}</a>
                <button class="button copy-link-btn" onclick="window.conversionManager.copyResultLink('${fullUrl}')">📋 Copy Link</button>
                <a class="button" href="/8mb" onclick="return window.uiManager.handleConvertAnother()">🔄 Convert another</a>
            </div>
            <div class="share-buttons">
                <button class="share-btn share-discord" onclick="window.conversionManager.shareToDiscord('${fullUrl}')" title="Share to Discord">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
                    Discord
                </button>
                <button class="share-btn share-copy" onclick="window.conversionManager.copyResultLink('${fullUrl}')" title="Copy to Clipboard">
                    📋 Copy URL
                </button>
            </div>
            <p class="meta center">${details}</p>
        `;

        this.uiManager.elements.resultBox.style.display = 'block';
    }

    // Feature 4: Copy result link to clipboard
    async copyResultLink(url) {
        const success = await Utils.copyToClipboard(url);
        Utils.showToast(success ? 'Link copied to clipboard!' : 'Failed to copy link', success ? 'success' : 'error');
    }

    // Feature 13: Share to Discord (opens Discord with message)
    shareToDiscord(url) {
        // Try Discord protocol, fall back to copy
        const discordWebUrl = `https://discord.com/channels/@me`;
        Utils.copyToClipboard(url);
        Utils.showToast('Link copied! Paste in Discord to share.', 'success', 3000);
        window.open(discordWebUrl, '_blank');
    }

    // Create preview HTML for mobile or desktop
    createPreviewHtml(gifUrl, fmtLabel, previewContainerId, isAVIF, isVideo) {
        if (Utils.isMobile && window.innerWidth < 768) {
            return this.createMobilePreviewHtml(gifUrl, fmtLabel, previewContainerId, isAVIF, isVideo);
        } else {
            return this.createDesktopPreviewHtml(gifUrl, fmtLabel, isVideo);
        }
    }

    // Create mobile-optimized preview HTML
    createMobilePreviewHtml(gifUrl, fmtLabel, previewContainerId, isAVIF, isVideo) {
        const warningText = isAVIF ?
            '⚠️ AVIF preview may cause crashes on some mobile devices' :
            isVideo ? '🎬 Video preview with controls' : 'Tap to safely preview on mobile';

        const buttonStyle = isAVIF ?
            'margin-top: 8px; padding: 10px 20px; background: #fd7e14; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; font-weight: 500;' :
            'margin-top: 8px; padding: 10px 20px; background: #28a745; border: none; border-radius: 8px; color: white; font-size: 14px; cursor: pointer; font-weight: 500;';

        return `
            <div class="gif-wrapper">
                <div id="${previewContainerId}" style="padding: 20px; text-align: center; background: #d4edda; border: 2px solid #c3e6cb; border-radius: 8px;">
                    <p>✅ Conversion Complete!</p>
                    <p style="font-size: 14px; color: #155724; margin: 8px 0;">Your ${fmtLabel} is ready!</p>
                    <button onclick="window.mobileManager.showMobilePreview('${gifUrl}', '${fmtLabel}', '${previewContainerId}')" style="${buttonStyle}">
                        ${isAVIF ? '⚠️ Try AVIF Preview' : isVideo ? '🎬 Show Video' : '📱 Show Preview'}
                    </button>
                    <p style="font-size: 12px; color: ${isAVIF ? '#856404' : '#6c757d'}; margin-top: 8px;">${warningText}</p>
                </div>
            </div>
        `;
    }

    // Create desktop preview HTML
    createDesktopPreviewHtml(gifUrl, fmtLabel, isVideo) {
        if (isVideo) {
            return `<div class="gif-wrapper"><video src="${gifUrl}" alt="${fmtLabel}" controls onerror="window.mobileManager.handleImageError(this)" onload="window.mobileManager.handleImageLoad(this)" loading="lazy" style="max-width: 100%; height: auto;"/></div>`;
        } else {
            return `<div class="gif-wrapper"><img src="${gifUrl}" alt="${fmtLabel}" onerror="window.mobileManager.handleImageError(this)" onload="window.mobileManager.handleImageLoad(this)" loading="lazy"/></div>`;
        }
    }

    // Display completed result from storage
    displayCompletedResult(result) {
        this.uiManager.elements.progressBox.style.display = 'none';
        const fmtLabel = Utils.getFormatLabel(result.format);
        const details = result.params ? ` (fps ${result.params.fps}, ${result.params.width}×${result.params.height}, ${result.params.output_size_mb} MB)` : '';

        this.displayResult(result.gifUrl, fmtLabel, details, result.params, result.format);
        this.uiManager.elements.form.style.display = 'none';

        // Hide sections when result appears
        document.getElementById('uploadArea').style.display = 'none';
        document.querySelector('.smart-settings').style.display = 'none';
        document.querySelector('.output-section').style.display = 'none';
    }

    // Check for completed result or active job on page load
    async checkAndResumeJob() {
        // First, check if there's a completed result to display
        const completedResult = StorageManager.getCompletedResult();
        if (completedResult) {
            this.displayCompletedResult(completedResult);
            return;
        }

        // If no completed result, check for active job to resume
        const activeJob = StorageManager.getActiveJob();
        if (!activeJob) return;

        try {
            const response = await Utils.fetchWithTimeout(`/progress/${activeJob.jobId}`, {
                headers: { 'Cache-Control': 'no-cache' }
            }, 10000);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const jobData = await response.json();

            // Only resume if job is not done, error, or cancelled
            if (jobData.status && !['done', 'error', 'cancelled'].includes(jobData.status)) {
                this.uiManager.elements.progressBox.style.display = 'block';
                this.uiManager.elements.resultBox.style.display = 'none';
                this.uiManager.elements.submitBtn.disabled = true;
                this.uiManager.elements.progressBox.innerHTML = Utils.createLoadingContainer('🔄 Resumed tracking your conversion...');

                // Disable format selection during resumed conversion
                this.uiManager.setFormatSelectionDisabled(true);

                // Start polling from where we left off
                this.pollJobStatus(activeJob.jobId, activeJob.format, true);
                this.uiManager.setResetButtonProcessing(true);
            } else {
                // Job is done or errored, clear it
                StorageManager.clearActiveJob();
            }
        } catch (error) {
            console.warn('Failed to resume job:', error.message);
            StorageManager.clearActiveJob();

            if (!error.name?.includes('AbortError')) {
                console.error('Job resumption failed:', error);
            }
        }
    }

    // Initialize conversion manager
    init() {
        // Export to global scope for UI integration
        window.conversionManager = this;

        // Check for jobs after a delay for mobile optimization
        const delay = Utils.isMobile ? 1000 : 100;
        setTimeout(() => {
            try {
                this.checkAndResumeJob();
            } catch (error) {
                Utils.handleCriticalError(error, 'DOMContentLoaded job resumption');
            }
        }, delay);
    }
}
