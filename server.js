// ------------------------------
// SERVER SETUP
// ------------------------------
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// ------------------------------
// GAME CONSTANTS
// ------------------------------
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const PLAYER_RADIUS = 10;
const PLAYER_MAX_HP = 100;

// -- Physics & Combat --
const PLAYER_SPEED = 2;
const DASH_SPEED = 8;
const DASH_DURATION = 0.2; // seconds
const DASH_COOLDOWN = 3;   // seconds

const BULLET_SPEED = 7;
const BULLET_RADIUS = 3;
const GUN_DAMAGE = 10;
const GUN_COOLDOWN = 0.3; // seconds

const MELEE_DAMAGE = 25;
const MELEE_RANGE = 25;    // pixels
const MELEE_ARC = Math.PI / 2; // 90-degree arc
const MELEE_COOLDOWN = 0.8; // seconds

const TICK_RATE = 1000 / 60; // 60 updates per second

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
    
    let playerUpdates = {}; // The "delta" for player states

    // 1. Update Cooldowns and States
    for (const id in gameState.players) {
        const player = gameState.players[id];
        let stateChanged = false;

        // Tick down cooldowns
        if (player.dashCooldown > 0) player.dashCooldown -= (TICK_RATE / 1000);
        if (player.gunCooldown > 0) player.gunCooldown -= (TICK_RATE / 1000);
        if (player.meleeCooldown > 0) player.meleeCooldown -= (TICK_RATE / 1000);

        // Update dash state
        if (player.isDashing) {
            player.dashTimer -= (TICK_RATE / 1000);
            if (player.dashTimer <= 0) {
                player.isDashing = false;
                stateChanged = true;
            }
        }
        
        // 2. Update Player Positions
        const currentSpeed = player.isDashing ? DASH_SPEED : PLAYER_SPEED;
        const inputs = player.inputs;
        let hasMoved = false;

        if (inputs.w) { player.y -= currentSpeed; hasMoved = true; }
        if (inputs.s) { player.y += currentSpeed; hasMoved = true; }
        if (inputs.a) { player.x -= currentSpeed; hasMoved = true; }
        if (inputs.d) { player.x += currentSpeed; hasMoved = true; }

        if (hasMoved) {
            player.x = Math.max(0 + PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, player.x));
            player.y = Math.max(0 + PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.y));
        }

        // Add to delta if moved, changed state, or has active cooldowns
        if (hasMoved || stateChanged || player.isDashing || 
            player.dashCooldown > 0 || player.gunCooldown > 0 || player.meleeCooldown > 0) {
            playerUpdates[id] = player;
        }
    }

    // 3. Update Bullet Positions & Check Hits
    let removedBullets = []; 
    for (const id in gameState.bullets) {
        const bullet = gameState.bullets[id];
        bullet.x += bullet.dx * BULLET_SPEED;
        bullet.y += bullet.dy * BULLET_SPEED;

        // Check map boundary
        if (bullet.x < 0 || bullet.x > MAP_WIDTH || bullet.y < 0 || bullet.y > MAP_HEIGHT) {
            removedBullets.push(id);
            continue;
        }

        // Check collision with players
        for (const playerId in gameState.players) {
            const player = gameState.players[playerId];
            if (bullet.ownerId === playerId) continue; // Don't shoot self

            const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.y - player.y) ** 2);
            if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
                player.hp -= GUN_DAMAGE;
                removedBullets.push(id); 

                if (player.hp <= 0) {
                    // Player died - reset them
                    player.hp = PLAYER_MAX_HP;
                    player.x = MAP_WIDTH / 2 + (Math.random() - 0.5) * 100;
                    player.y = MAP_HEIGHT / 2 + (Math.random() - 0.5) * 100;
                }
                
                playerUpdates[playerId] = player; // Add to delta
                break; 
            }
        }
    }
    for (const id of removedBullets) {
        delete gameState.bullets[id];
    }

    // 4. Construct and broadcast the delta
    const delta = {
        updates: playerUpdates,  
        new: newPlayers,           
        removed: removedPlayers,   
        bullets: gameState.bullets // Bullets are simple, send all
    };
    io.emit('stateUpdate', delta);
    
    newPlayers = {};
    removedPlayers = [];
}

// ------------------------------
// SOCKET.IO HANDLING
// ------------------------------
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    const newPlayer = {
        id: socket.id,
        x: MAP_WIDTH / 2, 
        y: MAP_HEIGHT / 2,
        targetX: MAP_WIDTH / 2, // Mouse position
        targetY: MAP_HEIGHT / 2,
        color: Math.floor(Math.random() * 0xffffff),
        hp: PLAYER_MAX_HP,
        maxHp: PLAYER_MAX_HP,
        inputs: { w: false, a: false, s: false, d: false },
        isDashing: false,
        dashTimer: 0,
        dashCooldown: 0,
        gunCooldown: 0,
        meleeCooldown: 0
    };
    
    gameState.players[socket.id] = newPlayer;

    // Send the new player their ID AND the *entire* list of players
    socket.emit('init', { 
        id: socket.id, 
        existingPlayers: gameState.players 
    });
    
    // Tell all *other* players that this player joined
    newPlayers[socket.id] = newPlayer;

    // Handle player movement
    socket.on('inputs', (inputs) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.inputs = inputs;
        }
    });

    // Handle mouse direction (for facing)
    socket.on('mouse_move', (data) => {
        const player = gameState.players[socket.id];
        if (player) {
            player.targetX = data.x;
            player.targetY = data.y;
        }
    });

    // Handle Dash Ability
    socket.on('dash', () => {
        const player = gameState.players[socket.id];
        if (player && player.dashCooldown <= 0) {
            player.isDashing = true;
            player.dashTimer = DASH_DURATION;
            player.dashCooldown = DASH_COOLDOWN;
            // Add to delta so client sees state change
            playerUpdates[player.id] = player; 
        }
    });

    // Handle all attacks (Gun, Sword, etc.)
    socket.on('attack', (attackData) => {
        const player = gameState.players[socket.id];
        if (!player) return;

        if (attackData.type === 'gun' && player.gunCooldown <= 0) {
            player.gunCooldown = GUN_COOLDOWN;
            
            const dx = attackData.targetX - player.x;
            const dy = attackData.targetY - player.y;
            const mag = Math.sqrt(dx * dx + dy * dy);
            
            const bullet = {
                id: bulletIdCounter++,
                ownerId: socket.id,
                x: player.x, 
                y: player.y,
                dx: dx / mag,
                dy: dy / mag,
                color: player.color
            };
            gameState.bullets[bullet.id] = bullet;
        }

        if (attackData.type === 'sword' && player.meleeCooldown <= 0) {
            player.meleeCooldown = MELEE_COOLDOWN;
            
            // Get player's facing angle
            const faceDX = player.targetX - player.x;
            const faceDY = player.targetY - player.y;
            const faceAngle = Math.atan2(faceDY, faceDX);

            // Check for hits
            for (const id in gameState.players) {
                if (id === socket.id) continue; // Can't hit self
                
                const target = gameState.players[id];
                const dist = Math.sqrt((target.x - player.x)**2 + (target.y - player.y)**2);

                if (dist < (PLAYER_RADIUS + MELEE_RANGE)) {
                    // Check if target is in the attack arc
                    const angleToTarget = Math.atan2(target.y - player.y, target.x - player.x);
                    let angleDiff = faceAngle - angleToTarget;
                    
                    // Normalize angle diff
                    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

                    if (Math.abs(angleDiff) < MELEE_ARC / 2) {
                        // HIT!
                        target.hp -= MELEE_DAMAGE;
                        if (target.hp <= 0) {
                            target.hp = PLAYER_MAX_HP;
                            target.x = MAP_WIDTH / 2;
                            target.y = MAP_HEIGHT / 2;
                        }
                        playerUpdates[id] = target; // Add to delta
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        removedPlayers.push(socket.id);
        delete gameState.players[socket.id];
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    setInterval(gameLoop, TICK_RATE);
});