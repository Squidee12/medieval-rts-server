const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // allow CodeHS to connect
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

let gameState = { units: {} };

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    gameState.units[socket.id] = [];

    socket.on('initUnits', (units) => {
        gameState.units[socket.id] = units;
        broadcastGameState();
    });

    socket.on('command', (data) => {
        const playerUnits = gameState.units[socket.id];
        if (playerUnits && playerUnits[data.unitIndex]) {
            playerUnits[data.unitIndex].target = data.target;
        }
        broadcastGameState();
    });

    socket.on('disconnect', () => {
        delete gameState.units[socket.id];
        broadcastGameState();
        console.log('Player disconnected:', socket.id);
    });
});

function broadcastGameState() {
    io.emit('stateUpdate', gameState);
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
