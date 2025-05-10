**Privacy Policy for SlideCapture Chrome Extension**

*Last updated: May 10, 2025*

Thank you for using SlideCapture (“we,” “us,” or “our”). Your privacy is important to us. This Privacy Policy explains how SlideCapture operates entirely in your browser, does **not** collect any personal or usage data, and how we handle the minimal permissions required for the extension to function.

---

### 1. Information Collection and Use

**SlideCapture does not collect, transmit, or store any user data.**

* All slide-capture processing (frame-grabbing, hashing, and ZIP-file generation) occurs **100% client-side** within your own browser.
* No captured frames, usage metrics, telemetry, error reports, or any other information are ever sent to our servers (or any third party) at any time.

---

### 2. Permissions Explained

To function properly, SlideCapture requests the following Chrome permissions. These are used solely for local operation within your browser and do **not** grant us access to personal data:

* **Active Tab**
  Used to detect and access the video element in the currently viewed tab when you click “Start Capture.”

* **Storage**
  Employed to save your chosen capture settings (crop direction, width/height percentages) and temporarily buffer captured frames before download.

* **Scripting**
  Needed to inject lightweight content scripts that identify and interact with video and canvas elements on the page.

* **Tabs**
  Allows the extension to verify that the active tab contains valid video content and to respond to tab updates (e.g., page navigation).

* **Host Permission** (`*://*/*`)
  Grants the extension the ability to read pixels from any video served over HTTP/HTTPS in the active tab. This is strictly to capture slide images when you click “Start Capture.”

> **Important:** None of these permissions enable the extension to transmit or share your data. They are purely technical enablers for client-side frame capture.

---

### 3. No Third-Party Services or Analytics

* **No Third-Party SDKs:** We do not include any analytics, crash-reporting, or advertising SDKs in SlideCapture.
* **No Telemetry:** We do not collect or send performance metrics, error logs, or usage statistics.

---

### 4. Security

* All processing is sandboxed within your Chrome browser.
* Captured frames reside temporarily in browser memory or local storage only until you choose “Download All Frames,” at which point they are packaged into a ZIP file and downloaded to your device.
* We employ no external servers, APIs, or cloud storage—your slides never leave your computer unless you explicitly share or upload the ZIP file yourself.

---

### 5. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in the extension’s functionality or legal requirements. We will post the revised policy here and update the “Last updated” date at the top. Your continued use of SlideCapture after any change constitutes acceptance of the new policy.
