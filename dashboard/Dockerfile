FROM ghcr.io/protomaps/go-pmtiles:v1.31.2 AS pmtiles

# Map glyphs and sprites (Protomaps basemaps-assets), pinned commit, checked archive
FROM node:20.20.2-alpine3.23 AS ressources
ARG ASSETS=028c18f713baecad011301ff7a69acc39bcc2ae7
ARG ASSETS_SHA256=57e40e8c512bd8042d0a3a251f19d0d1c8523ad963c666c3c6643bada4dc92d0
RUN wget -qO /tmp/assets.tgz "https://codeload.github.com/protomaps/basemaps-assets/tar.gz/$ASSETS" \
 && echo "$ASSETS_SHA256  /tmp/assets.tgz" | sha256sum -c - \
 && tar xzf /tmp/assets.tgz -C /tmp \
 && cd "/tmp/basemaps-assets-$ASSETS" \
 && mkdir -p /r/polices /r/sprites \
 && cp -r "fonts/Noto Sans Regular" "fonts/Noto Sans Medium" "fonts/Noto Sans Italic" fonts/OFL.txt /r/polices/ \
 && cp sprites/v4/dark* /r/sprites/

FROM node:20.20.2-alpine3.23 AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
COPY --from=ressources /r ./public/ressources-carte
RUN npm run build

FROM node:20.20.2-alpine3.23
LABEL org.opencontainers.image.source=https://github.com/Gorgo126/ODIN
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Offline, each DNS lookup blocks a libuv thread for seconds; file reads share that pool
ENV UV_THREADPOOL_SIZE=16
COPY --from=pmtiles /go-pmtiles /usr/local/bin/pmtiles
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
