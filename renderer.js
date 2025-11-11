const { ipcRenderer } = require('electron');

let videoStream = null;
let captureCount = 0;
let printCount = 0;
let selectedPrinter = null;
let selectedCamera = null;
let availableCameras = [];
let isPaused = false;

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const printerSelect = document.getElementById('printer-select');
const cameraSelect = document.getElementById('camera-select');
const manualPrinterInput = document.getElementById('manual-printer');
const refreshPrintersBtn = document.getElementById('refresh-printers-btn');
const useManualPrinterBtn = document.getElementById('use-manual-printer-btn');
const statusDiv = document.getElementById('status');
const captureCountDiv = document.getElementById('capture-count');
const printCountDiv = document.getElementById('print-count');
const currentPrinterDiv = document.getElementById('current-printer');
const currentCameraDiv = document.getElementById('current-camera');
const readyBadge = document.getElementById('ready-badge');
const pauseBtn = document.getElementById('pause-btn');
const pauseIcon = document.getElementById('pause-icon');
const pauseText = document.getElementById('pause-text');

const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');
const changeSettingsBtn = document.getElementById('change-settings-btn');
const applySettingsBtn = document.getElementById('apply-settings-btn');
const cancelSettingsBtn = document.getElementById('cancel-settings-btn');

// Get available cameras
async function getCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter(device => device.kind === 'videoinput');
    
    cameraSelect.innerHTML = '';
    availableCameras.forEach((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.deviceId;
      option.textContent = camera.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    if (availableCameras.length > 0) {
      cameraSelect.value = selectedCamera || availableCameras[0].deviceId;
    }
  } catch (error) {
    updateStatus(`Error loading cameras: ${error.message}`, 'error');
  }
}

// Initialize webcam with selected camera
async function initWebcam(deviceId = null) {
  try {
    // Stop existing stream
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }

    updateStatus('Requesting camera access...', 'active');
    
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
    }

    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = videoStream;
    
    // Get camera name after stream is created
    const tracks = videoStream.getVideoTracks();
    if (tracks.length > 0) {
      selectedCamera = tracks[0].getSettings().deviceId;
      const cameraLabel = tracks[0].label || 'Default Camera';
      currentCameraDiv.textContent = cameraLabel;
    }

    updateReadyStatus();
  } catch (error) {
    updateStatus(`Camera error: ${error.message}`, 'error');
  }
}

// Load available printers
async function loadPrinters() {
  try {
    const printers = await ipcRenderer.invoke('get-printers');
    printerSelect.innerHTML = '<option value="">-- Select a printer --</option>';
    
    if (printers.length === 0) {
      printerSelect.innerHTML += '<option value="" disabled>No printers detected - use manual entry below</option>';
    }
    
    printers.forEach(printer => {
      const option = document.createElement('option');
      option.value = printer.name;
      option.textContent = `${printer.name}${printer.isDefault ? ' (Default)' : ''}`;
      printerSelect.appendChild(option);
    });

    if (selectedPrinter) {
      printerSelect.value = selectedPrinter;
    }
  } catch (error) {
    updateStatus(`Error loading printers: ${error.message}`, 'error');
  }
}

// Refresh printers
refreshPrintersBtn.addEventListener('click', async () => {
  updateStatus('Refreshing printer list...', 'active');
  await loadPrinters();
  updateStatus('Printer list refreshed', 'active');
});

// Use manual printer
useManualPrinterBtn.addEventListener('click', () => {
  const manualPrinter = manualPrinterInput.value.trim();
  if (manualPrinter) {
    printerSelect.innerHTML = `<option value="${manualPrinter}" selected>${manualPrinter} (Manual Entry)</option>` + printerSelect.innerHTML;
    printerSelect.value = manualPrinter;
    updateStatus(`Manual printer "${manualPrinter}" added to list`, 'active');
  } else {
    updateStatus('Please enter a printer name', 'warning');
  }
});

// Pause/Resume toggle
pauseBtn.addEventListener('click', () => {
  isPaused = !isPaused;
  
  if (isPaused) {
    pauseIcon.textContent = '▶️';
    pauseText.textContent = 'Resume';
    pauseBtn.classList.add('paused');
    updateStatus('⏸ Printing paused. Click Resume to continue.', 'warning');
  } else {
    pauseIcon.textContent = '⏸';
    pauseText.textContent = 'Pause';
    pauseBtn.classList.remove('paused');
    updateStatus('✓ System ready! Click anywhere to capture & print.', 'active');
  }
});

// Show settings view
changeSettingsBtn.addEventListener('click', () => {
  mainView.style.display = 'none';
  settingsView.style.display = 'block';
  loadPrinters();
  getCameras();
});

// Apply settings
applySettingsBtn.addEventListener('click', async () => {
  const newPrinter = printerSelect.value;
  const newCamera = cameraSelect.value;

  if (!newPrinter) {
    updateStatus('Please select a printer', 'warning');
    return;
  }

  selectedPrinter = newPrinter;
  ipcRenderer.send('set-printer', selectedPrinter);
  currentPrinterDiv.textContent = selectedPrinter;

  if (newCamera && newCamera !== selectedCamera) {
    await initWebcam(newCamera);
  }

  mainView.style.display = 'grid';
  settingsView.style.display = 'none';
  
  updateReadyStatus();
  updateStatus('Settings applied! Click anywhere to capture & print.', 'active');
});

// Cancel settings
cancelSettingsBtn.addEventListener('click', () => {
  mainView.style.display = 'grid';
  settingsView.style.display = 'none';
  
  if (selectedPrinter) {
    updateStatus('Ready! Click anywhere to capture & print.', 'active');
  } else {
    updateStatus('Please configure printer in settings', 'warning');
  }
});

// Update ready status badge
function updateReadyStatus() {
  if (selectedPrinter && videoStream) {
    readyBadge.textContent = 'Ready';
    readyBadge.classList.remove('inactive');
    updateStatus('✓ System ready! Click anywhere to capture & print.', 'active');
  } else {
    readyBadge.textContent = 'Not Ready';
    readyBadge.classList.add('inactive');
    if (!selectedPrinter) {
      updateStatus('Please configure printer in settings', 'warning');
    }
  }
}

// Capture and print
async function captureAndPrint() {
  if (isPaused) {
    updateStatus('⏸ Printing is paused. Click Resume to continue.', 'warning');
    return;
  }

  if (!videoStream) {
    updateStatus('Camera not ready', 'error');
    return;
  }

  if (!selectedPrinter) {
    updateStatus('No printer selected. Configure in settings.', 'error');
    return;
  }

  try {
    updateStatus('📸 Capturing photo...', 'active');

    // Scale to 35%
    const scale = 0.35;
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    canvas.width = width;
    canvas.height = height;

    // Ensure a white background (avoid tinted prints from transparency)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    ctx.drawImage(video, 0, 0, width, height);

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
      data[i + 3] = 255; // opaque
    }
    ctx.putImageData(imageData, 0, 0);

    const imageDataUrl = canvas.toDataURL('image/png');

    captureCount++;
    captureCountDiv.textContent = captureCount;

    updateStatus('🖨 Sending to printer...', 'active');

    const result = await ipcRenderer.invoke('print-image-native', imageDataUrl, {
      deviceName: selectedPrinter,
      jobTitle: 'AsiaHCP Photo'
    });

    if (result.success) {
      printCount++;
      printCountDiv.textContent = printCount;
      updateStatus('✓ Photo printed successfully! Click for next capture.', 'active');
    } else {
      updateStatus(`Print failed: ${result.error}`, 'error');
    }
  } catch (error) {
    updateStatus(`Error: ${error.message}`, 'error');
  }
}


// Global click handler for capture with 15s cooldown
let lastClickTime = 0;
const CLICK_COOLDOWN = 15000; // 15 seconds in milliseconds

document.addEventListener('click', (e) => {
  // Ignore clicks in settings view
  if (settingsView.style.display === 'block') {
    return;
  }
  
  // Ignore clicks on the pause button and settings button
  if (e.target.closest('#pause-btn') || 
      e.target.closest('#change-settings-btn')) {
    return;
  }
  
  // Check cooldown
  const now = Date.now();
  if (now - lastClickTime < CLICK_COOLDOWN) {
    console.log(`Please wait ${Math.ceil((CLICK_COOLDOWN - (now - lastClickTime)) / 1000)}s before next capture`);
    return;
  }
  
  // Trigger capture on any other click
  if (selectedPrinter && videoStream && !isPaused) {
    captureAndPrint();
    lastClickTime = now; // Update last click time only on successful capture
  }
});

// Listen for capture command from main process (backup)
ipcRenderer.on('capture-and-print', () => {
  captureAndPrint();
});

// Listen for show settings command from main process
ipcRenderer.on('show-settings', () => {
  if (mainView.style.display !== 'none') {
    changeSettingsBtn.click();
  }
});

// Update status display
function updateStatus(message, type = '') {
  statusDiv.textContent = message;
  statusDiv.className = 'status';
  if (type) {
    statusDiv.classList.add(type);
  }
}

// Initialize on load
async function initialize() {
  await initWebcam();
  await getCameras();
  await loadPrinters();
  updateReadyStatus();
}

initialize();