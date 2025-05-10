let capturedFrames = [];
let isCapturing = false;
let selectedDirection = 'bottom-right';
let widthPercentage = 100;
let heightPercentage = 100;

// DOM Elements
const startCaptureBtn = document.getElementById('startCapture');
const stopCaptureBtn = document.getElementById('stopCapture');
const downloadAllBtn = document.getElementById('downloadAll');
const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
const advancedOptions = document.getElementById('advancedOptions');
const frameContainer = document.getElementById('frameContainer');
const widthPercentageInput = document.getElementById('widthPercentage');
const heightPercentageInput = document.getElementById('heightPercentage');
const cropDirectionButtons = document.querySelectorAll('.crop-direction button');
const deleteCaptureBtn = document.getElementById('deleteCapture');

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[SlideCapture Popup] ${message}`;
    console.log(logMessage, data || '');
}

// Get the active tab
async function getActiveTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0];
    } catch (error) {
        console.error('Error getting active tab:', error);
        return null;
    }
}

// Update UI based on current state
function updateUI() {
    startCaptureBtn.disabled = isCapturing;
    stopCaptureBtn.disabled = !isCapturing;
    downloadAllBtn.disabled = capturedFrames.length === 0;
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
        displayFrames();
        updateDeleteButtonState();
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings
    chrome.storage.local.get(['cropSettings'], (result) => {
        if (result.cropSettings) {
            selectedDirection = result.cropSettings.direction || 'bottom-right';
            widthPercentage = result.cropSettings.widthPercentage || 100;
            heightPercentage = result.cropSettings.heightPercentage || 100;

            // Update UI
            widthPercentageInput.value = widthPercentage;
            heightPercentageInput.value = heightPercentage;
            updateDirectionButtons();
        }
    });

    // Get initial capture state
    getCaptureState();

    // Get existing frames
    getFrames();
});

// Event Listeners
startCaptureBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) {
        console.error('No active tab found');
        return;
    }

    saveSettings();
    chrome.runtime.sendMessage({
        type: 'START_CAPTURE',
        tabId: tab.id
    }, response => {
        if (response && response.success) {
            isCapturing = true;
            updateUI();
        } else {
            console.error('Failed to start capture:', response?.error);
        }
    });
});

stopCaptureBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' }, (response) => {
        if (response.success) {
            isCapturing = false;
            updateUI();
        }
    });
});

downloadAllBtn.addEventListener('click', downloadAllFrames);

toggleAdvancedBtn.addEventListener('click', () => {
    advancedOptions.classList.toggle('hidden');
    toggleAdvancedBtn.textContent = advancedOptions.classList.contains('hidden')
        ? 'Show Advanced Options'
        : 'Hide Advanced Options';
});

// Crop direction buttons
cropDirectionButtons.forEach(button => {
    button.addEventListener('click', () => {
        selectedDirection = button.dataset.direction;
        updateDirectionButtons();
        saveSettings();
    });
});

// Percentage inputs
widthPercentageInput.addEventListener('change', () => {
    widthPercentage = Math.min(100, Math.max(10, parseInt(widthPercentageInput.value) || 100));
    widthPercentageInput.value = widthPercentage;
    saveSettings();
});

heightPercentageInput.addEventListener('change', () => {
    heightPercentage = Math.min(100, Math.max(10, parseInt(heightPercentageInput.value) || 100));
    heightPercentageInput.value = heightPercentage;
    saveSettings();
});

// Helper Functions
function updateDirectionButtons() {
    cropDirectionButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.direction === selectedDirection);
    });
}

function saveSettings() {
    const settings = {
        direction: selectedDirection,
        widthPercentage,
        heightPercentage
    };
    chrome.storage.local.set({ cropSettings: settings });
}

function displayFrames() {
    frameContainer.innerHTML = '';
    // Create a copy of the frames array and reverse it
    const reversedFrames = [...capturedFrames].reverse();
    reversedFrames.forEach((frame, index) => {
        const frameItem = document.createElement('div');
        frameItem.className = 'frame-item';

        const img = document.createElement('img');
        img.src = frame.imageData;
        img.className = 'frame-preview';

        const timestamp = new Date(frame.timestamp).toLocaleTimeString();
        const info = document.createElement('div');
        info.textContent = `${timestamp} (${frame.width}x${frame.height})`;
        info.style.fontSize = '12px';
        info.style.marginTop = '5px';

        frameItem.appendChild(img);
        frameItem.appendChild(info);
        frameContainer.appendChild(frameItem);
    });
}

function downloadAllFrames() {
    if (capturedFrames.length === 0) return;

    const zip = new JSZip();
    const folder = zip.folder('captured_frames');

    capturedFrames.forEach((frame, index) => {
        const timestamp = new Date(frame.timestamp).toISOString().replace(/[:.]/g, '-');
        const filename = `frame_${timestamp}.webp`;

        // Convert base64 to blob
        const base64Data = frame.imageData.split(',')[1];
        folder.file(filename, base64Data, { base64: true });
    });

    zip.generateAsync({ type: 'blob' })
        .then(content => {
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'captured_frames.zip';
            a.click();
            URL.revokeObjectURL(url);
        });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FRAME_CAPTURED') {
        getFrames(); // Refresh frames from background
    } else if (message.type === 'CAPTURE_STATE_CHANGED') {
        isCapturing = message.isCapturing;
        updateUI();
    }
});

deleteCaptureBtn.addEventListener('click', () => {
    if (deleteCaptureBtn.disabled) return;
    if (confirm('Are you sure you want to delete all captured frames and reset the capture state?')) {
        // Clear storage
        chrome.storage.local.remove(['capturedFrames', 'lastFrameData', 'captureState', 'cropSettings'], () => {
            // Clear in-memory array
            capturedFrames = [];
            // Clear the DOM
            frameContainer.innerHTML = '';
            // Update the delete button state
            updateDeleteButtonState();

            // Reset capture state
            isCapturing = false;
            updateUI();

            // Notify background script to reset its state
            chrome.runtime.sendMessage({ type: 'DELETE_CAPTURE' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Error notifying background script:', chrome.runtime.lastError);
                }
            });

            // Notify content script to reset its state
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'DELETE_CAPTURE' }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('Error notifying content script:', chrome.runtime.lastError);
                        }
                    });
                }
            });

            // Refresh frames to ensure everything is cleared
            getFrames();
        });
    }
});

function updateDeleteButtonState() {
    if (capturedFrames && capturedFrames.length > 0) {
        deleteCaptureBtn.disabled = false;
    } else {
        deleteCaptureBtn.disabled = true;
    }
} 