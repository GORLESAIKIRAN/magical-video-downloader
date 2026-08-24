let toastTimer;

function showToast(message, duration = 3500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status');
    const state = await response.json();
    const ready = state.ready && state.audioReady;
    document.getElementById('status-label').textContent = ready ? 'Ready' : 'Setup required';
    document.getElementById('status-detail').textContent = ready ? '\\u2022 yt-dlp \\u2022 FFmpeg' : '\\u2022 Check downloader tools';
    document.getElementById('status').classList.toggle('warning', !ready);
  } catch {
    document.getElementById('status-label').textContent = 'Offline';
    document.getElementById('status').classList.add('warning');
  }
}

function getFilename(response) {
  const header = response.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match ? match[1] : 'download';
}

async function download(url, mode, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing...';
  try {
    const response = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, mode })
    });
    if (!response.ok) {
      let message = 'Download failed.';
      try {
        const error = await response.json();
        message = error.details ? `${error.error} ${error.details}` : error.error || message;
      } catch {
        // Keep the generic message when the server response is not JSON.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = getFilename(response);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60 * 1000);
    showToast('Download complete.', 5000);
  } catch (error) {
    showToast(error.message || 'Download failed.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-mode]');
  if (!button) return;
  const input = button.parentElement.querySelector('input');
  const url = input.value.trim();
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
  } catch {
    showToast('Paste a valid public http or https video URL.');
    input.focus();
    return;
  }
  download(url, button.dataset.mode, button);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('input')) event.target.parentElement.querySelector('button').click();
});

refreshStatus();
