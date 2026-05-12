FROM node:18-alpine

WORKDIR /app

ENV PORT=3000

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
