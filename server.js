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
        origin: "*", // Allow all connections
    }
});

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
const MAP_SIZE = 25; 

// ------------------------------
// GAME STATE
// ------------------------------
let gameState = {
    players: {},
    bullets: {}
};
let bulletIdCounter = 0;

// --- NEW: Delta Update Trackers ---
let newPlayers = {};
let removedPlayers = [];

// ------------------------------
// SERVER GAME LOOP
// ------------------------------
function gameLoop() {
    
    // --- NEW: This object will hold *only* what changed ---
    let playerUpdates = {};

    // 1. Update Player Positions
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const inputs = player.inputs;
        let hasMoved = false;

        if (inputs.w) { player.z -= PLAYER_SPEED; hasMoved = true; }
        if (inputs.s) { player.z += PLAYER_SPEED; hasMoved = true; }
        if (inputs.a) { player.x -= PLAYER_SPEED; hasMoved = true; }
        if (inputs.d) { player.x += PLAYER_SPEED; hasMoved = true; }

        if (hasMoved) {
            // Clamp to map boundaries
            player.x = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, player.x));
            player.z = Math.max(-MAP_SIZE, Math.min(MAP_SIZE, player.z));
            
            // Add to the delta update
            playerUpdates[id] = player;
        }
    }

    // 2. Update Bullet Positions
    let removedBullets = []; // Bullets to remove this frame
    for (const id in gameState.bullets) {
        const bullet = gameState.bullets[id];
        bullet.x += bullet.dx * BULLET_SPEED;
        bullet.z += bullet.dz * BULLET_SPEED;

        // Remove bullets at map edge
        if (bullet.x > MAP_SIZE || bullet.x < -MAP_SIZE || bullet.z > MAP_SIZE || bullet.z < -MAP_SIZE) {
            removedBullets.push(id);
        }
    }

    // 3. Check Collisions
    for (const bulletId in gameState.bullets) {
        if (removedBullets.includes(bulletId)) continue; // Skip bullets already marked for removal

        const bullet = gameState.bullets[bulletId];
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];
            if (bullet.ownerId === playerId) continue;

            const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.z - player.z) ** 2);
            if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
                // Hit!
                player.hp -= BULLET_DAMAGE;
                removedBullets.push(bulletId); // Mark bullet for removal

                if (player.hp <= 0) {
                    // Player died - reset them
                    player.hp = PLAYER_MAX_HP;
                    player.x = (Math.random() - 0.5) * 20;
                    player.z = (Math.random() - 0.5) * 20;
                }
                
                // --- NEW: Add player to delta because their HP changed ---
                playerUpdates[playerId] = player; 
                break; 
            }
        }
    }
    
    // 4. Clean up removed bullets from main state
    for (const id of removedBullets) {
        delete gameState.bullets[id];
    }

    // 5. --- NEW: Construct and broadcast the delta ---
    const delta = {
        updates: playerUpdates,  // Players who moved or took damage
        new: newPlayers,           // Players who just joined
        removed: removedPlayers,   // Players who just left
        bullets: gameState.bullets // Send all bullets (simpler)
    };

    io.emit('stateUpdate', delta);
    
    // --- NEW: Clear the new/removed trackers ---
    newPlayers = {};
    removedPlayers = [];
}

// ------------------------------
// SOCKET.IO HANDLING
// ------------------------------
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Create a new player object
    const newPlayer = {
        id: socket.id,
        x: (Math.random() - 0.5) * 20,
        z: (Math.random() - 0.5) * 20,
        color: Math.random() * 0xffffff,
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        inputs: { w: false, a: false, s: false, d: false }
    };
    
    gameState.players[socket.id] = newPlayer;
    
    // --- NEW: Add to newPlayers list for delta ---
    newPlayers[socket.id] = newPlayer;

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
        if (!player || player.hp <= 0) return;

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
        // Note: The client will receive this in the next `delta.bullets` update
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        
        // --- NEW: Add to removedPlayers list for delta ---
        removedPlayers.push(socket.id);
        delete gameState.players[socket.id];
    });
});

// Start the server and game loop
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    setInterval(gameLoop, 1000 / 60); // 60 updates per second
});