// Content script that runs in all frames
let video = null;
let isCapturing = false;
let captureInterval = null;
let lastFrameData = null;
let lastVideoCheck = 0;
const VIDEO_CHECK_INTERVAL = 1000; // Check for video every second
const CAPTURE_INTERVAL = 1000; // Capture every second
const MIN_SIMILARITY_THRESHOLD = 0.95; // Minimum similarity to consider frames different

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[AACR Extension] ${message}`;
    console.log(logMessage, data || '');
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', message, data }).catch(() => { });
}

// Create a thumbnail of the video frame
function createThumbnail(canvas, video) {
    const ctx = canvas.getContext('2d');
    const scale = 0.1; // Create a small thumbnail (10% of original size)

    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
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
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
        if (v.readyState >= 3 && v.videoWidth > 0 && v.videoHeight > 0) {
            return v;
        }
    }
    return null;
}

// Start capturing frames
function startCapture() {
    if (isCapturing) return;

    video = findVideo();
    if (!video) {
        debugLog('No suitable video element found');
        return;
    }

    isCapturing = true;
    const canvas = document.createElement('canvas');
    lastFrameData = null;

    captureInterval = setInterval(() => {
        if (!video || video.readyState < 3) {
            video = findVideo();
            if (!video) {
                debugLog('Video element lost');
                stopCapture();
                return;
            }
        }

        try {
            // Create thumbnail and calculate hash
            const thumbnail = createThumbnail(canvas, video);
            const currentHash = calculatePHash(thumbnail);

            // Check if this frame is different from the last one
            if (lastFrameData) {
                const similarity = calculateSimilarity(currentHash, lastFrameData.hash);
                if (similarity > MIN_SIMILARITY_THRESHOLD) {
                    return; // Skip similar frames
                }
            }

            // Capture the full resolution frame
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Store frame data and send to background
            const imageData = canvas.toDataURL('image/webp', 0.8);
            lastFrameData = {
                hash: currentHash,
                timestamp: Date.now()
            };

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

    if (captureInterval) {
        clearInterval(captureInterval);
        captureInterval = null;
    }

    isCapturing = false;
    lastFrameData = null;
    debugLog('Stopped capturing frames');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog('Received message', message);

    switch (message.type) {
        case 'START_CAPTURE':
            startCapture();
            break;
        case 'STOP_CAPTURE':
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