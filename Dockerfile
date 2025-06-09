FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget && \
    rm -rf /var/lib/apt/lists/*

# Create app directory structure
WORKDIR /app
RUN mkdir -p /app/uploads /app/tmp /app/output && \
    chown -R node:node /app

# Copy package files first
COPY --chown=node:node package*.json ./

# Install dependencies while skipping youtube-dl-exec postinstall
USER node
RUN npm install --ignore-scripts && \
    npm rebuild youtube-dl-exec && \
    npm run prepare --if-present

# Alternative: Install youtube-dl directly
# RUN wget https://yt-dl.org/downloads/latest/youtube-dl -O /usr/local/bin/youtube-dl && \
#     chmod a+rx /usr/local/bin/youtube-dl

# Copy application files
COPY --chown=node:node . .

# Environment variables
ENV UPLOADS_DIR=/app/uploads \
    TEMP_DIR=/app/tmp \
    OUTPUT_DIR=/app/output \
    NODE_ENV=production

EXPOSE 4001

CMD ["npm", "start"]