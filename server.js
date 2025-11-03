const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// --- Game Data ---
const WORDS_LIST = [
    "Dog", "Cat", "Sun", "Tree", "House", "Car", "Bicycle", "Computer",
    "Phone", "Guitar", "Pizza", "Apple", "Banana", "Book", "Chair",
    "Bridge", "Mountain", "River", "Star", "Moon", "Boat", "Train"
];
const ROUND_TIME = 90;
const GET_READY_TIME = 5;
const MAX_ROUNDS = 10;
const HINT_INTERVAL = 30; // <-- NEW: Show hint every 30 seconds

// --- Game State ---
let gameState = {
    players: {},
    currentDrawerId: null,
    currentWord: "",
    wordHint: "", // <-- NEW: The underscore hint string
    timer: ROUND_TIME,
    isRoundActive: false,
    currentRound: 0
};
let gameTimer = null; 

// --- Helper Functions ---

function getNextDrawerId() {
    const playerIds = Object.keys(gameState.players);
    if (playerIds.length === 0) return null;
    if (!gameState.currentDrawerId) return playerIds[0];
    const currentIndex = playerIds.indexOf(gameState.currentDrawerId);
    const nextIndex = (currentIndex + 1) % playerIds.length;
    return playerIds[nextIndex];
}

function endGame() {
    if (gameTimer) clearInterval(gameTimer);
    gameState.isRoundActive = false;
    gameState.currentRound = 0;

    let winner = null;
    let maxScore = -1;
    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (player.score > maxScore) {
            maxScore = player.score;
            winner = player;
        }
        player.score = 0; 
    }

    io.emit('game_over', {
        winnerName: winner ? winner.username : "Everyone",
        score: maxScore
    });
    io.emit('player_list_update', gameState.players);
    
    setTimeout(startNewRound, 10000);
}

// --- NEW: Hint Function ---
function revealHint() {
    if (!gameState.isRoundActive) return;

    // Find an index of a letter that is still an underscore
    const hiddenIndices = [];
    for (let i = 0; i < gameState.wordHint.length; i++) {
        if (gameState.wordHint[i] === '_') {
            hiddenIndices.push(i);
        }
    }

    if (hiddenIndices.length <= 1) return; // Don't reveal the last letter

    const revealIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
    const word = gameState.currentWord;
    
    // Rebuild the hint string
    let hintChars = gameState.wordHint.split(' ');
    hintChars[revealIndex] = word[revealIndex];
    gameState.wordHint = hintChars.join(' ');

    io.emit('word_hint', { underscores: gameState.wordHint });
}


function startNewRound() {
    if (gameTimer) clearInterval(gameTimer);
    
    const playerIds = Object.keys(gameState.players);
    if (playerIds.length < 2) {
        gameState.isRoundActive = false;
        io.emit('game_update', { message: "Waiting for players..." });
        return;
    }

    if (gameState.currentRound >= MAX_ROUNDS) {
        endGame();
        return;
    }
    
    gameState.currentRound++;
    gameState.isRoundActive = false; 
    gameState.currentDrawerId = getNextDrawerId();
    gameState.currentWord = WORDS_LIST[Math.floor(Math.random() * WORDS_LIST.length)];
    gameState.timer = ROUND_TIME;
    gameState.wordHint = gameState.currentWord.replace(/./g, "_"); // <-- NEW
    // Add spaces for display
    gameState.wordHint = gameState.wordHint.split('').join(' ');


    console.log(`Round ${gameState.currentRound}/${MAX_ROUNDS}. Drawer: ${gameState.currentDrawerId}, Word: ${gameState.currentWord}`);

    io.emit('get_ready', { 
        timer: GET_READY_TIME, 
        round: gameState.currentRound,
        maxRounds: MAX_ROUNDS
    });

    setTimeout(() => {
        gameState.isRoundActive = true;
        
        io.emit('new_round', {
            drawerId: gameState.currentDrawerId,
            drawerName: gameState.players[gameState.currentDrawerId].username,
            timer: gameState.timer
        });

        io.to(gameState.currentDrawerId).emit('your_word', {
            word: gameState.currentWord,
            underscores: gameState.wordHint
        });
        
        io.to(gameState.currentDrawerId).broadcast.emit('word_hint', {
            underscores: gameState.wordHint
        });
        
        gameTimer = setInterval(() => {
            gameState.timer--;
            io.emit('timer_update', { timer: gameState.timer });

            // --- NEW: Check if it's time for a hint ---
            if ((ROUND_TIME - gameState.timer) % HINT_INTERVAL === 0 && gameState.timer > 0) {
                revealHint();
            }

            if (gameState.timer <= 0) {
                io.emit('system_message', { 
                    message: `Time's up! The word was "${gameState.currentWord}".`,
                    color: '#FF8C00' 
                });
                startNewRound();
            }
        }, 1000);
    }, GET_READY_TIME * 1000);
}

// --- Socket.IO Handling ---
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    gameState.players[socket.id] = {
        username: `Player ${Math.floor(Math.random() * 1000)}`,
        score: 0
    };
    const newPlayer = gameState.players[socket.id];
    
    socket.emit('init', {
        id: socket.id,
        gameState: gameState 
    });

    io.emit('system_message', { 
        message: `${newPlayer.username} has joined.`,
        color: '#00FF00' 
    });
    io.emit('player_list_update', gameState.players);

    if (Object.keys(gameState.players).length === 2 && !gameState.isRoundActive && gameState.currentRound === 0) {
        startNewRound();
    }

    // Handle player disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
        const player = gameState.players[socket.id];
        if (player) {
            io.emit('system_message', { 
                message: `${player.username} has left.`,
                color: '#FF0000' 
            });
            delete gameState.players[socket.id];
            io.emit('player_list_update', gameState.players);

            if (Object.keys(gameState.players).length < 2) {
                if (gameTimer) clearInterval(gameTimer);
                gameState.isRoundActive = false;
                gameState.currentRound = 0;
                io.emit('game_update', { message: "Waiting for players..." });
            } else if (socket.id === gameState.currentDrawerId) {
                io.emit('system_message', { 
                    message: `The drawer left! Starting a new round.`,
                    color: '#FF8C00' 
                });
                startNewRound();
            }
        }
    });

    // Handle chat messages
    socket.on('chat_message', (data) => {
        const player = gameState.players[socket.id];
        if (!player) return;
        
        if (gameState.isRoundActive && socket.id !== gameState.currentDrawerId &&
            data.message.toLowerCase() === gameState.currentWord.toLowerCase()) {
            
            // --- NEW: Speed-based Scoring ---
            const points = 5 + Math.floor(gameState.timer / (ROUND_TIME / 10)); // Base 5 pts, +10 for fast
            player.score += points;
            gameState.players[gameState.currentDrawerId].score += 5; // Drawer gets 5
            
            io.emit('system_message', { 
                message: `${player.username} guessed the word! (+${points} pts)`,
                color: '#00FFFF' 
            });
            io.emit('player_list_update', gameState.players);
            startNewRound();

        } else {
            io.emit('new_message', {
                username: player.username,
                message: data.message
            });
        }
    });

    // Handle drawing data
    socket.on('draw', (data) => {
        if (socket.id === gameState.currentDrawerId) {
            socket.broadcast.emit('drawing', data);
        }
    });
    
    // Handle clear canvas
    socket.on('clear_canvas', () => {
        if (socket.id === gameState.currentDrawerId) {
            io.emit('clear_canvas');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});