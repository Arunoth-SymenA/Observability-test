# Use the official lightweight Node.js image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# Copy the rest of the application files
COPY index.js ./

# Expose port 3001 as requested
EXPOSE 3001

# Command to run the application
CMD [ "npm", "start" ]