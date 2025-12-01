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
            queueCount: document.getElementById('queue-count')
        };

        this.currentUploadController = null;
        this.pageVisible = true;
        this.queueCounterInterval = null;
        this.queueRetryCount = 0;
    }

    // Initialize UI event handlers
    init() {
        this.setupFormatHandling();
        this.setupUploadArea();
        this.setupFormHandling();
        this.setupResetButton();
        this.setupVisibilityHandling();
        this.startQueuePolling();
    }

    // Format selection and banner management
    setupFormatHandling() {
        // Update filename extension and show/hide AVIF warning banner when format changes
        this.elements.formatSelect?.addEventListener('change', () => {
            const format = this.elements.formatSelect.value;
            const extension = Utils.getExtensionForFormat(format);
            this.elements.fileExtension.textContent = extension;
            this.updateAVIFBanner(format);
        });

        // Initialize banner state and file extension on page load
        const selectedFormat = this.elements.formatSelect?.value || 'av1';
        const extension = Utils.getExtensionForFormat(selectedFormat);
        if (this.elements.fileExtension) {
            this.elements.fileExtension.textContent = extension;
        }
        this.updateAVIFBanner(selectedFormat);
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
                if (files.length > 0 && files[0].type.startsWith('video/')) {
                    this.elements.fileInput.files = files;
                    this.updateUploadAreaWithFile(files[0]);
                }
            }
        });
    }

    // Update upload area display with file info
    updateUploadAreaWithFile(file) {
        if (!this.elements.uploadArea) return;
        
        this.elements.uploadArea.querySelector('.upload-text').textContent = file.name;
        this.elements.uploadArea.querySelector('.upload-subtext').textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
        this.elements.uploadArea.style.borderColor = '#34c759';
        this.elements.uploadArea.style.backgroundColor = '#f0fff4';
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

    // Start conversion process
    async startConversion() {
        // Clear any existing completed result when starting new conversion
        StorageManager.clearCompletedResult();

        // Set processing state
        this.setResetButtonProcessing(true);

        this.elements.progressBox.style.display = 'block';
        this.elements.resultBox.style.display = 'none';
        this.elements.progressBox.innerHTML = Utils.createLoadingContainer('Uploading...');
        this.elements.submitBtn.disabled = true;

        // Disable format selection and upload area during conversion
        this.setFormatSelectionDisabled(true);
        this.setUploadAreaDisabled(true);

        const data = new FormData();
        data.append('video', this.elements.fileInput.files[0]);
        if (this.elements.formatSelect) data.append('format', this.elements.formatSelect.value);
        if (this.elements.filenameInput) data.append('filename', this.elements.filenameInput.value);

        try {
            const controller = new AbortController();
            this.currentUploadController = controller;

            const resp = await fetch('/start', {
                method: 'POST',
                body: data,
                signal: controller.signal
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${resp.status}: ${resp.statusText}`);
            }
            
            const json = await resp.json();
            const jobId = json.job_id;
            
            this.currentUploadController = null;
            StorageManager.saveActiveJob(jobId, this.elements.formatSelect?.value || 'avif');
            
            this.elements.progressBox.innerHTML = Utils.createLoadingContainer('Started. Preparing...');
            
            // Trigger conversion polling - this will be handled by the conversion module
            if (window.conversionManager) {
                window.conversionManager.pollJobStatus(jobId, this.elements.formatSelect?.value || 'avif');
            }
            
        } catch (err) {
            this.currentUploadController = null;
            console.error('Upload error:', err);

            const errorMessage = err.message.includes('Failed to fetch') || err.message.includes('NetworkError')
                ? 'Network error. Please check your connection and try again.'
                : err.message;

            this.elements.progressBox.innerHTML = Utils.createErrorMessage(errorMessage);
            this.elements.submitBtn.disabled = false;
            this.setResetButtonProcessing(false);
            this.setFormatSelectionDisabled(false);
            this.setUploadAreaDisabled(false);
        }
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
}
