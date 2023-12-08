const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const pingIntervalMs = 30000; // 30 seconds
const maxInactiveTimeMs = 120000; // 2 minutes

// Map to store last activity timestamp for each IP
const lastActivity = new Map();

app.use(helmet());
app.use(bodyParser.json());

// Express rate limiting middleware for /new-print-data endpoint
const limiter = rateLimit({
    windowMs: 60000, // 1 minute
    max: 10, // Limit each IP to 10 requests per minute
});
app.use('/new-print-data', limiter);

// WebSocket handling for local printer clients
wss.on('connection', (socket, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`WebSocket connected from ${ip}`);

    // Set up a periodic ping to keep the connection alive
    const pingInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, pingIntervalMs);

    socket.on('pong', () => {
        // Pong received, update last activity timestamp
        lastActivity.set(ip, Date.now());
    });

    socket.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            const { restID } = parsedMessage;

            if (!restID) {
                console.error(`Error: restID is not provided in the message from ${ip}`);
                return;
            }

            console.log(`Received message from ${ip} with restID: ${restID}`);

            // Set restID on the socket for future reference
            socket.restID = restID;

        } catch (error) {
            console.error('Error parsing JSON:', error);
        }
    });

    socket.on('close', () => {
        console.log(`WebSocket disconnected from ${ip}`);
        clearInterval(pingInterval);
        lastActivity.delete(ip);
    });
});


app.get('/health', (req, res) => {
  res.status(200).json({ message: 'Server is healthy' });
});

// Route for receiving new print data
app.post('/new-print-data', (req, res) => {
    const newPrintData = req.body;

    // Broadcast the new print data to all connected clients with matching restID
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.restID === newPrintData.restID) {
            client.send(JSON.stringify(newPrintData));
            console.log(`Broadcasted new print data to WebSocket client with restID: ${client.restID}`);
        }
    });

    res.status(200).json({ message: 'New print data received and broadcasted.' });
});

// Set up a periodic cleanup to close inactive connections
setInterval(() => {
    const now = Date.now();
    lastActivity.forEach((timestamp, ip) => {
        if (now - timestamp > maxInactiveTimeMs) {
            const socket = [...wss.clients].find((client) => client._socket.remoteAddress === ip);
            if (socket) {
                console.log(`Closing inactive WebSocket connection from ${ip}`);
                socket.terminate();
            }
            lastActivity.delete(ip);
        }
    });
}, 60000); // Cleanup every 1 minute

server.listen(3000, () => {
    console.log('Server listening on port 3000');
});

