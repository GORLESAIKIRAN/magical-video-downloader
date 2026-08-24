FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-pip python3-venv unzip && python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -U yt-dlp && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV PYTHONIOENCODING=utf-8
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV PATH="/opt/venv/bin:${PATH}"
EXPOSE 3000
CMD ["node", "server.js"]

