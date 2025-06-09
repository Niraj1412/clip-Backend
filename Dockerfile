FROM node:22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install ffmpeg-static globally
RUN npm install -g ffmpeg-static

# Create app directory structure with correct permissions
WORKDIR /app
RUN mkdir -p /app/uploads /app/tmp /app/output && \
    chown -R node:node /app

# Copy package files first for better caching
COPY --chown=node:node package*.json ./

# Install dependencies as node user
USER node
RUN npm install

# Copy application files
COPY --chown=node:node . .

# Set environment variables
ENV UPLOADS_DIR=/app/uploads \
    TEMP_DIR=/app/tmp \
    OUTPUT_DIR=/app/output \
    NODE_ENV=production

EXPOSE 4001

CMD ["npm", "start"]