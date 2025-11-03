// ------------------------------
// SERVER SETUP
// ------------------------------
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all connections (for simplicity)
    }
});

// Serve the client files (index.html, main.js)
// This part isn't strictly needed if you host on CodeHS, but it's good practice
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// ------------------------------
// GAME CONSTANTS
// ------------------------------
const PLAYER_SPEED = 0.1;
const PLAYER_RADIUS = 0.5;
const PLAYER_MAX_HP = 100;
const BULLET_SPEED = 0.3;
const BULLET_RADIUS = 0.1;
const BULLET_DAMAGE = 10;
const MAP_SIZE = 25; // The plane is 50x50, so 25 is the edge

// ------------------------------
// GAME STATE
// ------------------------------
let gameState = {
    players: {},
    bullets: {}
};
let bulletIdCounter = 0;

// ------------------------------
// SERVER GAME LOOP
// ------------------------------
function gameLoop() {
    // 1. Update Player Positions
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const inputs = player.inputs;

        if (inputs.w) player.z -= PLAYER_SPEED;
        if (inputs.s) player.z += PLAYER_SPEED;
        if (inputs.a) player.x -= PLAYER_SPEED;
        if (inputs.d) player.x += PLAYER_SPEED;

        // Clamp to map boundaries
        player.x = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, player.x));
        player.z = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, player.z));
    }

    // 2. Update Bullet Positions
    for (const id in gameState.bullets) {
        const bullet = gameState.bullets[id];
        bullet.x += bullet.dx * BULLET_SPEED;
        bullet.z += bullet.dz * BULLET_SPEED;

        // Remove bullets at map edge
        if (bullet.x > MAP_SIZE || bullet.x < -MAP_SIZE || bullet.z > MAP_SIZE || bullet.z < -MAP_SIZE) {
            delete gameState.bullets[id];
        }
    }

    // 3. Check Collisions
    for (const bulletId in gameState.bullets) {
        const bullet = gameState.bullets[bulletId];
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];

            // Don't shoot self
            if (bullet.ownerId === playerId) continue;

            // Simple circle collision check
            const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.z - player.z) ** 2);
            if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
                // Hit!
                player.hp -= BULLET_DAMAGE;
                delete gameState.bullets[bulletId]; // Remove bullet

                if (player.hp <= 0) {
                    // Player died - reset them
                    player.hp = PLAYER_MAX_HP;
                    player.x = (Math.random() - 0.5) * 20;
                    player.z = (Math.random() - 0.5) * 20;
                }
                break; // Bullet can only hit one person
            }
        }
    }

    // 4. Broadcast the new state to all clients
    io.emit('stateUpdate', gameState);
}

// ------------------------------
// SOCKET.IO HANDLING
// ------------------------------
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Create a new player object
    gameState.players[socket.id] = {
        id: socket.id,
        x: (Math.random() - 0.5) * 20, // Random start position
        z: (Math.random() - 0.5) * 20,
        color: Math.random() * 0xffffff,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        inputs: { w: false, a: false, s: false, d: false }
    };

    // Send the new player their ID
    socket.emit('init', socket.id);

    // Handle player inputs
    socket.on('inputs', (inputs) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.inputs = inputs;
        }
    });

    // Handle shooting
    socket.on('shoot', (target) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0) return; // Can't shoot if dead or non-existent

        // Calculate direction vector
        const dx = target.x - player.x;
        const dz = target.z - player.z;
        const mag = Math.sqrt(dx * dx + dz * dz);
        
        const bullet = {
            id: bulletIdCounter++,
            ownerId: socket.id,
            x: player.x,
            z: player.z,
            dx: dx / mag,
            dz: dz / mag,
            color: player.color
        };
        gameState.bullets[bullet.id] = bullet;
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        delete gameState.players[socket.id];
    });
});

// Start the server and game loop
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    setInterval(gameLoop, 1000 / 60); // Run game loop 60 times per second
});