# HallFlix: one image, run as either the site ("server") or the video converter ("transcoder").
FROM node:22-bookworm-slim

# ffmpeg for playback, poppler for PDF pages, libarchive (bsdtar) for CBR/CB7 comics, plus Intel graphics drivers so the UGREEN's chip can do the video conversion.
RUN sed -i 's/^Components: main$/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates poppler-utils libarchive-tools \
 && (apt-get install -y --no-install-recommends intel-media-va-driver-non-free || echo "Intel driver not available on this platform; software conversion only") \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json* server/
RUN cd server && npm install --omit=dev && npm cache clean --force
COPY server/src server/src
COPY web web

ENV NODE_ENV=production DATA_DIR=/data MEDIA_ROOT=/media TRANSCODE_DIR=/transcode PORT=8780
EXPOSE 8780
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.argv[1]==='t'?8781+'/status':process.env.PORT+'/api/boot')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "server/src/main.js"]
CMD ["server"]
