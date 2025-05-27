FROM node:22

# Install system dependencies including FFmpeg
RUN apt-get update && \
    apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json . 

RUN npm install 

COPY . .

EXPOSE 4001

CMD ["npm", "start"]