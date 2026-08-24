const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, 'public');
const tempDir = path.join(__dirname, 'tmp');
const modes = new Set(['youtube-video', 'youtube-audio', 'insta-video', 'insta-audio']);

fs.mkdirSync(tempDir, { recursive: true });
for (const file of fs.readdirSync(tempDir)) fs.rmSync(path.join(tempDir, file), { force: true });

function findInstalledBinary(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const roots = process.platform === 'win32'
    ? [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    : ['/usr/local/bin', '/usr/bin'];
  for (const root of roots.filter(Boolean)) {
    if (!fs.existsSync(root)) continue;
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      let entries;
      try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === executable.toLowerCase()) return fullPath;
        if (entry.isDirectory() && !entry.name.startsWith('.')) pending.push(fullPath);
      }
    }
  }
  return name;
}

const ffmpegCommand = findInstalledBinary('ffmpeg');
const denoCommand = findInstalledBinary('deno');
for (const command of [ffmpegCommand, denoCommand]) {
  if (path.isAbsolute(command)) process.env.PATH = `${path.dirname(command)}${path.delimiter}${process.env.PATH || ''}`;
}

function commandAvailable(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', code => resolve(code === 0));
  });
}

const ytDlpReady = commandAvailable('yt-dlp', ['--version']);
const ffmpegReady = commandAvailable(ffmpegCommand, ['-version']);

app.use(express.json({ limit: '10kb' }));
app.use(express.static(publicDir));

app.get('/api/status', async (_req, res) => {
  res.json({ ready: await ytDlpReady, audioReady: await ffmpegReady });
});

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname === 'youtu.be') {
    const videoId = url.pathname.split('/').filter(Boolean)[0];
    if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  }
  if (hostname === 'youtube.com' || hostname === 'm.youtube.com') {
    if (url.pathname.startsWith('/shorts/')) {
      const videoId = url.pathname.split('/').filter(Boolean)[1];
      if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }
    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(url.searchParams.get('v'))}`;
    }
  }
  return url.toString();
}

function sourceMatchesMode(value, mode) {
  const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  if (mode.startsWith('youtube-')) {
    return hostname === 'youtube.com' || hostname === 'm.youtube.com' || hostname === 'youtu.be';
  }
  return hostname === 'instagram.com' || hostname === 'instagram.co';
}

function temporaryBase() {
  return path.join(tempDir, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`);
}

function removeJobFiles(base) {
  const prefix = path.basename(base);
  for (const file of fs.readdirSync(tempDir)) {
    if (file.startsWith(prefix)) fs.rmSync(path.join(tempDir, file), { force: true });
  }
}

function completedFile(base) {
  const prefix = path.basename(base);
  const files = fs.readdirSync(tempDir)
    .filter(file => file.startsWith(prefix) && !file.endsWith('.part') && !file.endsWith('.ytdl'))
    .map(file => path.join(tempDir, file));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

async function downloadMedia(req, res) {
  const source = req.method === 'GET' ? req.query : req.body;
  const url = typeof source?.url === 'string' ? source.url.trim() : '';
  const mode = source?.mode;
  const audio = typeof mode === 'string' && mode.endsWith('audio');

  if (!url) return res.status(400).json({ error: 'Paste a video URL first.' });
  if (!modes.has(mode)) return res.status(400).json({ error: 'Choose a valid download type.' });
  if (!isHttpUrl(url)) return res.status(400).json({ error: 'Use a valid public http or https video URL.' });
  try {
    if (!sourceMatchesMode(url, mode)) {
      const sourceName = mode.startsWith('youtube-') ? 'YouTube' : 'Instagram';
      return res.status(400).json({ error: `Use a ${sourceName} URL in this section.` });
    }
  } catch {
    return res.status(400).json({ error: 'Use a valid public http or https video URL.' });
  }
  let normalizedUrl;
  try {
    normalizedUrl = normalizeUrl(url);
  } catch {
    return res.status(400).json({ error: 'Use a valid public http or https video URL.' });
  }
  if (!(await ytDlpReady)) return res.status(503).json({ error: 'yt-dlp is not installed or unavailable.' });
  if (audio && !(await ffmpegReady)) return res.status(503).json({ error: 'FFmpeg is required for MP3 downloads.' });

  const base = temporaryBase();
  const output = `${base}.%(ext)s`;
  const args = ['--no-playlist', '--restrict-filenames', '--no-warnings', '--socket-timeout', '30', '--extractor-args', 'youtube:player_client=android_vr', '-o', output];
  if (process.env.YOUTUBE_COOKIES_FILE && fs.existsSync(process.env.YOUTUBE_COOKIES_FILE)) {
    args.unshift('--cookies', process.env.YOUTUBE_COOKIES_FILE);
  }
  if (audio) {
    args.unshift('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.unshift('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4');
  }
  args.push(normalizedUrl);

  const child = spawn('yt-dlp', args);
  let errorText = '';
  let finished = false;
  child.stderr.on('data', chunk => { errorText += chunk.toString(); });
  res.on('close', () => {
    if (!finished) {
      child.kill('SIGTERM');
      removeJobFiles(base);
    }
  });

  child.once('error', error => {
    finished = true;
    removeJobFiles(base);
    if (!res.headersSent) res.status(500).json({ error: `Could not start downloader: ${error.message}` });
  });

  child.once('close', code => {
    if (finished) return;
    if (code !== 0) {
      finished = true;
      removeJobFiles(base);
      const botCheck = /sign in to confirm|not a bot|cookies?[- ]from-browser/i.test(errorText);
      const error = botCheck
        ? 'YouTube is requiring verification for this request. Try another public video, or configure YOUTUBE_COOKIES_FILE on the server.'
        : 'This URL could not be downloaded.';
      return res.status(422).json({ error, details: botCheck ? undefined : errorText.slice(-1200) });
    }

    const file = completedFile(base);
    if (!file) {
      finished = true;
      return res.status(500).json({ error: 'Downloader finished without creating a file.' });
    }

    fs.stat(file, (error, stats) => {
      if (error || !stats.isFile()) {
        finished = true;
        removeJobFiles(base);
        return res.status(500).json({ error: 'Downloaded file is unavailable.' });
      }
      const filename = path.basename(file).replace(/[\r\n"\\]/g, '_');
      const extension = path.extname(file).toLowerCase();
      const contentType = extension === '.mp3' ? 'audio/mpeg' : extension === '.mp4' ? 'video/mp4' : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const stream = fs.createReadStream(file);
      stream.once('error', () => { finished = true; removeJobFiles(base); if (!res.headersSent) res.status(500).json({ error: 'Could not read downloaded file.' }); });
      stream.once('close', () => { finished = true; removeJobFiles(base); });
      stream.pipe(res);
    });
  });
}

app.post('/api/download', downloadMedia);
app.get('/api/download', downloadMedia);

app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
