// ==================== GAME CONFIGURATION ====================
const CONFIG = {
    MAX_PLAYERS: 10,
    MAP_SIZE: 2000,
    BULLET_SPEED: 15,
    PLAYER_SPEED: 5,
    PLAYER_SIZE: 30,
    FIRE_RATE: 200, // ms
    RELOAD_TIME: 1500, // ms
    MAX_AMMO: 30,
    DAMAGE: 25,
    HEALTH: 100,
    UPDATE_RATE: 60 // updates per second
};

// ==================== GLOBAL VARIABLES ====================
let gameRunning = false;
let isHost = false;
let socket = null;
let localPlayer = null;
let players = new Map();
let bullets = [];
let kills = [];

// Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Input
let moveDirection = { x: 0, y: 0 };
let mouseX = 0, mouseY = 0;
let isShooting = false;
let lastShootTime = 0;
let currentAmmo = CONFIG.MAX_AMMO;
let isReloading = false;

// Camera
let camera = { x: 0, y: 0 };

// Joystick
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
let joystickVector = { x: 0, y: 0 };

// ==================== NETWORKING ====================
class GameNetwork {
    constructor() {
        this.peerConnection = null;
        this.dataChannel = null;
        this.peers = new Map();
        this.signalingServer = null;
    }

    async getLocalIP() {
        return new Promise((resolve) => {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('test');
            pc.createOffer()
                .then(offer => pc.setLocalDescription(offer))
                .catch(console.error);
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    const ipMatch = event.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
                    if (ipMatch) {
                        resolve(ipMatch[0]);
                        pc.close();
                    }
                }
            };
            
            setTimeout(() => {
                resolve('127.0.0.1');
                pc.close();
            }, 2000);
        });
    }

    async createHost(playerName) {
        isHost = true;
        localPlayer = new Player('local', playerName, true);
        localPlayer.isHost = true;
        players.set('local', localPlayer);
        
        // Create WebRTC Data Channel
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        this.dataChannel = this.peerConnection.createDataChannel('game');
        this.setupDataChannel(this.dataChannel);
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE Candidate:', event.candidate);
            }
        };
        
        // Create offer
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        // Store offer to share with clients
        this.hostOffer = offer;
        
        // Start game loop
        startGame();
        
        // Update UI
        document.getElementById('ipDisplay').innerHTML = `<span>📡 Host IP: <span id="localIp">${await this.getLocalIP()}</span></span>`;
        document.getElementById('connectionInfo').classList.remove('hidden');
        document.getElementById('myIpDisplay').textContent = await this.getLocalIP();
        
        return true;
    }

    async joinGame(hostIp, playerName) {
        isHost = false;
        localPlayer = new Player('local', playerName, true);
        players.set('local', localPlayer);
        
        // In a real implementation, you'd connect to a signaling server
        // For this demo, we'll simulate connection
        this.simulateConnection(hostIp);
        
        startGame();
        return true;
    }

    simulateConnection(hostIp) {
        console.log(`Connecting to host at ${hostIp}...`);
        
        // Simulate connection after 1 second
        setTimeout(() => {
            // Add some AI players for demo
            for (let i = 1; i <= 3; i++) {
                const enemy = new Player(`enemy_${i}`, `Enemy ${i}`, false);
                enemy.x = Math.random() * CONFIG.MAP_SIZE;
                enemy.y = Math.random() * CONFIG.MAP_SIZE;
                enemy.isAI = true;
                players.set(`enemy_${i}`, enemy);
            }
            
            document.getElementById('connStatus').innerHTML = '🟢 Connected';
            document.getElementById('connStatus').style.color = '#4caf50';
            
            // Show player list
            updatePlayerList();
        }, 1000);
    }

    setupDataChannel(channel) {
        channel.onopen = () => {
            console.log('Data channel opened');
            this.sendPlayerInfo();
        };
        
        channel.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        channel.onclose = () => {
            console.log('Data channel closed');
        };
    }

    sendPlayerInfo() {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({
                type: 'player_join',
                player: {
                    id: localPlayer.id,
                    name: localPlayer.name,
                    x: localPlayer.x,
                    y: localPlayer.y
                }
            }));
        }
    }

    sendGameState() {
        if (!isHost) return;
        
        const state = {
            type: 'game_state',
            players: Array.from(players.entries()).map(([id, p]) => ({
                id, name: p.name, x: p.x, y: p.y, health: p.health, score: p.score
            })),
            bullets: bullets.map(b => ({ x: b.x, y: b.y, direction: b.direction }))
        };
        
        // Send to all clients (in real implementation)
    }

    handleMessage(data) {
        switch(data.type) {
            case 'player_join':
                const newPlayer = new Player(data.player.id, data.player.name, false);
                newPlayer.x = data.player.x;
                newPlayer.y = data.player.y;
                players.set(data.player.id, newPlayer);
                updatePlayerList();
                break;
                
            case 'player_move':
                const player = players.get(data.id);
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                    player.angle = data.angle;
                }
                break;
                
            case 'player_shoot':
                addBullet(data.x, data.y, data.direction, data.id);
                break;
                
            case 'player_damage':
                const target = players.get(data.targetId);
                if (target) {
                    target.health -= data.damage;
                    if (target.health <= 0) {
                        addKill(data.shooterName, target.name);
                        players.delete(data.targetId);
                    }
                }
                break;
        }
    }
}

// ==================== PLAYER CLASS ====================
class Player {
    constructor(id, name, isLocal = false) {
        this.id = id;
        this.name = name;
        this.isLocal = isLocal;
        this.x = Math.random() * CONFIG.MAP_SIZE;
        this.y = Math.random() * CONFIG.MAP_SIZE;
        this.angle = 0;
        this.health = CONFIG.HEALTH;
        this.score = 0;
        this.speed = CONFIG.PLAYER_SPEED;
        this.isAI = false;
    }

    update() {
        if (this.isLocal) {
            // Update position based on move direction
            if (moveDirection.x !== 0 || moveDirection.y !== 0) {
                const len = Math.hypot(moveDirection.x, moveDirection.y);
                this.x += (moveDirection.x / len) * this.speed;
                this.y += (moveDirection.y / len) * this.speed;
                
                // Boundary check
                this.x = Math.max(50, Math.min(CONFIG.MAP_SIZE - 50, this.x));
                this.y = Math.max(50, Math.min(CONFIG.MAP_SIZE - 50, this.y));
            }
            
            // Update angle based on mouse/touch
            if (mouseX !== 0 || mouseY !== 0) {
                this.angle = Math.atan2(mouseY - canvas.height/2, mouseX - canvas.width/2);
            }
        } else if (this.isAI) {
            // Simple AI: move towards local player
            const local = players.get('local');
            if (local) {
                const dx = local.x - this.x;
                const dy = local.y - this.y;
                const dist = Math.hypot(dx, dy);
                if (dist > 100) {
                    this.x += (dx / dist) * (this.speed * 0.5);
                    this.y += (dy / dist) * (this.speed * 0.5);
                }
                this.angle = Math.atan2(dy, dx);
            }
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x - camera.x, this.y - camera.y);
        ctx.rotate(this.angle);
        
        // Draw player body
        ctx.fillStyle = this.isLocal ? '#4caf50' : (this.isAI ? '#ff9800' : '#2196f3');
        ctx.beginPath();
        ctx.arc(0, 0, CONFIG.PLAYER_SIZE / 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw gun
        ctx.fillStyle = '#333';
        ctx.fillRect(10, -5, 25, 10);
        
        // Draw health bar
        const healthPercent = this.health / CONFIG.HEALTH;
        ctx.fillStyle = '#ff4444';
        ctx.fillRect(-20, -30, 40, 5);
        ctx.fillStyle = '#4caf50';
        ctx.fillRect(-20, -30, 40 * healthPercent, 5);
        
        // Draw name tag
        ctx.font = '12px monospace';
        ctx.fillStyle = 'white';
        ctx.shadowBlur = 2;
        ctx.fillText(this.name, -20, -35);
        ctx.shadowBlur = 0;
        
        ctx.restore();
    }
}

// ==================== BULLET CLASS ====================
class Bullet {
    constructor(x, y, direction, ownerId) {
        this.x = x;
        this.y = y;
        this.direction = direction;
        this.ownerId = ownerId;
        this.speed = CONFIG.BULLET_SPEED;
        this.life = 100;
    }

    update() {
        this.x += Math.cos(this.direction) * this.speed;
        this.y += Math.sin(this.direction) * this.speed;
        this.life--;
        
        // Check collisions with players
        for (const [id, player] of players) {
            if (id === this.ownerId) continue;
            
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            
            if (dist < CONFIG.PLAYER_SIZE) {
                player.health -= CONFIG.DAMAGE;
                if (player.health <= 0) {
                    const shooter = players.get(this.ownerId);
                    if (shooter) {
                        shooter.score++;
                        addKill(shooter.name, player.name);
                        if (shooter.isLocal) {
                            document.getElementById('scoreValue').textContent = shooter.score;
                        }
                    }
                    players.delete(id);
                }
                return false;
            }
        }
        
        return this.life > 0 && this.x > 0 && this.x < CONFIG.MAP_SIZE && this.y > 0 && this.y < CONFIG.MAP_SIZE;
    }

    draw() {
        ctx.fillStyle = '#ff0';
        ctx.beginPath();
        ctx.arc(this.x - camera.x, this.y - camera.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==================== GAME FUNCTIONS ====================
function startGame() {
    gameRunning = true;
    
    // Hide menu, show HUD
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('connectionInfo').classList.remove('hidden');
    document.getElementById('playerList').classList.remove('hidden');
    document.getElementById('killFeed').classList.remove('hidden');
    document.getElementById('joystickContainer').classList.remove('hidden');
    document.getElementById('actionButtons').classList.remove('hidden');
    
    // Start game loop
    gameLoop();
}

function addBullet(x, y, direction, ownerId) {
    bullets.push(new Bullet(x, y, direction, ownerId));
}

function addKill(killer, victim) {
    kills.unshift({ killer, victim, time: Date.now() });
    
    // Add to kill feed UI
    const killFeed = document.getElementById('killFeed');
    const msg = document.createElement('div');
    msg.className = 'kill-message';
    msg.innerHTML = `<span style="color:#ff9800">${killer}</span> 🔫 <span style="color:#f44336">${victim}</span>`;
    killFeed.insertBefore(msg, killFeed.firstChild);
    
    // Remove old messages
    while (killFeed.children.length > 10) {
        killFeed.removeChild(killFeed.lastChild);
    }
}

function updatePlayerList() {
    const container = document.getElementById('playerListContent');
    container.innerHTML = '';
    
    for (const [id, player] of players) {
        const entry = document.createElement('div');
        entry.className = 'player-entry' + (player.isLocal ? ' player-local' : '');
        entry.innerHTML = `
            <span>${player.name}</span>
            <span>❤️ ${player.health}</span>
            <span>🎯 ${player.score}</span>
        `;
        container.appendChild(entry);
    }
}

function shoot() {
    if (!gameRunning) return;
    if (isReloading) return;
    if (currentAmmo <= 0) {
        reload();
        return;
    }
    
    const now = Date.now();
    if (now - lastShootTime < CONFIG.FIRE_RATE) return;
    
    lastShootTime = now;
    currentAmmo--;
    
    // Update ammo display
    updateAmmoDisplay();
    
    // Create bullet
    const bulletX = localPlayer.x + Math.cos(localPlayer.angle) * CONFIG.PLAYER_SIZE;
    const bulletY = localPlayer.y + Math.sin(localPlayer.angle) * CONFIG.PLAYER_SIZE;
    addBullet(bulletX, bulletY, localPlayer.angle, 'local');
    
    // Muzzle flash effect
    createMuzzleFlash();
}

function reload() {
    if (isReloading) return;
    if (currentAmmo === CONFIG.MAX_AMMO) return;
    
    isReloading = true;
    setTimeout(() => {
        currentAmmo = CONFIG.MAX_AMMO;
        isReloading = false;
        updateAmmoDisplay();
    }, CONFIG.RELOAD_TIME);
}

function updateAmmoDisplay() {
    // You can add ammo display to HUD
}

function createMuzzleFlash() {
    // Visual effect
}

// ==================== CAMERA ====================
function updateCamera() {
    if (localPlayer) {
        camera.x = localPlayer.x - canvas.width / 2;
        camera.y = localPlayer.y - canvas.height / 2;
        
        // Clamp camera to map bounds
        camera.x = Math.max(0, Math.min(CONFIG.MAP_SIZE - canvas.width, camera.x));
        camera.y = Math.max(0, Math.min(CONFIG.MAP_SIZE - canvas.height, camera.y));
    }
}

// ==================== RENDERING ====================
function drawMap() {
    // Draw grid
    const gridSize = 100;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    
    for (let x = startX; x < camera.x + canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x - camera.x, 0);
        ctx.lineTo(x - camera.x, canvas.height);
        ctx.stroke();
    }
    
    for (let y = startY; y < camera.y + canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y - camera.y);
        ctx.lineTo(canvas.width, y - camera.y);
        ctx.stroke();
    }
    
    // Draw obstacles (simple cover points)
    const obstacles = [
        { x: 500, y: 500, w: 80, h: 80 },
        { x: 1200, y: 800, w: 100, h: 100 },
        { x: 800, y: 1500, w: 120, h: 80 },
        { x: 1500, y: 400, w: 80, h: 120 }
    ];
    
    ctx.fillStyle = 'rgba(100, 100, 100, 0.5)';
    for (const obs of obstacles) {
        ctx.fillRect(obs.x - camera.x, obs.y - camera.y, obs.w, obs.h);
    }
}

function drawCrosshair() {
    ctx.save();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.shadowBlur = 0;
    
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX - 15, centerY);
    ctx.lineTo(centerX - 5, centerY);
    ctx.moveTo(centerX + 5, centerY);
    ctx.lineTo(centerX + 15, centerY);
    ctx.moveTo(centerX, centerY - 15);
    ctx.lineTo(centerX, centerY - 5);
    ctx.moveTo(centerX, centerY + 5);
    ctx.lineTo(centerX, centerY + 15);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
}

function gameLoop() {
    if (!gameRunning) return;
    
    // Update
    if (localPlayer) {
        localPlayer.update();
        updateCamera();
        
        // Update all players
        for (const player of players.values()) {
            if (player !== localPlayer) {
                player.update();
            }
        }
        
        // Update bullets
        bullets = bullets.filter(bullet => bullet.update());
        
        // Update health UI
        document.getElementById('healthValue').textContent = localPlayer.health;
        const healthPercent = localPlayer.health / CONFIG.HEALTH;
        document.getElementById('healthFill').style.width = `${healthPercent * 100}px`;
        document.getElementById('healthFill').style.backgroundColor = 
            healthPercent > 0.5 ? '#4caf50' : (healthPercent > 0.2 ? '#ff9800' : '#f44336');
        
        // Update player list
        updatePlayerList();
    }
    
    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMap();
    
    // Draw bullets
    for (const bullet of bullets) {
        bullet.draw();
    }
    
    // Draw players
    for (const player of players.values()) {
        player.draw();
    }
    
    // Draw crosshair
    drawCrosshair();
    
    // Draw ammo info
    ctx.font = '16px monospace';
    ctx.fillStyle = 'white';
    ctx.shadowBlur = 2;
    ctx.fillText(`🔫 ${currentAmmo}/${CONFIG.MAX_AMMO}`, canvas.width - 100, 50);
    if (isReloading) {
        ctx.fillStyle = '#ff9800';
        ctx.fillText('RELOADING...', canvas.width - 150, 80);
    }
    
    requestAnimationFrame(gameLoop);
}

// ==================== INPUT HANDLING ====================
function setupInput() {
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
        switch(e.key) {
            case 'w': case 'ArrowUp': moveDirection.y = -1; break;
            case 's': case 'ArrowDown': moveDirection.y = 1; break;
            case 'a': case 'ArrowLeft': moveDirection.x = -1; break;
            case 'd': case 'ArrowRight': moveDirection.x = 1; break;
            case ' ': case 'Shift': shoot(); e.preventDefault(); break;
            case 'r': reload(); break;
        }
    });
    
    window.addEventListener('keyup', (e) => {
        switch(e.key) {
            case 'w': case 'ArrowUp': if (moveDirection.y === -1) moveDirection.y = 0; break;
            case 's': case 'ArrowDown': if (moveDirection.y === 1) moveDirection.y = 0; break;
            case 'a': case 'ArrowLeft': if (moveDirection.x === -1) moveDirection.x = 0; break;
            case 'd': case 'ArrowRight': if (moveDirection.x === 1) moveDirection.x = 0; break;
        }
    });
    
    // Mouse aim
    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        mouseX = (e.clientX - rect.left) * scaleX;
        mouseY = (e.clientY - rect.top) * scaleY;
    });
    
    canvas.addEventListener('click', () => shoot());
    
    // Touch controls
    const joystickContainer = document.getElementById('joystickContainer');
    const joystickThumb = document.getElementById('joystickThumb');
    
    joystickContainer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        joystickActive = true;
        const rect = joystickContainer.getBoundingClientRect();
        joystickCenter.x = rect.left + rect.width / 2;
        joystickCenter.y = rect.top + rect.height / 2;
    });
    
    joystickContainer.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!joystickActive) return;
        
        const touch = e.touches[0];
        let dx = touch.clientX - joystickCenter.x;
        let dy = touch.clientY - joystickCenter.y;
        const dist = Math.hypot(dx, dy);
        const maxDist = 40;
        
        if (dist > maxDist) {
            dx = dx * maxDist / dist;
            dy = dy * maxDist / dist;
        }
        
        joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
        joystickVector.x = dx / maxDist;
        joystickVector.y = dy / maxDist;
        
        moveDirection.x = joystickVector.x;
        moveDirection.y = joystickVector.y;
    });
    
    joystickContainer.addEventListener('touchend', () => {
        joystickActive = false;
        joystickThumb.style.transform = 'translate(0px, 0px)';
        joystickVector = { x: 0, y: 0 };
        moveDirection = { x: 0, y: 0 };
    });
    
    // Fire button
    document.getElementById('fireBtn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        shoot();
    });
    
    document.getElementById('fireBtn').addEventListener('mousedown', () => shoot());
    
    // Reload button
    document.getElementById('reloadBtn').addEventListener('touchstart', (e) => {
        e.preventDefault();
        reload();
    });
    
    document.getElementById('reloadBtn').addEventListener('mousedown', () => reload());
}

// ==================== UI EVENT HANDLERS ====================
async function init() {
    const network = new GameNetwork();
    
    // Get local IP
    const localIp = await network.getLocalIP();
    document.getElementById('localIp').textContent = localIp;
    
    // Host button
    document.getElementById('hostBtn').addEventListener('click', async () => {
        const playerName = document.getElementById('playerName').value.trim();
        if (!playerName) {
            alert('Please enter your name');
            return;
        }
        await network.createHost(playerName);
    });
    
    // Join button
    document.getElementById('joinBtn').addEventListener('click', () => {
        document.getElementById('joinModal').classList.remove('hidden');
    });
    
    document.getElementById('confirmJoinBtn').addEventListener('click', async () => {
        const hostIp = document.getElementById('hostIpInput').value.trim();
        const playerName = document.getElementById('playerName').value.trim();
        if (!hostIp || !playerName) {
            alert('Please enter host IP and your name');
            return;
        }
        document.getElementById('joinModal').classList.add('hidden');
        await network.joinGame(hostIp, playerName);
    });
    
    document.getElementById('cancelJoinBtn').addEventListener('click', () => {
        document.getElementById('joinModal').classList.add('hidden');
    });
    
    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.remove('hidden');
    });
    
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
        document.getElementById('settingsModal').classList.add('hidden');
    });
    
    // Sensitivity
    document.getElementById('sensitivity').addEventListener('input', (e) => {
        CONFIG.PLAYER_SPEED = 3 + (e.target.value / 10) * 5;
    });
    
    // Graphics quality
    document.getElementById('graphicsQuality').addEventListener('change', (e) => {
        // Apply graphics settings
    });
    
    setupInput();
}

// Start the game
init();
