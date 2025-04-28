// Background script for logging and message handling
let capturedFrames = [];
let isCapturing = false;
let activeTabId = null;

// Debug logging function
function debugLog(message, data = null) {
    const logMessage = `[AACR Extension] ${message}`;
    console.log(logMessage, data || '');
}

// Send message to popup
function sendToPopup(message) {
    chrome.runtime.sendMessage(message).catch(error => {
        debugLog('Error sending to popup:', error);
    });
}

// Send message to content script
function sendToContent(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(error => {
        debugLog('Error sending to content:', error);
    });
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog('Received message', message);

    switch (message.type) {
        case 'START_CAPTURE':
            if (isCapturing) {
                debugLog('Already capturing');
                sendResponse({ success: false, error: 'Already capturing' });
                return;
            }
            isCapturing = true;
            sendToContent(activeTabId, { type: 'START_CAPTURE' });
            sendToPopup({ type: 'CAPTURE_STATE_CHANGED', isCapturing: true });
            sendResponse({ success: true });
            break;

        case 'STOP_CAPTURE':
            if (!isCapturing) {
                debugLog('Not capturing');
                sendResponse({ success: false, error: 'Not capturing' });
                return;
            }
            isCapturing = false;
            sendToContent(activeTabId, { type: 'STOP_CAPTURE' });
            sendToPopup({ type: 'CAPTURE_STATE_CHANGED', isCapturing: false });
            sendResponse({ success: true });
            break;

        case 'GET_FRAMES':
            sendResponse({ frames: capturedFrames });
            break;

        case 'GET_CAPTURE_STATE':
            sendResponse({ isCapturing });
            break;

        case 'FRAME_CAPTURED':
            capturedFrames.push(message.data);
            debugLog('Frame captured. Total frames:', capturedFrames.length);
            sendToPopup({ type: 'FRAME_CAPTURED' });
            break;

        case 'DEBUG_LOG':
            debugLog(message.message, message.data);
            break;
    }

    // Store the active tab ID
    if (sender.tab) {
        activeTabId = sender.tab.id;
    }
});

// Track active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo.tabId;
});

// Initialize active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
        activeTabId = tabs[0].id;
    }
}); 