import { Utils } from './utils.js';
import { StorageManager } from './storage.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

export class ConversionManager {
    constructor(ui) {
        this.ui = ui;
        this.el = ui.elements;
    }

    async pollJobStatus(jobId, fmt, isResume = false) {
        const isMob = Utils.isMobile;
        const baseInt = isMob ? 5000 : 1500;
        const maxErrs = isMob ? 3 : 5;
        let interval = baseInt;
        let errs = 0;
        let lastSt = null;

        while (true) {
            if (!this.ui.pageVisible) {
                await wait(interval);
                continue;
            }

            try {
                const res = await Utils.fetchWithTimeout(`/progress/${jobId}`, {
                    headers: { 'Cache-Control': 'no-cache' }
                }, isMob ? 2e4 : 15e3);

                if (!res.ok) throw new Error(res.statusText);
                const data = await res.json();

                errs = 0;
                interval = baseInt;

                const st = data.status;
                if (lastSt !== st || st === 'running') {
                    this._updateProg(data, lastSt);
                }
                lastSt = st;

                if (st === 'done') return this._complete(data, fmt);
                if (st === 'error' || st === 'cancelled') return this._err(data);

            } catch (e) {
                errs++;
                console.warn(`Poll err ${errs}/${maxErrs}:`, e.message);
                interval = Math.min(interval * 1.5, 3e4);

                if (errs >= maxErrs) return this._connLost();
                this._retryMsg(errs, lastSt);
            }
            await wait(interval);
        }
    }

    _updateProg(data, lastSt) {
        const box = this.el.progressBox;
        const st = data.status;
        if (st === 'queued' && lastSt !== 'queued') {
            box.innerHTML = Utils.createIndeterminateProgressBar('Queued...', 'queue');
        } else if (st === 'running' || st === 'predict') {
            const txt = data.message || 'Processing...';
            const exist = box.querySelector('.loading-text') || box.querySelector('.upload-progress-text'); // Check for either type

            // If we are switching from queued/uploading to running, or if the container type doesn't match
            if (lastSt !== 'running' && lastSt !== 'predict' || !exist || !exist.classList.contains('upload-progress-text')) {
                box.innerHTML = Utils.createIndeterminateProgressBar(txt, 'processing');
            } else if (exist.textContent !== txt) {
                exist.textContent = txt;
            }
        }
    }

    _complete(data, fmt) {
        StorageManager.clearActiveJob();
        this.el.progressBox.innerHTML = Utils.createSuccessMessage('Done!');

        const f = (data.format || fmt).toLowerCase();
        const label = Utils.getFormatLabel(f);
        const p = data.params;
        const det = p ? ` (fps ${p.fps}, ${p.width}×${p.height}, ${p.output_size_mb} MB)` : '';

        this.displayResult(data.gif_url, label, det, p, f);
        this._resetUI(true);
        StorageManager.saveCompletedResult(data.gif_url, p, f);
        StorageManager.saveToHistory(data.gif_url, f, p);

        if (StorageManager.getAutoDownload()) this._forceDL(data.gif_url, label);
        if (window.uiManager?.loadAndDisplayHistory) window.uiManager.loadAndDisplayHistory();
    }

    _forceDL(url, label) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `converted_video.${Utils.getExtensionForFormat(label.toLowerCase()).replace('.', '')}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        Utils.showToast('Download started automatically', 'success', 2e3);
    }

    _err(data) {
        StorageManager.clearActiveJob();
        this.el.progressBox.innerHTML = Utils.createErrorMessage(
            data.status === 'cancelled' ? `Cancelled: ${data.message || 'User cancelled'}` : `Error: ${data.message || 'Unknown'}`
        );
        this._resetUI(false);
    }

    _connLost() {
        StorageManager.clearActiveJob();
        this.el.progressBox.innerHTML = Utils.createErrorMessage('Connection lost. Refresh page.');
        this._resetUI(false);
    }

    _retryMsg(cnt, st) {
        const msg = { 1: 'Connection issue... retrying...', 3: 'Still trying...' }[cnt];
        if (msg && st !== `error-${cnt}`) this.el.progressBox.innerHTML = Utils.createLoadingContainer(msg);
    }

    _resetUI(success) {
        const ui = this.ui;
        ui.elements.submitBtn.disabled = false;
        ui.setResetButtonProcessing(false);
        ui.setFormatSelectionDisabled(false);
        ui.setUploadAreaDisabled(false);

        if (success) {
            ui.elements.form.style.display = 'none';
            document.getElementById('uploadArea').style.display = 'none';
            document.querySelector('.smart-settings').style.display = 'none';
            document.querySelector('.output-section').style.display = 'none';
        }
    }

    displayResult(url, label, det, params, fmt) {
        const id = `pv-${Date.now()}`;
        const isAvif = label.toLowerCase() === 'avif';
        const isVid = ['mp4', 'av1'].includes(label.toLowerCase());
        const full = window.location.origin + url;

        this.el.resultBox.innerHTML = `
            ${this._preview(url, label, id, isAvif, isVid)}
            <div class="result-actions">
                <a class="button download-btn" href="${url}" download>⬇️ Download ${label}</a>
                <button class="button copy-link-btn" onclick="window.conversionManager.copyResultFile('${full}')" title="Copy File">📋 Copy File</button>
                <a class="button" href="/8mb" onclick="return window.uiManager.handleConvertAnother()">🔄 Convert another</a>
            </div>
            <p class="meta center">${det}</p>
        `;
        this.el.resultBox.style.display = 'block';
    }

    async copyResultFile(url) {
        try {
            Utils.showToast('Downloading to clipboard...', 'info', 2e3);
            const res = await fetch(url);
            if (!res.ok) throw new Error('Download failed');
            const blob = await res.blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            Utils.showToast('File copied to clipboard!', 'success');
        } catch (e) {
            console.warn('Copy file failed:', e);
            if (await Utils.copyToClipboard(url)) {
                Utils.showToast('File copy failed. Link copied instead!', 'warning');
            } else {
                Utils.showToast('Failed to copy', 'error');
            }
        }
    }

    shareToDiscord(url) {
        Utils.copyToClipboard(url);
        Utils.showToast('Link copied! Paste in Discord to share.', 'success', 3e3);
        window.open(`https://discord.com/channels/@me`, '_blank');
    }

    _preview(url, label, id, avif, vid) {
        if (!Utils.isMobile || window.innerWidth >= 768) {
            return `<div class="gif-wrapper">${vid ?
                `<video src="${url}" controls style="max-width:100%;height:auto" loading="lazy">` :
                `<img src="${url}" alt="${label}" loading="lazy">`}</div>`;
        }

        const btnStyle = `margin-top:8px;padding:10px 20px;background:${avif ? '#fd7e14' : '#28a745'};border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:500`;
        const warn = avif ? '⚠️ AVIF preview may crash mobile' : vid ? '🎬 Video preview' : 'Tap to safely preview';

        return `
            <div class="gif-wrapper"><div id="${id}" style="padding:20px;text-align:center;background:#d4edda;border:2px solid #c3e6cb;border-radius:8px">
                <p>✅ Conversion Complete!</p>
                <p style="font-size:14px;color:#155724;margin:8px 0">Your ${label} is ready!</p>
                <button onclick="window.mobileManager.showMobilePreview('${url}','${label}','${id}')" style="${btnStyle}">
                    ${avif ? '⚠️ Try AVIF Preview' : vid ? '🎬 Show Video' : '📱 Show Preview'}
                </button>
                <p style="font-size:12px;color:${avif ? '#856404' : '#6c757d'};margin-top:8px">${warn}</p>
            </div></div>`;
    }

    displayCompletedResult(res) {
        this.el.progressBox.style.display = 'none';
        const label = Utils.getFormatLabel(res.format);
        const det = res.params ? ` (fps ${res.params.fps}, ${res.params.width}×${res.params.height}, ${res.params.output_size_mb} MB)` : '';
        this.displayResult(res.gifUrl, label, det, res.params, res.format);
        this._resetUI(true);
    }

    async checkAndResumeJob() {
        const saved = StorageManager.getCompletedResult();
        if (saved) return this.displayCompletedResult(saved);

        const job = StorageManager.getActiveJob();
        if (!job) return;

        try {
            const res = await Utils.fetchWithTimeout(`/progress/${job.jobId}`, {
                headers: { 'Cache-Control': 'no-cache' }
            }, 1e4);

            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const st = data.status;

            if (st && !['done', 'error', 'cancelled'].includes(st)) {
                this.el.progressBox.style.display = 'block';
                this.el.resultBox.style.display = 'none';
                this.el.submitBtn.disabled = true;
                this.el.progressBox.innerHTML = Utils.createLoadingContainer('🔄 Resumed tracking...');
                this.ui.setFormatSelectionDisabled(true);
                this.ui.setResetButtonProcessing(true);
                this.pollJobStatus(job.jobId, job.format, true);
            } else {
                StorageManager.clearActiveJob();
            }
        } catch (e) {
            console.warn('Resume failed:', e.message);
            StorageManager.clearActiveJob();
        }
    }

    init() {
        window.conversionManager = this;

        // PASTE SUPPORT
        document.addEventListener('paste', async (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('video/')) {
                    const file = item.getAsFile();
                    this.el.fileInput.files = Utils.createFileList([file]);
                    this.el.fileInput.dispatchEvent(new Event('change'));
                    Utils.showToast('Video pasted from clipboard!', 'success');
                    return;
                } else if (item.kind === 'string' && item.type === 'text/plain') {
                    // Check if it's a URL (future feature: download from URL)
                    item.getAsString(s => {
                        if (s.match(/^https?:\/\/.+/)) {
                            Utils.showToast('URL paste supported soon!', 'info');
                        }
                    });
                }
            }
        });

        setTimeout(() => {
            try { this.checkAndResumeJob(); }
            catch (e) { Utils.handleCriticalError(e, 'Resume job'); }
        }, Utils.isMobile ? 1000 : 100);
    }
}
