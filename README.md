# Magical Video Downloader

A Node.js web app for downloading public video URLs as MP4 or converting them to MP3.

## Run locally

Install Node.js 20+, `yt-dlp`, and FFmpeg, then run:

```powershell
npm install
npm start
```

Open http://localhost:3000.

The Docker image installs Node, yt-dlp, FFmpeg, and Deno automatically for Render deployment. Only public URLs supported by yt-dlp can be downloaded; private or login-required content is not supported.
