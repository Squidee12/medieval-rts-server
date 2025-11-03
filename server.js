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

const PORT = process.env.PORT || 3000;

// ------------------------------
// GAME CONSTANTS (NEW 2D-friendly values)
// ------------------------------
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PLAYER_SPEED = 3;
const PLAYER_RADIUS = 10;
const PLAYER_MAX_HP = 100;
const BULLET_SPEED = 7;
const BULLET_RADIUS = 3;
const BULLET_DAMAGE = 10;

// ------------------------------
// GAME STATE
// ------------------------------
let gameState = {
    players: {},
    bullets: {}
};
let bulletIdCounter = 0;
let newPlayers = {};
let removedPlayers = [];

// ------------------------------
// SERVER GAME LOOP
// ------------------------------
function gameLoop() {
    
    let playerUpdates = {};

    // 1. Update Player Positions
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const inputs = player.inputs;
        let hasMoved = false;

        if (inputs.w) { player.y -= PLAYER_SPEED; hasMoved = true; }
        if (inputs.s) { player.y += PLAYER_SPEED; hasMoved = true; }
        if (inputs.a) { player.x -= PLAYER_SPEED; hasMoved = true; }
        if (inputs.d) { player.x += PLAYER_SPEED; hasMoved = true; }

        if (hasMoved) {
            player.x = Math.max(0 + PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, player.x));
            player.y = Math.max(0 + PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.y));
            playerUpdates[id] = player;
        }
    }

    // 2. Update Bullet Positions
    let removedBullets = []; 
    for (const id in gameState.bullets) {
        const bullet = gameState.bullets[id];
        bullet.x += bullet.dx * BULLET_SPEED;
        bullet.y += bullet.dy * BULLET_SPEED;

        if (bullet.x < 0 || bullet.x > MAP_WIDTH || bullet.y < 0 || bullet.y > MAP_HEIGHT) {
            removedBullets.push(id);
        }
    }

    // 3. Check Collisions
    for (const bulletId in gameState.bullets) {
        if (removedBullets.includes(bulletId)) continue; 

        const bullet = gameState.bullets[bulletId];
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];
            if (bullet.ownerId === playerId) continue;

            const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.y - player.y) ** 2);
            if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
                player.hp -= BULLET_DAMAGE;
                removedBullets.push(bulletId); 

                if (player.hp <= 0) {
                    player.hp = PLAYER_MAX_HP;
                    player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 100;
                    player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 100;
                }
                
                playerUpdates[playerId] = player; 
                break; 
            }
        }
    }
    
    for (const id of removedBullets) {
        delete gameState.bullets[id];
    }

    // 5. Construct and broadcast the delta
    const delta = {
        updates: playerUpdates,  
        new: newPlayers,           
        removed: removedPlayers,   
        bullets: gameState.bullets 
    };

    io.emit('stateUpdate', delta);
    
    newPlayers = {};
    removedPlayers = [];
}

// ------------------------------
// SOCKET.IO HANDLING
// ------------------------------

// --- THIS ENTIRE FUNCTION IS UPDATED ---
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const newPlayer = {
        id: socket.id,
        x: MAP_WIDTH / 2, 
        y: MAP_HEIGHT / 2,
        color: Math.floor(Math.random() * 0xffffff), // Fixed color bug
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        inputs: { w: false, a: false, s: false, d: false }
    };
    
    // 1. Add new player to the main game state *immediately*
    gameState.players[socket.id] = newPlayer;

    // 2. Send the new player their ID AND the *entire* list of players
    //    (including themselves) so they can spawn everyone.
    socket.emit('init', { 
        id: socket.id, 
        existingPlayers: gameState.players 
    });
    
    // 3. Add the player to the 'newPlayers' delta list.
    //    This is so *other* players (who are already connected)
    //    get a 'delta.new' message and spawn this new player.
    newPlayers[socket.id] = newPlayer;

    socket.on('inputs', (inputs) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.inputs = inputs;
        }
    });

    socket.on('shoot', (shootData) => {
        const player = gameState.players[socket.id];
        if (!player || player.hp <= 0) return;

        const startX = shootData.startX;
        const startY = shootData.startY;

        const dx = shootData.targetX - startX;
        const dy = shootData.targetY - startY;
        const mag = Math.sqrt(dx * dx + dy * dy);
        
        const bullet = {
            id: bulletIdCounter++,
            ownerId: socket.id,
            x: startX, 
            y: startY,
            dx: dx / mag,
            dy: dy / mag,
            color: player.color
        };
        gameState.bullets[bullet.id] = bullet;
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        removedPlayers.push(socket.id);
        delete gameState.players[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    setInterval(gameLoop, 1000 / 60); // 60 updates per second
});