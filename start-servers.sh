#!/bin/bash

# Start the CORS proxy server in background
echo "Starting CORS proxy server on port 3001..."
node proxy-server.js &
PROXY_PID=$!

# Wait a moment for proxy to start
sleep 2

# Start the HTTP server for the web app
echo "Starting web server on port 8000..."
echo "CORS proxy PID: $PROXY_PID"
echo ""
echo "🚀 Servers started!"
echo "📝 Web app: http://localhost:8000"
echo "🔗 Debug tool: http://localhost:8000/debug.html"
echo "🌐 CORS proxy: http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all servers"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "Stopping servers..."
    kill $PROXY_PID 2>/dev/null
    exit 0
}

# Set trap to cleanup on exit
trap cleanup INT TERM

# Start the HTTP server (this will run in foreground)
python3 -m http.server 8000

