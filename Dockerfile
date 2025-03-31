FROM nginx:alpine

# Copy the static files
COPY . /usr/share/nginx/html/

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Expose the port
EXPOSE 8080

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
