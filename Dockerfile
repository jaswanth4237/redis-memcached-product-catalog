FROM node:20-alpine

WORKDIR /app

# Install curl for health check
RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install --only=production

COPY src/ src/
COPY scripts/ scripts/
COPY .env.example .env.example
COPY .env .env

EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["node", "src/index.js"]
