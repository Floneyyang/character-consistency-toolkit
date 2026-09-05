const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const form = document.querySelector('#character-form');
const nameInput = document.querySelector('#character-name');
const outfitInput = document.querySelector('#outfit-direction');
const fileInput = document.querySelector('#reference-image');
const dropZone = document.querySelector('#drop-zone');
const preview = document.querySelector('#reference-preview');
const previewImage = document.querySelector('#preview-image');
const previewName = document.querySelector('#preview-name');
const previewDetails = document.querySelector('#preview-details');
const removeButton = document.querySelector('#remove-image');
const generateButton = document.querySelector('#generate-button');
const configurationNote = document.querySelector('#configuration-note');
const emptyState = document.querySelector('#empty-state');
const loadingState = document.querySelector('#loading-state');
const loadingTitle = document.querySelector('#loading-title');
const resultState = document.querySelector('#result-state');
const resultImage = document.querySelector('#result-image');
const downloadLink = document.querySelector('#download-link');
const animateLink = document.querySelector('#animate-link');
const startOverButton = document.querySelector('#start-over');
const errorState = document.querySelector('#error-state');
const errorMessage = document.querySelector('#error-message');
const tryAgainButton = document.querySelector('#try-again');

let selectedFile = null;
let previewUrl = null;
let loadingMessageTimer = null;
let providerReady = false;

function syncGenerateButton() {
  generateButton.disabled = !selectedFile || !providerReady;
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearPreviewUrl() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

function setOutputState(state) {
  emptyState.hidden = state !== 'empty';
  loadingState.hidden = state !== 'loading';
  resultState.hidden = state !== 'result';
  errorState.hidden = state !== 'error';
}

function showFileError(message) {
  selectedFile = null;
  fileInput.value = '';
  clearPreviewUrl();
  preview.hidden = true;
  syncGenerateButton();
  errorMessage.textContent = message;
  setOutputState('error');
}

function selectFile(file) {
  if (!file || !ALLOWED_TYPES.has(file.type)) {
    showFileError('Choose a PNG, JPEG, or WebP image.');
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showFileError('Choose an image smaller than 15 MB.');
    return;
  }
  selectedFile = file;
  clearPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  previewImage.src = previewUrl;
  previewName.textContent = file.name;
  previewDetails.textContent = formatBytes(file.size);
  preview.hidden = false;
  syncGenerateButton();
  setOutputState('empty');
}

function removeFile() {
  selectedFile = null;
  fileInput.value = '';
  clearPreviewUrl();
  preview.hidden = true;
  syncGenerateButton();
  setOutputState('empty');
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const value = String(reader.result);
      resolve(value.slice(value.indexOf(',') + 1));
    });
    reader.addEventListener('error', () => reject(new Error('The selected image could not be read.')));
    reader.readAsDataURL(file);
  });
}

function beginLoadingMessages() {
  const messages = [
    'Building your identity reference…',
    'Arranging three consistent views…',
    'Finishing your canonical sheet…',
  ];
  let index = 0;
  loadingTitle.textContent = messages[index];
  loadingMessageTimer = window.setInterval(() => {
    index = (index + 1) % messages.length;
    loadingTitle.textContent = messages[index];
  }, 12_000);
}

function endLoadingMessages() {
  if (loadingMessageTimer) window.clearInterval(loadingMessageTimer);
  loadingMessageTimer = null;
}

async function createCharacterSheet(event) {
  event.preventDefault();
  if (!selectedFile) return;
  generateButton.disabled = true;
  setOutputState('loading');
  beginLoadingMessages();
  try {
    const base64 = await fileAsBase64(selectedFile);
    const response = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: nameInput.value.trim() || 'My Character',
        outfitDirection: outfitInput.value.trim(),
        image: { mimeType: selectedFile.type, base64 },
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Character-sheet generation failed.');
    }
    const { character } = payload;
    resultImage.src = character.imageUrl;
    resultImage.alt = `${character.name} canonical three-view character sheet`;
    downloadLink.href = character.imageUrl;
    animateLink.href = `/animate.html?character=${encodeURIComponent(character.id)}`;
    const safeName = character.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadLink.download = `${safeName || 'character'}-sheet.png`;
    setOutputState('result');
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : 'Character-sheet generation failed.';
    setOutputState('error');
  } finally {
    endLoadingMessages();
    syncGenerateButton();
  }
}

fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
removeButton.addEventListener('click', removeFile);
form.addEventListener('submit', createCharacterSheet);
startOverButton.addEventListener('click', removeFile);
tryAgainButton.addEventListener('click', () => setOutputState('empty'));

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragging');
  });
}
dropZone.addEventListener('drop', (event) => selectFile(event.dataTransfer?.files?.[0]));

fetch('/api/health')
  .then((response) => response.json())
  .then((health) => {
    providerReady = health.ready === true;
    configurationNote.hidden = providerReady;
    syncGenerateButton();
  })
  .catch(() => {
    providerReady = false;
    configurationNote.hidden = false;
    syncGenerateButton();
  });

window.addEventListener('beforeunload', clearPreviewUrl);
