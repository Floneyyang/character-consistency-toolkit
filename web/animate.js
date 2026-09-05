const params = new URLSearchParams(window.location.search);
const characterId = params.get('character');
const canonicalImage = document.querySelector('#canonical-image');
const identityTitle = document.querySelector('#identity-title');
const form = document.querySelector('#animation-form');
const directionInput = document.querySelector('#animation-direction');
const animateButton = document.querySelector('#animate-button');
const configurationNote = document.querySelector('#animation-configuration-note');
const emptyState = document.querySelector('#animation-empty');
const loadingState = document.querySelector('#animation-loading');
const loadingTitle = document.querySelector('#animation-loading-title');
const loadingCopy = document.querySelector('#animation-loading-copy');
const resultState = document.querySelector('#animation-result');
const firstFrame = document.querySelector('#first-frame');
const video = document.querySelector('#animation-video');
const download = document.querySelector('#video-download');
const errorState = document.querySelector('#animation-error');
const errorMessage = document.querySelector('#animation-error-message');
const retry = document.querySelector('#animation-retry');

let providerReady = false;
let characterReady = false;
let activeAnimationId = null;
let pollTimer = null;
let retryMode = 'new';
let submissionsBlocked = false;

function setStage(state) {
  emptyState.hidden = state !== 'empty';
  loadingState.hidden = state !== 'loading';
  resultState.hidden = state !== 'result';
  errorState.hidden = state !== 'error';
}

function syncButton() {
  animateButton.disabled =
    submissionsBlocked || !providerReady || !characterReady || directionInput.value.trim().length < 3;
}

function showError(message, { mode = 'new' } = {}) {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
  errorMessage.textContent = message;
  retryMode = mode;
  submissionsBlocked = mode !== 'new';
  retry.hidden = mode === 'blocked';
  retry.textContent = mode === 'poll' ? 'Check status again' : 'Create a new attempt';
  setStage('error');
  syncButton();
}

async function responseJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'The request failed.');
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function renderAnimation(animation) {
  activeAnimationId = animation.id;
  if (animation.firstFrameUrl) firstFrame.src = animation.firstFrameUrl;
  resultState.hidden = false;
  if (animation.status === 'SUCCEEDED' && animation.videoUrl) {
    submissionsBlocked = false;
    video.src = animation.videoUrl;
    video.hidden = false;
    download.href = animation.videoUrl;
    download.download = 'character-animation.mp4';
    download.hidden = false;
    setStage('result');
    syncButton();
    return true;
  }
  if (animation.status === 'FAILED' || animation.status === 'CANCELED') {
    const moderated = animation.failureCategory === 'moderated';
    showError(
      moderated
        ? 'Runway blocked this animation for safety. The task was preserved and should not be retried unchanged.'
        : 'Runway could not complete this animation. The failed task was preserved and was not retried.',
      { mode: moderated ? 'blocked' : 'new' },
    );
    return true;
  }
  if (['OUTCOME_UNKNOWN', 'CREATING_FRAME', 'SUBMITTING'].includes(animation.status)) {
    showError(
      'This attempt did not reach a confirmed provider state. It was preserved to prevent an accidental duplicate charge.',
      { mode: 'blocked' },
    );
    return true;
  }
  video.hidden = true;
  download.hidden = true;
  submissionsBlocked = true;
  loadingTitle.textContent = 'Animating your character…';
  loadingCopy.textContent = 'Runway is rendering the five-second scene. This page checks the saved task without submitting another charge.';
  setStage('loading');
  return false;
}

async function pollAnimation() {
  if (!activeAnimationId) return;
  try {
    const response = await fetch(
      `/api/characters/${encodeURIComponent(characterId)}/animations/${encodeURIComponent(activeAnimationId)}`,
    );
    const { animation } = await responseJson(response);
    if (!renderAnimation(animation)) {
      pollTimer = window.setTimeout(pollAnimation, 5_000 + Math.floor(Math.random() * 1_000));
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Animation status could not be checked.', {
      mode: 'poll',
    });
  }
}

async function startAnimation(event) {
  event.preventDefault();
  if (animateButton.disabled) return;
  animateButton.disabled = true;
  video.hidden = true;
  download.hidden = true;
  loadingTitle.textContent = 'Creating an identity-locked first frame…';
  loadingCopy.textContent = 'GPT Image is composing one scene from the canonical sheet before Runway receives it.';
  setStage('loading');
  try {
    const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/animations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brief: directionInput.value.trim() }),
    });
    const { animation } = await responseJson(response);
    renderAnimation(animation);
    await pollAnimation();
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Animation generation failed.', {
      mode: error?.code === 'OUTCOME_UNKNOWN' ? 'blocked' : 'new',
    });
  }
}

async function initialize() {
  if (!characterId) {
    showError('Choose a character sheet before opening the animation workspace.');
    return;
  }
  try {
    const [characterResponse, healthResponse] = await Promise.all([
      fetch(`/api/characters/${encodeURIComponent(characterId)}`),
      fetch('/api/animation-health'),
    ]);
    const [{ character }, health] = await Promise.all([
      responseJson(characterResponse),
      responseJson(healthResponse),
    ]);
    canonicalImage.src = character.imageUrl;
    canonicalImage.alt = `${character.name} canonical character sheet`;
    identityTitle.textContent = character.name;
    characterReady = true;
    providerReady = health.ready === true;
    configurationNote.hidden = providerReady;
    const latest = character.animations.findLast(
      (animation) => !['FAILED', 'CANCELED'].includes(animation.status),
    );
    if (latest && !['FAILED', 'CANCELED'].includes(latest.status)) {
      renderAnimation(latest);
      if (latest.status !== 'SUCCEEDED') await pollAnimation();
    }
    syncButton();
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Character could not be loaded.');
  }
}

directionInput.addEventListener('input', syncButton);
form.addEventListener('submit', startAnimation);
retry.addEventListener('click', () => {
  if (retryMode === 'poll') {
    setStage('loading');
    void pollAnimation();
    return;
  }
  activeAnimationId = null;
  submissionsBlocked = false;
  setStage('empty');
  syncButton();
});
window.addEventListener('beforeunload', () => {
  if (pollTimer) window.clearTimeout(pollTimer);
});

void initialize();
