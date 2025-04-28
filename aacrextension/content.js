// Content script that runs in all frames
let video = null;
let isCapturing = false;
let captureInterval = null;
let lastFrameData = null;
let lastVideoCheck = 0;
let cropSettings = {
    direction: 'bottom-right',
    widthPercentage: 100,
    heightPercentage: 100
};
const VIDEO_CHECK_INTERVAL = 1000; // Check for video every second
const CAPTURE_INTERVAL = 1000; // Capture every second
const MIN_SIMILARITY_THRESHOLD = 0.95; // Minimum similarity to consider frames different

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[AACR Extension] ${message}`;
    console.log(logMessage, data || '');
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message, data }).catch(() => { });
}

// Add red border to video element
function highlightVideo(videoElement) {
    if (!videoElement) return;
    videoElement.style.border = '3px solid red';
    videoElement.style.boxSizing = 'border-box';
    debugLog('Video highlighted');
}

// Remove border from video element
function unhighlightVideo(videoElement) {
    if (!videoElement) return;
    videoElement.style.border = '';
    videoElement.style.boxSizing = '';
    debugLog('Video unhighlighted');
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

// Create a thumbnail of the video frame
function createThumbnail(canvas, video) {
    const ctx = canvas.getContext('2d');
    const scale = 0.1; // Create a small thumbnail (10% of original size)

    // Calculate crop dimensions
    const crop = calculateCropDimensions(video.videoWidth, video.videoHeight);

    canvas.width = crop.width * scale;
    canvas.height = crop.height * scale;

    // Draw only the cropped portion
    ctx.drawImage(
        video,
        crop.x, crop.y, crop.width, crop.height, // source rectangle
        0, 0, canvas.width, canvas.height        // destination rectangle
    );

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
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

// Find a suitable video element
function findVideo() {
    debugLog('Searching for video elements...');
    const videos = document.querySelectorAll('video');
    debugLog(`Found ${videos.length} video elements`);

    for (const v of videos) {
        debugLog('Checking video element:', {
            readyState: v.readyState,
            videoWidth: v.videoWidth,
            videoHeight: v.videoHeight,
            src: v.src,
            currentSrc: v.currentSrc,
            tagName: v.tagName,
            id: v.id,
            className: v.className
        });

        if (v.readyState >= 3 && v.videoWidth > 0 && v.videoHeight > 0) {
            debugLog('Found suitable video element');
            return v;
        }
    }

    // If no suitable video found, try to find any video element
    if (videos.length > 0) {
        debugLog('No suitable video found, using first available video');
        return videos[0];
    }

    debugLog('No video elements found');
    return null;
}

// Start capturing frames
function startCapture() {
    debugLog('startCapture called');
    if (isCapturing) {
        debugLog('Already capturing, returning');
        return;
    }

    video = findVideo();
    if (!video) {
        debugLog('No suitable video element found');
        return;
    }

    // Get current crop settings
    chrome.storage.local.get(['cropSettings'], (result) => {
        debugLog('Retrieved crop settings:', result.cropSettings);
        if (result.cropSettings) {
            cropSettings = result.cropSettings;
        }
    });

    isCapturing = true;
    highlightVideo(video);
    const canvas = document.createElement('canvas');
    lastFrameData = null;

    captureInterval = setInterval(() => {
        debugLog('Capture interval triggered');
        if (!video || video.readyState < 3) {
            debugLog('Video element lost or not ready, finding new one');
            video = findVideo();
            if (!video) {
                debugLog('No video element found, stopping capture');
                stopCapture();
                return;
            }
            highlightVideo(video);
        }

        try {
            debugLog('Attempting to capture frame');
            // Create thumbnail and calculate hash
            const thumbnail = createThumbnail(canvas, video);
            const currentHash = calculatePHash(thumbnail);
            debugLog('Calculated hash for frame');

            // Check if this frame is different from the last one
            if (lastFrameData) {
                const similarity = calculateSimilarity(currentHash, lastFrameData.hash);
                debugLog('Frame similarity:', similarity);
                if (similarity > MIN_SIMILARITY_THRESHOLD) {
                    debugLog('Frame too similar, skipping');
                    return; // Skip similar frames
                }
            }

            // Capture the full resolution frame with crop
            const crop = calculateCropDimensions(video.videoWidth, video.videoHeight);
            debugLog('Calculated crop dimensions:', crop);
            canvas.width = crop.width;
            canvas.height = crop.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(
                video,
                crop.x, crop.y, crop.width, crop.height,
                0, 0, canvas.width, canvas.height
            );

            // Store frame data and send to background
            const imageData = canvas.toDataURL('image/webp', 0.8);
            lastFrameData = {
                hash: currentHash,
                timestamp: Date.now()
            };

            debugLog('Sending frame to background');
            chrome.runtime.sendMessage({
                type: 'FRAME_CAPTURED',
                data: {
                    imageData,
                    timestamp: lastFrameData.timestamp,
                    width: canvas.width,
                    height: canvas.height
                }
            }).catch(error => {
                debugLog('Error sending frame:', error);
            });

        } catch (error) {
            debugLog('Error capturing frame:', error);
        }
    }, CAPTURE_INTERVAL);

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
    }
});

// Observe for dynamically added video elements
const observer = new MutationObserver((mutations) => {
    const now = Date.now();
    if (now - lastVideoCheck < VIDEO_CHECK_INTERVAL) return;
    lastVideoCheck = now;

    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.tagName === 'VIDEO') {
                debugLog('New video element detected', node);
                if (isCapturing) {
                    video = node;
                    highlightVideo(video);
                }
            }
        }
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Initial video check
video = findVideo();
if (video) {
    debugLog('Found active video element', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime
    });
} 