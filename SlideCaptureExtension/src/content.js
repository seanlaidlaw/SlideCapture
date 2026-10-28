// Content script that runs in all frames
let video = null;
let isCapturing = false;
let captureInterval = null;
let lastFrameData = null;
let cropSettings = {
    direction: 'bottom-right',
    widthPercentage: 100,
    heightPercentage: 100,
    autoTrim: true
};
const CAPTURE_INTERVAL = 1000; // Capture every second
const MIN_SIMILARITY_THRESHOLD = 0.95; // Minimum similarity to consider frames different

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[SlideCapture Extension] ${message}`;
    console.log(logMessage, data || '');
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message, data }).catch(() => { });
}

function getSourceSize(el) {
    if (el instanceof HTMLVideoElement) return { width: el.videoWidth, height: el.videoHeight };
    return { width: el.width, height: el.height };
}

// Border sits outside so screenshots miss it
function highlightVideo(videoElement) {
    if (!videoElement) return;

    const existingOverlay = document.getElementById('slidecapture-crop-overlay');
    if (existingOverlay) existingOverlay.remove();

    const BORDER = 3;
    const overlay = document.createElement('div');
    overlay.id = 'slidecapture-crop-overlay';
    overlay.style.position = 'fixed'; // getBoundingClientRect is viewport-relative
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.border = `${BORDER}px solid red`;
    overlay.style.boxSizing = 'border-box';

    const r = getRectRelativeTo(videoElement, window);
    const rect = { left: r.x, top: r.y, width: r.width, height: r.height };
    const src = getSourceSize(videoElement);
    let x = rect.left, y = rect.top, w = rect.width, h = rect.height;

    if (src.width && src.height) {
        const crop = captureRect(src.width, src.height);
        const scaleX = rect.width / src.width;
        const scaleY = rect.height / src.height;
        x = rect.left + crop.x * scaleX;
        y = rect.top + crop.y * scaleY;
        w = crop.width * scaleX;
        h = crop.height * scaleY;
    }

    overlay.style.left = `${x - BORDER}px`;
    overlay.style.top = `${y - BORDER}px`;
    overlay.style.width = `${w + 2 * BORDER}px`;
    overlay.style.height = `${h + 2 * BORDER}px`;
    document.body.appendChild(overlay);
    debugLog('Capture area highlighted', { x, y, w, h });
}

// Remove border from video/canvas element
function unhighlightVideo() {
    // Remove crop overlay if it exists
    const overlay = document.getElementById('slidecapture-crop-overlay');
    if (overlay) {
        overlay.remove();
    }

    debugLog('Element unhighlighted');
}

// Update highlight when crop settings change
function updateCropHighlight() {
    if (isCapturing && video) {
        highlightVideo(video);
    }
}

// Listen for crop settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.cropSettings) {
        cropSettings = changes.cropSettings.newValue;
        updateCropHighlight();
    }
});

// Also update highlight when video size changes
const resizeObserver = new ResizeObserver(() => {
    if (isCapturing && video) {
        highlightVideo(video);
    }
});

// Start observing video element when it's found
function startObservingVideo(videoElement) {
    if (videoElement) {
        resizeObserver.observe(videoElement);
    }
}

// Stop observing when video is lost
function stopObservingVideo() {
    resizeObserver.disconnect();
}

// Calculate crop dimensions based on settings
function calculateCropDimensions(videoWidth, videoHeight) {
    const width = Math.floor(videoWidth * (cropSettings.widthPercentage / 100));
    const height = Math.floor(videoHeight * (cropSettings.heightPercentage / 100));

    let x = 0;
    let y = 0;

    switch (cropSettings.direction) {
        case 'top-left':
            x = 0;
            y = 0;
            break;
        case 'top':
            x = Math.floor((videoWidth - width) / 2);
            y = 0;
            break;
        case 'top-right':
            x = videoWidth - width;
            y = 0;
            break;
        case 'left':
            x = 0;
            y = Math.floor((videoHeight - height) / 2);
            break;
        case 'center':
            x = Math.floor((videoWidth - width) / 2);
            y = Math.floor((videoHeight - height) / 2);
            break;
        case 'right':
            x = videoWidth - width;
            y = Math.floor((videoHeight - height) / 2);
            break;
        case 'bottom-left':
            x = 0;
            y = videoHeight - height;
            break;
        case 'bottom':
            x = Math.floor((videoWidth - width) / 2);
            y = videoHeight - height;
            break;
        case 'bottom-right':
            x = videoWidth - width;
            y = videoHeight - height;
            break;
    }

    return { x, y, width, height };
}


const BORDER_LEVEL = 24;
const SOLID_LEVEL = 64;
const SOLID_DEPTH = 3;
const TRIM_INSET = 1;
const MIN_KEPT_FRACTION = 0.6;

// Border depth per edge, in source pixels
let borderTrim = null;

function autoTrimEnabled() {
    return cropSettings.autoTrim !== false;
}

function brightnessProfiles(src) {
    const SAMPLES = 64;
    const read = (width, height) => {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        // Smoothing blurs rows into each other
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src.source, 0, 0, src.width, src.height, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
    };
    const maxChannel = (d, i) => Math.max(d[i], d[i + 1], d[i + 2]);

    const rowData = read(SAMPLES, src.height);
    const rows = new Array(src.height).fill(0);
    for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < SAMPLES; x++) rows[y] += maxChannel(rowData, (y * SAMPLES + x) * 4);
        rows[y] /= SAMPLES;
    }

    const columnData = read(src.width, SAMPLES);
    const columns = new Array(src.width).fill(0);
    for (let y = 0; y < SAMPLES; y++) {
        for (let x = 0; x < src.width; x++) columns[x] += maxChannel(columnData, (y * src.width + x) * 4);
    }
    for (let x = 0; x < src.width; x++) columns[x] /= SAMPLES;

    return { rows, columns };
}

// Bar depth, or null unless solid content follows
function measureBorder(profile) {
    let depth = 0;
    while (depth < profile.length && profile[depth] <= BORDER_LEVEL) depth++;
    const start = depth > 0 ? depth + TRIM_INSET : 0;
    if (start + SOLID_DEPTH > profile.length) return null;
    for (let i = start; i < start + SOLID_DEPTH; i++) {
        if (profile[i] < SOLID_LEVEL) return null;
    }
    return depth;
}

// Returns true when the trim changed
function updateBorderTrim(src) {
    if (!borderTrim || borderTrim.width !== src.width || borderTrim.height !== src.height) {
        borderTrim = { width: src.width, height: src.height, top: null, bottom: null, left: null, right: null };
    }
    const { rows, columns } = brightnessProfiles(src);
    const seen = {
        top: measureBorder(rows),
        bottom: measureBorder(rows.slice().reverse()),
        left: measureBorder(columns),
        right: measureBorder(columns.slice().reverse())
    };
    const keptHeight = 1 - ((seen.top || 0) + (seen.bottom || 0)) / src.height;
    const keptWidth = 1 - ((seen.left || 0) + (seen.right || 0)) / src.width;
    if (keptHeight < MIN_KEPT_FRACTION || keptWidth < MIN_KEPT_FRACTION) return false;

    let changed = false;
    for (const edge of ['top', 'bottom', 'left', 'right']) {
        if (seen[edge] === null) continue;
        const next = borderTrim[edge] === null ? seen[edge] : Math.min(borderTrim[edge], seen[edge]);
        if (next !== borderTrim[edge]) {
            borderTrim[edge] = next;
            changed = true;
        }
    }
    return changed;
}

function trimmedBox(width, height) {
    if (!autoTrimEnabled() || !borderTrim) return { x: 0, y: 0, width, height };
    const depth = edge => (borderTrim[edge] ? borderTrim[edge] + TRIM_INSET : 0);
    const scaleX = width / borderTrim.width;
    const scaleY = height / borderTrim.height;
    const left = Math.round(depth('left') * scaleX);
    const right = Math.round(depth('right') * scaleX);
    const top = Math.round(depth('top') * scaleY);
    const bottom = Math.round(depth('bottom') * scaleY);
    return { x: left, y: top, width: width - left - right, height: height - top - bottom };
}

// User crop applied inside the trimmed box
function captureRect(width, height) {
    const box = trimmedBox(width, height);
    const crop = calculateCropDimensions(box.width, box.height);
    return { x: box.x + crop.x, y: box.y + crop.y, width: crop.width, height: crop.height };
}

// Calculate perceptual hash using phash library
function calculatePHash(imageData) {
    // Convert ImageData to Uint8Array for phash
    const pixels = new Uint8Array(imageData.data.length / 4);
    for (let i = 0; i < imageData.data.length; i += 4) {
        pixels[i / 4] = Math.floor((imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3);
    }

    // Calculate hash using phash
    const hash = phash.calculate(pixels, imageData.width, imageData.height);
    return hash;
}

// Calculate similarity between two hashes using phash
function calculateSimilarity(hash1, hash2) {
    return phash.compare(hash1, hash2);
}

// Helper function to check if a canvas should be excluded
function isExcludedCanvas(canvas) {
    if (!canvas.id) return false;

    const excludedSuffixes = ['-anno', '-local', '-share'];
    return excludedSuffixes.some(suffix =>
        canvas.id.toLowerCase().endsWith(suffix)
    );
}

// Helper function to get canvas dimensions
function getCanvasDimensions(canvas) {
    return {
        id: canvas.id,
        className: canvas.className,
        width: canvas.width,
        height: canvas.height,
        area: canvas.width * canvas.height
    };
}

// Helper function to log canvas details
function logCanvasDetails(canvas, prefix = '') {
    debugLog(`${prefix}Canvas:`, {
        ...getCanvasDimensions(canvas),
        attributes: Array.from(canvas.attributes)
            .map(attr => `${attr.name}="${attr.value}"`)
            .join(', ')
    });
}

// Find the largest canvas in a shadow DOM
function findLargestCanvas(container) {
    const shadow = container ? getShadowRoot(container) : null;
    if (!container) return null;
    if (!shadow && !container.querySelector('canvas')) {
        debugLog('Container not found or does not have shadow root');
        return null;
    }

    const canvasElements = [
        ...(shadow ? shadow.querySelectorAll('canvas') : []),
        ...container.querySelectorAll('canvas')
    ];
    debugLog(`Found ${canvasElements.length} canvas elements in shadow DOM`);

    // Log all canvases for debugging
    canvasElements.forEach((canvas, index) => {
        logCanvasDetails(canvas, `Canvas ${index}: `);
    });

    // Filter out excluded canvases and find the largest one
    const validCanvases = Array.from(canvasElements)
        .filter(canvas => !isExcludedCanvas(canvas))
        .map(canvas => ({
            canvas,
            dimensions: getCanvasDimensions(canvas)
        }));

    if (validCanvases.length === 0) {
        debugLog('No suitable canvas elements found in shadow DOM');
        return null;
    }

    // Find the largest canvas by area
    const largestCanvas = validCanvases.reduce((largest, current) => {
        if (current.dimensions.area > largest.dimensions.area) {
            debugLog('New largest canvas found:', current.dimensions);
            return current;
        }
        return largest;
    }, validCanvases[0]);

    debugLog('Selected largest canvas:', {
        ...largestCanvas.dimensions,
        attributes: Array.from(largestCanvas.canvas.attributes)
            .map(attr => `${attr.name}="${attr.value}"`)
            .join(', ')
    });

    return largestCanvas.canvas;
}

// Parent frames skip documents marked here
try { document.documentElement.dataset.slidecaptureInjected = '1'; } catch (e) { }

// Includes closed roots (extension-only API)
function getShadowRoot(el) {
    try {
        if (chrome.dom && chrome.dom.openOrClosedShadowRoot) {
            return chrome.dom.openOrClosedShadowRoot(el) || null;
        }
    } catch (e) { }
    return el.shadowRoot || null;
}

// Also searches shadow roots and uninjected iframes
function querySelectorAllDeep(selector, root = document, seen = new Set()) {
    if (!root || seen.has(root)) return [];
    seen.add(root);
    const results = [...root.querySelectorAll(selector)];
    for (const el of root.querySelectorAll('*')) {
        const sr = getShadowRoot(el);
        if (sr) results.push(...querySelectorAllDeep(selector, sr, seen));
        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
            let doc = null;
            try { doc = el.contentDocument; } catch (e) { }
            if (doc && doc.documentElement && !doc.documentElement.dataset.slidecaptureInjected) {
                results.push(...querySelectorAllDeep(selector, doc, seen));
            }
        }
    }
    return results;
}

function logPageDiagnostics() {
    let shadowHosts = 0, closedHosts = 0;
    const custom = new Set();
    for (const el of document.querySelectorAll('*')) {
        if (el.tagName.includes('-')) custom.add(el.tagName.toLowerCase());
        const sr = getShadowRoot(el);
        if (sr) { shadowHosts++; if (!el.shadowRoot) closedHosts++; }
    }
    debugLog('Page diagnostics', {
        frameUrl: location.href,
        isTopFrame: window === window.top,
        iframes: [...document.querySelectorAll('iframe')].map(f => f.src || '(no src)'),
        shadowHosts, closedShadowHosts: closedHosts,
        customElements: [...custom].slice(0, 30),
        deepCanvases: querySelectorAllDeep('canvas').map(c => `${c.id || '(no id)'} ${c.width}x${c.height}`).slice(0, 20)
    });
}

function isShareContainer(container) {
    if (container.querySelector('video-player[media-type="share"]')) return true;
    const cls = (container.className || '') + ' ' + (container.parentElement?.className || '');
    return /share/i.test(cls);
}

function findZoomCanvas() {
    const containers = querySelectorAllDeep('video-player-container');
    if (containers.length === 0) {
        const canvases = querySelectorAllDeep('canvas[id^="video-player-canvas"]')
            .filter(c => !isExcludedCanvas(c) && c.width > 0 && c.height > 0);
        if (canvases.length === 0) return null;
        debugLog(`No containers, but found ${canvases.length} Zoom video canvases`);
        const hostOf = c => c.getRootNode()?.host || c.parentElement;
        const shareCanvases = canvases.filter(c => {
            const h = hostOf(c);
            return h && (/share/i.test(h.className || '') || (h.closest && h.closest('[class*="share"]')) ||
                (h.querySelector && h.querySelector('[media-type="share"]')));
        });
        const pool = shareCanvases.length ? shareCanvases : canvases;
        return pool.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    }
    debugLog(`Found ${containers.length} video-player-container elements`);

    const share = containers.filter(isShareContainer);
    const candidates = share.length > 0 ? share : containers;
    if (share.length > 0) debugLog(`${share.length} of them are screen-share containers`);

    let best = null;
    for (const container of candidates) {
        const canvas = findLargestCanvas(container);
        if (!canvas) continue;
        const area = canvas.width * canvas.height;
        if (!best || area > best.area) best = { canvas, area };
    }
    return best ? best.canvas : null;
}

function findVideo() {
    debugLog('Searching for video and canvas elements...');

    const canvas = findZoomCanvas();
    if (canvas) {
        debugLog('Found Zoom canvas element', { id: canvas.id, width: canvas.width, height: canvas.height });
        startObservingVideo(canvas);
        return canvas;
    }

    const videos = querySelectorAllDeep('video');
    debugLog(`Found ${videos.length} video elements`);

    const ready = videos.find(v => v.readyState >= 3 && v.videoWidth > 0 && v.videoHeight > 0);
    if (ready) {
        debugLog('Found suitable video element', { w: ready.videoWidth, h: ready.videoHeight });
        startObservingVideo(ready);
        return ready;
    }

    if (videos.length > 0) {
        debugLog('No suitable video found, using first available video');
        startObservingVideo(videos[0]);
        return videos[0];
    }

    debugLog('No video or canvas elements found');
    logPageDiagnostics();
    return null;
}

// WebGL canvases may read back blank
let useScreenshotMode = false;
let blankFrameCount = 0;
const BLANK_FRAMES_BEFORE_FALLBACK = 3;

function isBlankImage(imageData) {
    const d = imageData.data;
    let min = 255, max = 0, alphaMax = 0;
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (g < min) min = g;
        if (g > max) max = g;
        if (d[i + 3] > alphaMax) alphaMax = d[i + 3];
    }
    return alphaMax === 0 || (max - min) < 2;
}

function getRectRelativeTo(el, targetWin) {
    const r = el.getBoundingClientRect();
    let x = r.left, y = r.top;
    let win = el.ownerDocument.defaultView;
    try {
        while (win && win !== targetWin && win.frameElement) {
            const fe = win.frameElement;
            const fr = fe.getBoundingClientRect();
            x += fr.left + fe.clientLeft;
            y += fr.top + fe.clientTop;
            win = win.parent;
        }
    } catch (e) {
        debugLog('Cross-origin iframe: capture area may be offset', e.message);
    }
    return { x, y, width: r.width, height: r.height };
}

function getRectInTopWindow(el) {
    let top = window;
    try { top = window.top; void top.innerWidth; } catch (e) { top = window; }
    return getRectRelativeTo(el, top);
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function grabViaScreenshot(el) {
    const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' });
    if (!response || !response.dataUrl) {
        throw new Error('Tab screenshot failed: ' + (response && response.error));
    }
    const img = await loadImage(response.dataUrl);
    const rect = getRectInTopWindow(el);
    const topWidth = (() => { try { return window.top.innerWidth; } catch (e) { return window.innerWidth; } })();
    const scale = img.naturalWidth / topWidth;

    const sx = Math.max(0, Math.round(rect.x * scale));
    const sy = Math.max(0, Math.round(rect.y * scale));
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scale));
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scale));
    if (sw <= 0 || sh <= 0) throw new Error('Element is not visible on screen');

    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
}

async function getFrameSource(el) {
    if (!useScreenshotMode) {
        try {
            const { width, height } = getSourceSize(el);
            if (!width || !height) return null;

            // Videos read back fine; skip blank check
            if (el instanceof HTMLVideoElement) {
                return { source: el, width, height };
            }

            const probe = document.createElement('canvas');
            probe.width = probe.height = 32;
            const pctx = probe.getContext('2d');
            pctx.drawImage(el, 0, 0, width, height, 0, 0, 32, 32);
            if (!isBlankImage(pctx.getImageData(0, 0, 32, 32))) {
                blankFrameCount = 0;
                return { source: el, width, height };
            }
            blankFrameCount++;
            debugLog(`Direct read gave a blank frame (${blankFrameCount}/${BLANK_FRAMES_BEFORE_FALLBACK})`);
            if (blankFrameCount < BLANK_FRAMES_BEFORE_FALLBACK) return null;
        } catch (e) {
            // Tainted video or unreadable canvas
            debugLog('Direct read failed: ' + e.message);
        }
        debugLog('Switching to tab-screenshot capture mode');
        useScreenshotMode = true;
    }
    const shot = await grabViaScreenshot(el);
    return { source: shot, width: shot.width, height: shot.height };
}

function thumbnailFromSource(src) {
    const SIZE = 64;
    const crop = captureRect(src.width, src.height);
    const t = document.createElement('canvas');
    t.width = t.height = SIZE;
    const ctx = t.getContext('2d');
    ctx.drawImage(src.source, crop.x, crop.y, crop.width, crop.height, 0, 0, SIZE, SIZE);
    return ctx.getImageData(0, 0, SIZE, SIZE);
}

function fullFrameFromSource(src) {
    const crop = captureRect(src.width, src.height);
    const c = document.createElement('canvas');
    c.width = crop.width;
    c.height = crop.height;
    c.getContext('2d').drawImage(src.source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return c;
}

function imageDataToCanvas(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas;
}

function averageHash(imageData, size = 8) {
    // Downscale to size x size and grayscale
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = size;
    tmpCanvas.height = size;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.drawImage(
        imageDataToCanvas(imageData),
        0, 0, imageData.width, imageData.height,
        0, 0, size, size
    );
    const smallData = tmpCtx.getImageData(0, 0, size, size).data;
    let sum = 0;
    const grays = [];
    for (let i = 0; i < smallData.length; i += 4) {
        const gray = (smallData[i] + smallData[i + 1] + smallData[i + 2]) / 3;
        grays.push(gray);
        sum += gray;
    }
    const mean = sum / grays.length;
    // Build hash
    return grays.map(v => v > mean ? 1 : 0);
}

function ahashSimilarity(hash1, hash2) {
    let same = 0;
    for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] === hash2[i]) same++;
    }
    return same / hash1.length;
}

function needsNewTarget() {
    if (!video || !video.isConnected) return true;
    // Switch to a share that appeared later
    if (!(video instanceof HTMLVideoElement)) {
        const container = video.getRootNode()?.host;
        if (container && !isShareContainer(container) &&
            querySelectorAllDeep('video-player-container').some(isShareContainer)) {
            return true;
        }
    }
    return false;
}

let captureBusy = false;

async function captureTick() {
    if (captureBusy) return;
    captureBusy = true;
    try {
        if (needsNewTarget()) {
            debugLog('Looking for capture target');
            const found = findVideo();
            if (found !== video) {
                video = found;
                blankFrameCount = 0;
                useScreenshotMode = false;
                lastFrameData = null;
                borderTrim = null;
            }
            if (!video) {
                debugLog('No video/canvas element found yet, will keep looking');
                unhighlightVideo();
                return;
            }
            highlightVideo(video);
        }

        const src = await getFrameSource(video);
        if (!src) return;
        if (autoTrimEnabled()) {
            try {
                if (updateBorderTrim(src)) {
                    debugLog('Black border trim updated', borderTrim);
                    highlightVideo(video);
                }
            } catch (e) {
                debugLog('Border detection failed: ' + e.message);
            }
        }
        const thumbnail = thumbnailFromSource(src);

        if (!(src.source instanceof HTMLVideoElement) && isBlankImage(thumbnail)) {
            debugLog('Frame is blank, skipping');
            return;
        }

        const currAhash = averageHash(thumbnail, 8);
        if (lastFrameData && ahashSimilarity(currAhash, lastFrameData.ahash) === 1) {
            debugLog('Thumbnail visually identical to previous (aHash), skipping');
            return;
        }

        const currentHash = calculatePHash(thumbnail);
        if (lastFrameData) {
            const similarity = calculateSimilarity(currentHash, lastFrameData.hash);
            debugLog('Frame similarity:', similarity);
            if (similarity > MIN_SIMILARITY_THRESHOLD) {
                debugLog('Frame too similar, skipping');
                return;
            }
        }

        const frame = fullFrameFromSource(src);
        const imageData = frame.toDataURL('image/webp', 0.8);
        lastFrameData = { hash: currentHash, ahash: currAhash, timestamp: Date.now() };

        debugLog('Sending frame to background', { width: frame.width, height: frame.height, screenshotMode: useScreenshotMode });
        chrome.runtime.sendMessage({
            type: 'FRAME_CAPTURED',
            data: {
                imageData,
                timestamp: lastFrameData.timestamp,
                width: frame.width,
                height: frame.height
            }
        }).catch(error => debugLog('Error sending frame:', error));
    } catch (error) {
        debugLog('Error capturing frame: ' + (error && error.message), error);
    } finally {
        captureBusy = false;
    }
}

// Start capturing frames
function startCapture() {
    debugLog('startCapture called');
    if (isCapturing) {
        debugLog('Already capturing, returning');
        return;
    }

    // Runs in every frame; one captures
    video = findVideo();
    if (!video) {
        debugLog('No suitable video element found in this frame');
        return;
    }

    chrome.storage.local.get(['cropSettings'], (result) => {
        if (result.cropSettings) {
            cropSettings = result.cropSettings;
            if (isCapturing) highlightVideo(video);
        }
    });

    isCapturing = true;
    useScreenshotMode = false;
    blankFrameCount = 0;
    lastFrameData = null;
    borderTrim = null;
    highlightVideo(video);
    captureInterval = setInterval(captureTick, CAPTURE_INTERVAL);
    debugLog('Started capturing frames');
}

// Stop capturing frames
function stopCapture() {
    if (!isCapturing) return;

    clearInterval(captureInterval);
    isCapturing = false;
    unhighlightVideo(video);
    video = null;
    lastFrameData = null;
    borderTrim = null;
    debugLog('Stopped capturing frames');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog('Content script received message', message);

    switch (message.type) {
        case 'START_CAPTURE':
            debugLog('Starting capture from message');
            startCapture();
            break;
        case 'STOP_CAPTURE':
            debugLog('Stopping capture from message');
            stopCapture();
            break;
        case 'DELETE_CAPTURE':
            // stop capture if running
            stopCapture();
            // Reset in-memory state
            lastFrameData = null;
            // If you have other in-memory variables, reset them here
            debugLog('Capture state deleted and reset.');
            break;
    }
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        averageHash,
        ahashSimilarity,
        calculatePHash,
        calculateSimilarity,
        isBlankImage
    };
} 