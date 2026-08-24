FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 python3-pip unzip && pip3 install --no-cache-dir yt-dlp && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
