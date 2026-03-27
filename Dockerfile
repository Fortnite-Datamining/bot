FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build
RUN mkdir -p data
CMD ["node", "dist/index.js"]
