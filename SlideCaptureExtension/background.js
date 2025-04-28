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
    chrome.runtime.sendMessage(message).catch(() => { });
}

// Get the active tab
async function getActiveTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        debugLog('Found tabs:', tabs);
        if (tabs && tabs.length > 0) {
            return tabs[0];
        }
        debugLog('No active tabs found');
        return null;
    } catch (error) {
        debugLog('Error getting active tab:', error);
        return null;
    }
}

// Send message to content script
function sendToContent(tabId, message) {
    debugLog('Sending message to content script', { tabId, message });
    chrome.tabs.sendMessage(tabId, message)
        .catch(error => {
            debugLog('Error sending to content:', error);
            // Try to inject content script if it doesn't exist
            if (error.message.includes('Receiving end does not exist')) {
                debugLog('Attempting to inject content script');
                chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['phash.js', 'content.js']
                }).then(() => {
                    debugLog('Content script injected successfully');
                    // Retry sending the message
                    chrome.tabs.sendMessage(tabId, message)
                        .then(() => {
                            debugLog('Message sent successfully after injection');
                        })
                        .catch(retryError => {
                            debugLog('Error after injection:', retryError);
                        });
                }).catch(injectError => {
                    debugLog('Error injecting content script:', injectError);
                });
            }
        });
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    debugLog('Background script received message', message);

    switch (message.type) {
        case 'START_CAPTURE':
            if (isCapturing) {
                debugLog('Already capturing');
                sendResponse({ success: false, error: 'Already capturing' });
                return;
            }

            // Use the tabId from the popup message
            if (message.tabId) {
                activeTabId = message.tabId;
                debugLog('Starting capture on tab', {
                    tabId: activeTabId
                });
                isCapturing = true;
                sendToContent(activeTabId, { type: 'START_CAPTURE' });
                sendToPopup({ type: 'CAPTURE_STATE_CHANGED', isCapturing: true });
                sendResponse({ success: true });
            } else {
                debugLog('No tabId provided');
                sendResponse({ success: false, error: 'No tabId provided' });
            }
            break;

        case 'STOP_CAPTURE':
            if (!isCapturing) {
                debugLog('Not capturing');
                sendResponse({ success: false, error: 'Not capturing' });
                return;
            }
            isCapturing = false;
            if (activeTabId) {
                debugLog('Stopping capture on tab', activeTabId);
                sendToContent(activeTabId, { type: 'STOP_CAPTURE' });
            }
            sendToPopup({ type: 'CAPTURE_STATE_CHANGED', isCapturing: false });
            sendResponse({ success: true });
            break;

        case 'GET_FRAMES':
            debugLog('Sending frames to popup', { count: capturedFrames.length });
            sendResponse({ frames: capturedFrames });
            break;

        case 'GET_CAPTURE_STATE':
            debugLog('Sending capture state', { isCapturing });
            sendResponse({ isCapturing });
            break;

        case 'FRAME_CAPTURED':
            capturedFrames.push(message.data);
            debugLog('Frame captured', {
                totalFrames: capturedFrames.length,
                timestamp: message.data.timestamp
            });
            sendToPopup({ type: 'FRAME_CAPTURED' });
            break;

        case 'DEBUG_LOG':
            debugLog(message.message, message.data);
            break;
    }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeTabId && changeInfo.status === 'complete') {
        // Tab was reloaded, reinject content script if capturing
        if (isCapturing) {
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['phash.js', 'content.js']
            }).then(() => {
                debugLog('Content script reinjected after reload');
                sendToContent(tabId, { type: 'START_CAPTURE' });
            }).catch(error => {
                debugLog('Error reinjecting content script:', error);
            });
        }
    }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
        isCapturing = false;
        activeTabId = null;
        sendToPopup({ type: 'CAPTURE_STATE_CHANGED', isCapturing: false });
    }
});

// Track active tab
chrome.tabs.onActivated.addListener((activeInfo) => {
    activeTabId = activeInfo.tabId;
    debugLog('Active tab changed', activeInfo);
});

// Initialize active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs.length > 0) {
        activeTabId = tabs[0].id;
        debugLog('Initialized active tab', {
            tabId: activeTabId,
            url: tabs[0].url,
            title: tabs[0].title
        });
    }
}); 