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
                <button class="button copy-link-btn" onclick="window.conversionManager.copyResultFile('${fullUrl}')" title="Copy File to Clipboard">
                    📋 Copy File
                </button>
                <a class="button" href="/8mb" onclick="return window.uiManager.handleConvertAnother()">🔄 Convert another</a>
            </div>

            <p class="meta center">${details}</p>
        `;

        this.uiManager.elements.resultBox.style.display = 'block';
    }

    // Feature 4: Copy result file to clipboard (with fallback to link)
    async copyResultFile(url) {
        try {
            Utils.showToast('Downloading to clipboard...', 'info', 2000);

            // Fetch the file as a blob
            const response = await fetch(url);
            if (!response.ok) throw new Error('Download failed');
            const blob = await response.blob();

            // Try to write to clipboard
            // Note: Clipboard API supports limited MIME types. 
            // We try to write the blob directly.
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);

            Utils.showToast('File copied to clipboard! You can now paste it.', 'success');
        } catch (error) {
            console.warn('Copy file failed, falling back to link:', error);

            // Fallback: Copy link
            const success = await Utils.copyToClipboard(url);
            if (success) {
                Utils.showToast('File copy not supported for this format. Link copied instead!', 'warning');
            } else {
                Utils.showToast('Failed to copy to clipboard', 'error');
            }
        }
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
