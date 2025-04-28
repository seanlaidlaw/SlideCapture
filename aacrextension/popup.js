let capturedFrames = [];
let isCapturing = false;

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[AACR Popup] ${message}`;
    console.log(logMessage, data || '');
    document.getElementById('status').textContent = message;
}

// Update UI based on current state
function updateUI() {
    const toggleButton = document.getElementById('toggleCapture');
    const downloadButton = document.getElementById('downloadFrames');
    const frameCount = document.getElementById('frameCount');

    // Update toggle button
    toggleButton.textContent = isCapturing ? 'Stop Capture' : 'Start Capture';
    toggleButton.classList.toggle('stopped', isCapturing);

    // Update download button
    downloadButton.disabled = capturedFrames.length === 0;

    // Update frame count
    if (capturedFrames.length > 0) {
        frameCount.textContent = `${capturedFrames.length} frames ready to download`;
    } else {
        frameCount.textContent = '';
    }
}

// Get frames from background script
function getFrames() {
    chrome.runtime.sendMessage({ type: 'GET_FRAMES' }, (response) => {
        if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message !== 'The message port closed before a response was received.') {
                debugLog('Error getting frames:', chrome.runtime.lastError);
            }
            return;
        }
        capturedFrames = response?.frames || [];
        updateUI();
    });
}

// Get current capture state from background
function getCaptureState() {
    chrome.runtime.sendMessage({ type: 'GET_CAPTURE_STATE' }, (response) => {
        if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message !== 'The message port closed before a response was received.') {
                debugLog('Error getting capture state:', chrome.runtime.lastError);
            }
            return;
        }
        isCapturing = response?.isCapturing || false;
        updateUI();
    });
}

// Toggle capture state
document.getElementById('toggleCapture').addEventListener('click', () => {
    const messageType = isCapturing ? 'STOP_CAPTURE' : 'START_CAPTURE';
    debugLog(isCapturing ? 'Stopping capture...' : 'Starting capture...');

    chrome.runtime.sendMessage({ type: messageType }, (response) => {
        if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message !== 'The message port closed before a response was received.') {
                debugLog('Error:', chrome.runtime.lastError);
            }
            return;
        }
        // Update state based on response
        if (response?.success) {
            isCapturing = !isCapturing;
            updateUI();
            debugLog(isCapturing ? 'Capture started' : 'Capture stopped');
        } else {
            debugLog('Failed to ' + (isCapturing ? 'stop' : 'start') + ' capture');
        }
    });
});

document.getElementById('downloadFrames').addEventListener('click', () => {
    getFrames(); // Refresh frames from background

    if (capturedFrames.length === 0) {
        debugLog('No frames captured yet');
        return;
    }

    debugLog(`Preparing to download ${capturedFrames.length} frames`);

    try {
        // Check if JSZip is available
        if (typeof JSZip === 'undefined') {
            console.error('JSZip is undefined');
            throw new Error('JSZip library not loaded. Please reload the extension.');
        }

        // Verify JSZip methods
        if (typeof JSZip.prototype.file !== 'function') {
            console.error('JSZip.file is not a function');
            throw new Error('JSZip library is not properly initialized');
        }

        // Create zip file
        const zip = new JSZip();
        console.log('Created JSZip instance:', zip);

        // Add each frame to the zip
        capturedFrames.forEach((frame, index) => {
            try {
                const base64 = frame.imageData.split(',')[1];
                console.log(`Adding frame ${index + 1}, size: ${base64.length}`);
                zip.file(`frame-${index + 1}.webp`, base64, { base64: true });
            } catch (error) {
                console.error(`Error adding frame ${index + 1}:`, error);
            }
        });

        // Generate and download the zip
        console.log('Generating zip file...');
        zip.generateAsync({ type: 'blob' })
            .then((content) => {
                console.log('Zip generated, size:', content.size);
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'frames.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                debugLog('Download started');
            })
            .catch(error => {
                console.error('Error generating zip:', error);
                debugLog('Error creating zip:', error);
                document.getElementById('error').textContent = `Error creating zip: ${error.message}`;
            });
    } catch (error) {
        console.error('Error in download process:', error);
        debugLog('Error preparing download:', error);
        document.getElementById('error').textContent = `Error: ${error.message}`;
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FRAME_CAPTURED') {
        getFrames(); // Refresh frames from background
    } else if (message.type === 'CAPTURE_STATE_CHANGED') {
        isCapturing = message.isCapturing;
        updateUI();
    }
});

// Initial load
getFrames();
getCaptureState(); 