// UI management and DOM manipulation
import { Utils } from './utils.js';
import { StorageManager } from './storage.js';

export class UIManager {
    constructor() {
        this.elements = {
            form: document.getElementById('uploadForm'),
            progressBox: document.getElementById('progress'),
            resultBox: document.getElementById('result'),
            submitBtn: document.getElementById('submitBtn'),
            resetBtn: document.getElementById('resetBtn'),
            uploadArea: document.getElementById('uploadArea'),
            fileInput: document.getElementById('video'),
            formatSelect: document.getElementById('format'),
            filenameInput: document.getElementById('filename'),
            fileExtension: document.getElementById('fileExtension'),
            avifBanner: document.getElementById('avif-discord-banner'),
            queueCounter: document.getElementById('queue-counter'),
            queueCount: document.getElementById('queue-count'),
            // New elements for QOL features
            videoPreview: document.getElementById('video-preview-container'),
            audioWarning: document.getElementById('audio-warning'),
            autoDownloadToggle: document.getElementById('auto-download-toggle'),
            historySection: document.getElementById('history-section'),
            historyList: document.getElementById('history-list')
        };

        this.currentUploadController = null;
        this.currentUploadXHR = null;
        this.pageVisible = true;
        this.queueCounterInterval = null;
        this.queueRetryCount = 0;
        this.selectedFile = null;
    }

    // Initialize UI event handlers
    init() {
        this.setupFormatHandling();
        this.setupUploadArea();
        this.setupFormHandling();
        this.setupResetButton();
        this.setupVisibilityHandling();
        this.startQueuePolling();
        this.setupKeyboardShortcuts();
        this.setupAutoDownloadToggle();
        this.loadAndDisplayHistory();
    }

    // Format selection and banner management
    setupFormatHandling() {
        // Update filename extension and show/hide AVIF warning banner when format changes
        this.elements.formatSelect?.addEventListener('change', () => {
            const format = this.elements.formatSelect.value;
            const extension = Utils.getExtensionForFormat(format);
            this.elements.fileExtension.textContent = extension;
            this.updateAVIFBanner(format);
            this.updateAudioWarning(format); // Feature 11
        });

        // Initialize banner state and file extension on page load
        const selectedFormat = this.elements.formatSelect?.value || 'av1';
        const extension = Utils.getExtensionForFormat(selectedFormat);
        if (this.elements.fileExtension) {
            this.elements.fileExtension.textContent = extension;
        }
        this.updateAVIFBanner(selectedFormat);
        this.updateAudioWarning(selectedFormat); // Feature 11
    }

    // Feature 11: Update audio warning based on format
    updateAudioWarning(format) {
        if (this.elements.audioWarning) {
            const supportsAudio = Utils.formatSupportsAudio(format);
            this.elements.audioWarning.style.display = supportsAudio ? 'none' : 'flex';
        }
    }

    // Function to update banner visibility based on format
    updateAVIFBanner(format) {
        if (this.elements.avifBanner) {
            this.elements.avifBanner.style.display = format === 'avif' ? 'flex' : 'none';
        }
    }

    // Upload area drag and drop functionality
    setupUploadArea() {
        if (!this.elements.uploadArea || !this.elements.fileInput) return;

        // Upload area click handler
        this.elements.uploadArea.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        // File input change handler
        this.elements.fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                this.updateUploadAreaWithFile(file);
            }
        });

        // Drag and drop events
        this.elements.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            // Only add dragover class if upload area is not disabled
            if (this.elements.uploadArea.style.pointerEvents !== 'none') {
                this.elements.uploadArea.classList.add('dragover');
            }
        });

        this.elements.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.elements.uploadArea.classList.remove('dragover');
        });

        this.elements.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.uploadArea.classList.remove('dragover');

            // Only process drop if upload area is not disabled
            if (this.elements.uploadArea.style.pointerEvents !== 'none') {
                const files = e.dataTransfer.files;

                // Feature 14: Batch processing hint
                if (files.length > 1) {
                    Utils.showToast('Only single file upload is supported. Using first file.', 'info');
                }

                if (files.length > 0) {
                    const file = files[0];
                    // Feature 9: File validation
                    const validation = Utils.isValidVideoFile(file);
                    if (!validation.valid) {
                        Utils.showToast(validation.error, 'error', 4000);
                        return;
                    }

                    this.elements.fileInput.files = files;
                    this.updateUploadAreaWithFile(file);
                }
            }
        });
    }

    // Update upload area display with file info
    updateUploadAreaWithFile(file) {
        if (!this.elements.uploadArea) return;

        this.selectedFile = file;
        this.elements.uploadArea.querySelector('.upload-text').textContent = file.name;
        this.elements.uploadArea.querySelector('.upload-subtext').textContent = Utils.formatFileSize(file.size);
        this.elements.uploadArea.style.borderColor = '#34c759';
        this.elements.uploadArea.style.backgroundColor = '#f0fff4';

        // Feature 6: Generate and show video preview
        this.showVideoPreview(file);
    }

    // Feature 6: Show video preview with thumbnail and duration
    showVideoPreview(file) {
        const previewContainer = this.elements.videoPreview;
        if (!previewContainer) return;

        // Create object URL for preview
        const videoUrl = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;

        video.onloadedmetadata = () => {
            const duration = Utils.formatDuration(video.duration);
            const format = this.elements.formatSelect?.value || 'av1';
            const estimatedTime = Utils.estimateConversionTime(file.size / (1024 * 1024), format);

            previewContainer.innerHTML = `
                <div class="video-preview-card">
                    <video src="${videoUrl}" class="preview-thumbnail" muted playsinline></video>
                    <div class="preview-info">
                        <span class="preview-duration">📹 ${duration}</span>
                        <span class="preview-estimate">⏱️ Est: ${estimatedTime}</span>
                    </div>
                </div>
            `;
            previewContainer.style.display = 'block';

            // Try to show first frame
            const previewVideo = previewContainer.querySelector('video');
            if (previewVideo) {
                previewVideo.currentTime = 0.1;
            }
        };

        video.onerror = () => {
            URL.revokeObjectURL(videoUrl);
            previewContainer.style.display = 'none';
        };

        video.src = videoUrl;
    }

    // Form submission handling
    setupFormHandling() {
        if (!this.elements.form) return;

        this.elements.form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.elements.fileInput.files.length) return;

            this.startConversion();
        });
    }

    // Start conversion process - Feature 2: With upload progress bar
    async startConversion() {
        // Clear any existing completed result when starting new conversion
        StorageManager.clearCompletedResult();

        // Set processing state
        this.setResetButtonProcessing(true);

        this.elements.progressBox.style.display = 'block';
        this.elements.resultBox.style.display = 'none';
        this.elements.progressBox.innerHTML = Utils.createUploadProgressBar(0);
        this.elements.submitBtn.disabled = true;

        // Disable format selection and upload area during conversion
        this.setFormatSelectionDisabled(true);
        this.setUploadAreaDisabled(true);

        const data = new FormData();
        data.append('video', this.elements.fileInput.files[0]);
        if (this.elements.formatSelect) data.append('format', this.elements.formatSelect.value);
        if (this.elements.filenameInput) data.append('filename', this.elements.filenameInput.value);

        // Use XHR for upload progress tracking
        const xhr = new XMLHttpRequest();
        this.currentUploadXHR = xhr;

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                this.elements.progressBox.innerHTML = Utils.createUploadProgressBar(percent);
            }
        };

        xhr.onload = () => {
            this.currentUploadXHR = null;

            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const json = JSON.parse(xhr.responseText);
                    const jobId = json.job_id;

                    StorageManager.saveActiveJob(jobId, this.elements.formatSelect?.value || 'avif');
                    this.elements.progressBox.innerHTML = Utils.createLoadingContainer('Processing... Please wait');

                    // Trigger conversion polling
                    if (window.conversionManager) {
                        window.conversionManager.pollJobStatus(jobId, this.elements.formatSelect?.value || 'avif');
                    }
                } catch (e) {
                    this.handleUploadError('Invalid server response');
                }
            } else {
                let errorMessage = `HTTP ${xhr.status}`;
                try {
                    const err = JSON.parse(xhr.responseText);
                    errorMessage = err.error || errorMessage;
                } catch (e) { }
                this.handleUploadError(errorMessage);
            }
        };

        xhr.onerror = () => {
            this.currentUploadXHR = null;
            this.handleUploadError('Network error. Please check your connection.');
        };

        xhr.onabort = () => {
            this.currentUploadXHR = null;
            this.elements.progressBox.innerHTML = Utils.createErrorMessage('Upload cancelled');
            this.resetUploadState();
        };

        xhr.open('POST', '/start');
        xhr.send(data);
    }

    // Handle upload errors
    handleUploadError(message) {
        this.elements.progressBox.innerHTML = Utils.createErrorMessage(message);
        this.resetUploadState();
    }

    // Reset upload state after error
    resetUploadState() {
        this.elements.submitBtn.disabled = false;
        this.setResetButtonProcessing(false);
        this.setFormatSelectionDisabled(false);
        this.setUploadAreaDisabled(false);
    }

    // Reset button handling
    setupResetButton() {
        if (!this.elements.resetBtn) return;

        this.elements.resetBtn.addEventListener('click', async () => {
            await this.resetForm();
        });
    }

    // Reset form and cancel operations
    async resetForm() {
        // Cancel any ongoing upload/fetch requests
        if (this.currentUploadController) {
            this.currentUploadController.abort();
            this.currentUploadController = null;
        }

        // Cancel any active job on the server
        const activeJob = StorageManager.getActiveJob();
        if (activeJob) {
            try {
                const response = await Utils.fetchWithTimeout(`/cancel/${activeJob.jobId}`, { method: 'POST' }, 5000);
            } catch (error) {
                console.warn('Failed to cancel job on server:', error);
            }
        }

        // Clear file input
        this.elements.fileInput.value = '';

        // Reset upload area UI
        this.resetUploadArea();

        // Reset form inputs
        this.resetFormInputs();

        // Clear any displayed results and progress
        this.hideResults();

        // Show hidden sections
        this.showAllSections();

        // Clear local storage data
        StorageManager.clearCompletedResult();
        StorageManager.clearActiveJob();

        // Re-enable controls
        this.elements.submitBtn.disabled = false;
        this.setFormatSelectionDisabled(false);
        this.setUploadAreaDisabled(false);

        console.log('Reset completed - file cleared, upload cancelled, UI reset');
    }

    // Reset upload area to default state
    resetUploadArea() {
        if (!this.elements.uploadArea) return;

        this.elements.uploadArea.querySelector('.upload-text').textContent = 'Drag & drop your video';
        this.elements.uploadArea.querySelector('.upload-subtext').textContent = 'or click to browse files';
        this.elements.uploadArea.style.borderColor = '#d2d2d7';
        this.elements.uploadArea.style.backgroundColor = '#fafafa';
    }

    // Reset form inputs to defaults
    resetFormInputs() {
        const selectedFormat = this.elements.formatSelect?.value || 'av1';
        const defaultExtension = Utils.getExtensionForFormat(selectedFormat);

        if (this.elements.filenameInput) {
            this.elements.filenameInput.value = 'output';
        }
        if (this.elements.fileExtension) {
            this.elements.fileExtension.textContent = defaultExtension;
        }
        if (this.elements.formatSelect) {
            this.elements.formatSelect.value = selectedFormat;
        }

        // Reset any toggles to checked
        document.querySelectorAll('.toggle input[type="checkbox"]').forEach(toggle => {
            toggle.checked = true;
        });
    }

    // Hide results and progress
    hideResults() {
        this.elements.resultBox.style.display = 'none';
        this.elements.progressBox.style.display = 'none';
        this.elements.form.style.display = 'block';
    }

    // Show all sections that might be hidden
    showAllSections() {
        document.getElementById('uploadArea').style.display = 'block';
        document.querySelector('.smart-settings').style.display = 'block';
        document.querySelector('.output-section').style.display = 'block';
    }

    // Function to disable/enable format selection
    setFormatSelectionDisabled(disabled) {
        if (this.elements.formatSelect) {
            this.elements.formatSelect.disabled = disabled;
            this.elements.formatSelect.style.opacity = disabled ? '0.5' : '1';
            this.elements.formatSelect.style.cursor = disabled ? 'not-allowed' : 'pointer';
        }
    }

    // Function to disable/enable upload area
    setUploadAreaDisabled(disabled) {
        if (this.elements.uploadArea) {
            if (disabled) {
                this.elements.uploadArea.style.pointerEvents = 'none';
                this.elements.uploadArea.style.opacity = '0.5';
                this.elements.uploadArea.style.cursor = 'not-allowed';
                this.elements.uploadArea.title = 'Upload disabled during conversion';
            } else {
                this.elements.uploadArea.style.pointerEvents = 'auto';
                this.elements.uploadArea.style.opacity = '1';
                this.elements.uploadArea.style.cursor = 'pointer';
                this.elements.uploadArea.title = '';
            }
        }
    }

    // Function to toggle reset button processing state
    setResetButtonProcessing(isProcessing) {
        if (!this.elements.resetBtn) return;

        if (isProcessing) {
            this.elements.resetBtn.classList.add('processing');
            this.elements.resetBtn.textContent = 'Cancel';
        } else {
            this.elements.resetBtn.classList.remove('processing');
            this.elements.resetBtn.textContent = 'Reset';
        }
    }

    // Page visibility handling
    setupVisibilityHandling() {
        document.addEventListener('visibilitychange', () => {
            this.pageVisible = !document.hidden;
            if (this.pageVisible) {
                this.updateQueueCounter();
            } else if (this.queueCounterInterval) {
                clearInterval(this.queueCounterInterval);
                this.queueCounterInterval = null;
            }
        });
    }

    // Queue counter functionality
    async updateQueueCounter() {
        if (!this.pageVisible || !this.elements.queueCount) return;

        try {
            const response = await Utils.fetchWithTimeout('/queue', {
                headers: { 'Cache-Control': 'no-cache' }
            }, 10000);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const queued = data.queued || 0;
            this.elements.queueCount.textContent = queued;
            this.elements.queueCounter.classList.toggle('high-queue', queued > 2);
            this.queueRetryCount = 0;
        } catch (error) {
            console.error('Failed to fetch queue status:', error);
            if (++this.queueRetryCount > 5) {
                console.warn('Queue counter failed multiple times, stopping updates');
                if (this.queueCounterInterval) {
                    clearInterval(this.queueCounterInterval);
                    this.queueCounterInterval = null;
                }
            }
        }
    }

    // Start queue polling with mobile optimization
    startQueuePolling() {
        if (this.queueCounterInterval) clearInterval(this.queueCounterInterval);
        this.updateQueueCounter();

        const queuePollInterval = Utils.isMobile ? 20000 : 5000;
        this.queueCounterInterval = setInterval(() => this.updateQueueCounter(), queuePollInterval);
    }

    // Handle convert another action
    handleConvertAnother() {
        StorageManager.clearCompletedResult();
        window.location.href = '/8mb';
        return false;
    }

    // Feature 10: Keyboard shortcuts
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ignore if user is typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                // Allow Escape in inputs
                if (e.key !== 'Escape') return;
            }

            switch (e.key) {
                case 'Enter':
                    // Submit form if file is selected and button is enabled
                    if (this.elements.fileInput?.files.length > 0 &&
                        !this.elements.submitBtn?.disabled) {
                        e.preventDefault();
                        this.elements.form?.requestSubmit?.() || this.elements.submitBtn?.click();
                    }
                    break;
                case 'Escape':
                    // Reset/Cancel
                    e.preventDefault();
                    this.resetForm();
                    break;
            }
        });
    }

    // Feature 5: Setup auto-download toggle
    setupAutoDownloadToggle() {
        const toggle = this.elements.autoDownloadToggle;
        if (!toggle) return;

        // Load saved preference
        toggle.checked = StorageManager.getAutoDownload();

        toggle.addEventListener('change', () => {
            StorageManager.setAutoDownload(toggle.checked);
            Utils.showToast(toggle.checked ? 'Auto-download enabled' : 'Auto-download disabled', 'info', 2000);
        });
    }

    // Feature 8: Load and display conversion history
    loadAndDisplayHistory() {
        const historySection = this.elements.historySection;
        const historyList = this.elements.historyList;
        if (!historySection || !historyList) return;

        const history = StorageManager.getHistory();

        if (history.length === 0) {
            historySection.style.display = 'none';
            return;
        }

        historySection.style.display = 'block';
        historyList.innerHTML = history.map((item, index) => `
            <div class="history-item" data-index="${index}">
                <div class="history-item-info">
                    <span class="history-format">${Utils.getFormatLabel(item.format)}</span>
                    <span class="history-date">${item.date}</span>
                    ${item.params ? `<span class="history-size">${item.params.output_size_mb} MB</span>` : ''}
                </div>
                <div class="history-item-actions">
                    <a href="${item.url}" download class="history-download-btn" title="Download">⬇️</a>
                    <button class="history-copy-btn" data-url="${item.url}" title="Copy Link">📋</button>
                </div>
            </div>
        `).join('');

        // Add click handlers for copy buttons
        historyList.querySelectorAll('.history-copy-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const url = e.target.dataset.url;
                const fullUrl = window.location.origin + url;
                const success = await Utils.copyToClipboard(fullUrl);
                Utils.showToast(success ? 'Link copied!' : 'Failed to copy', success ? 'success' : 'error');
            });
        });
    }

    // Clear conversion history
    clearHistory() {
        StorageManager.clearHistory();
        if (this.elements.historySection) {
            this.elements.historySection.style.display = 'none';
        }
        Utils.showToast('History cleared', 'success');
    }
}

