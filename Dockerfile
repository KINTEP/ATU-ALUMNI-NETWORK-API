# Dockerfile
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./

RUN npm ci --only=production

# Bundle app source
COPY . .

# Expose port
EXPOSE 8080

# Start the application
CMD [ "node", "src/index.js" ]

