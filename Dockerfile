FROM node:22

RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /app/backend/uploads /app/uploads /app/tmp /app/output && \
    chown -R node:node /app/backend/uploads /app/uploads /app/tmp /app/output

USER node

RUN npm install -g ffmpeg-static

WORKDIR /app

COPY package*.json . 

RUN npm install 

COPY . .

ENV UPLOADS_DIR=/app/backend/uploads
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV TEMP_DIR=/app/tmp
ENV OUTPUT_DIR=/app/output

EXPOSE 4001

CMD ["npm", "start"]