// Supabase Sync Manager - Enhanced with Fixed Tournament ID
class SyncManager {
    constructor() {
        this.supabaseUrl = 'https://vpcfvjztjfggzsabidzr.supabase.co';
        this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwY2Z2anp0amZnZ3pzYWJpZHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4NzIxMzksImV4cCI6MjA3MTQ0ODEzOX0.gXNuQntHbt1QrZyMX1ihVHZeK0Qu_O3XleuWnqh5EPY';
        this.supabase = null;
        this.tournamentId = null;
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.isInitialized = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.initTimeout = null;
        
        // FIXED TOURNAMENT ID - SAME FOR ALL DEVICES
        this.FIXED_TOURNAMENT_ID = 'bakken-2025-haandaeg-tournament';
        
        console.log('🔧 SyncManager constructor called');
        
        // Start initialization immediately
        this.init();
    }

    async init() {
        try {
            console.log('🔄 Starting sync initialization...');
            
            // Set timeout for initialization
            this.initTimeout = setTimeout(() => {
                console.log('⏰ Sync initialization timeout');
                this.fallbackToOfflineMode();
            }, 10000);
            
            // Wait for Supabase library to load
            let attempts = 0;
            while (typeof window.supabase === 'undefined' && attempts < 20) {
                console.log(`⏳ Waiting for Supabase library... (${attempts + 1}/20)`);
                await new Promise(resolve => setTimeout(resolve, 500));
                attempts++;
            }
            
            if (typeof window.supabase === 'undefined') {
                console.error('❌ Supabase library failed to load');
                this.fallbackToOfflineMode();
                return;
            }

            console.log('✅ Supabase library loaded');

            // Initialize Supabase client
            this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
            console.log('✅ Supabase client created');
            
            // Test connection with simple query
            console.log('🧪 Testing database connection...');
            const { data, error } = await Promise.race([
                this.supabase.from('tournaments').select('id').limit(1),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), 8000)
                )
            ]);
            
            if (error) {
                console.error('❌ Database connection failed:', error);
                this.fallbackToOfflineMode();
                return;
            }
            
            console.log('✅ Database connection successful');
            
            // Setup fixed tournament
            await this.setupFixedTournament();
            
            // Setup realtime if available
            this.setupRealtimeSubscriptions();
            
            // Setup offline handling
            this.setupOfflineHandling();
            
            // Mark as initialized
            clearTimeout(this.initTimeout);
            this.isInitialized = true;
            
            console.log('🚀 Sync Manager fully initialized');
            this.updateStatus('connected');
            
        } catch (error) {
            console.error('❌ Sync initialization error:', error);
            this.fallbackToOfflineMode();
        }
    }

    fallbackToOfflineMode() {
        console.log('📱 Falling back to offline-only mode');
        clearTimeout(this.initTimeout);
        this.isInitialized = true;
        
        // Still set the fixed tournament ID for offline mode
        this.tournamentId = this.FIXED_TOURNAMENT_ID;
        localStorage.setItem('bakken-tournament-id', this.FIXED_TOURNAMENT_ID);
        
        this.updateStatus('offline-only');
    }

    async setupFixedTournament() {
        try {
            console.log('🏆 Setting up FIXED tournament for ALL devices...');
            console.log('🔗 Fixed Tournament ID:', this.FIXED_TOURNAMENT_ID);
            
            // FORCE the same tournament ID on ALL devices
            localStorage.setItem('bakken-tournament-id', this.FIXED_TOURNAMENT_ID);
            this.tournamentId = this.FIXED_TOURNAMENT_ID;
            
            // Check if tournament exists in database
            const { data, error } = await this.supabase
                .from('tournaments')
                .select('id, name, status')
                .eq('id', this.FIXED_TOURNAMENT_ID)
                .single();
            
            if (error || !data) {
                console.log('🏆 Creating fixed tournament in database...');
                
                // Create the tournament with fixed ID
                const { error: insertError } = await this.supabase
                    .from('tournaments')
                    .insert([{
                        id: this.FIXED_TOURNAMENT_ID,
                        name: `Bakken ${new Date().getFullYear()} - Håndæg og Håndbajere`,
                        description: 'Fixed Tournament ID for all devices',
                        status: 'active',
                        settings: {
                            fixed_tournament: true,
                            created_by: 'system',
                            device_sync: true
                        }
                    }]);
                
                if (insertError) {
                    // Check if it's a duplicate key error (tournament already exists)
                    if (insertError.message && insertError.message.includes('duplicate')) {
                        console.log('✅ Fixed tournament already exists (duplicate key)');
                    } else {
                        console.error('❌ Tournament creation failed:', insertError);
                        throw insertError;
                    }
                } else {
                    console.log('✅ Fixed tournament created successfully');
                }
            } else {
                console.log('✅ Fixed tournament verified:', data.name);
            }
            
            // Show success message
            this.showMessage('🔗 Using shared tournament ID', '#4ECDC4');
            
        } catch (error) {
            console.error('❌ Fixed tournament setup failed:', error);
            
            // Even if database fails, use the fixed ID locally
            this.tournamentId = this.FIXED_TOURNAMENT_ID;
            localStorage.setItem('bakken-tournament-id', this.FIXED_TOURNAMENT_ID);
            
            console.log('📱 Using fixed tournament ID offline');
        }
    }

    setupRealtimeSubscriptions() {
        if (!this.supabase || !this.tournamentId) {
            console.log('⚠️ Cannot setup realtime - missing supabase or tournament ID');
            return;
        }

        try {
            console.log('📡 Setting up realtime subscriptions...');
            
            this.supabase
                .channel(`tournament-${this.tournamentId}`)
                .on('postgres_changes', 
                    { 
                        event: '*', 
                        schema: 'public', 
                        table: 'players', 
                        filter: `tournament_id=eq.${this.tournamentId}` 
                    },
                    (payload) => this.handleRealtimeUpdate('players', payload)
                )
                .on('postgres_changes', 
                    { 
                        event: '*', 
                        schema: 'public', 
                        table: 'teams', 
                        filter: `tournament_id=eq.${this.tournamentId}` 
                    },
                    (payload) => this.handleRealtimeUpdate('teams', payload)
                )
                .on('postgres_changes', 
                    { 
                        event: '*', 
                        schema: 'public', 
                        table: 'games', 
                        filter: `tournament_id=eq.${this.tournamentId}` 
                    },
                    (payload) => this.handleRealtimeUpdate('games', payload)
                )
                .subscribe((status) => {
                    console.log('📡 Realtime subscription status:', status);
                });
                
        } catch (error) {
            console.error('❌ Realtime setup failed:', error);
        }
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => {
            console.log('🌐 Back online');
            this.isOnline = true;
            this.syncPendingChanges();
            this.showMessage('🌐 Back online', '#4ECDC4');
            this.updateStatus('online');
        });

        window.addEventListener('offline', () => {
            console.log('📱 Gone offline');
            this.isOnline = false;
            this.showMessage('📱 Offline mode', '#FF9A42');
            this.updateStatus('offline');
        });
    }

    updateStatus(status) {
        console.log('📊 Status update:', status);
        window.dispatchEvent(new CustomEvent('sync-status-changed', { 
            detail: { status, manager: this } 
        }));
    }

    handleRealtimeUpdate(table, payload) {
        console.log(`🔄 Realtime update for ${table}:`, payload);
        this.triggerUIUpdate(table);
    }

    async syncPlayers(players) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            console.log('📝 Queuing players for sync (offline or not ready)');
            this.queueForSync('players', players);
            return;
        }

        try {
            console.log('☁️ Syncing players to cloud:', players.length);
            
            // Delete existing players for this tournament
            const { error: deleteError } = await this.supabase
                .from('players')
                .delete()
                .eq('tournament_id', this.tournamentId);
            
            if (deleteError) {
                console.error('❌ Failed to delete existing players:', deleteError);
            }

            // Insert new players if any
            if (players.length > 0) {
                const playersWithTournament = players.map(player => ({
                    id: player.id,
                    name: player.name,
                    tournament_id: this.tournamentId
                }));

                const { error: insertError } = await this.supabase
                    .from('players')
                    .insert(playersWithTournament);
                
                if (insertError) {
                    console.error('❌ Failed to insert players:', insertError);
                    throw insertError;
                }
            }

            console.log('✅ Players synced successfully');
            this.showSyncMessage('Players synced');
            
        } catch (error) {
            console.error('❌ Player sync failed:', error);
            this.queueForSync('players', players);
        }
    }

    async syncTeams(teamsData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            console.log('📝 Queuing teams for sync (offline or not ready)');
            this.queueForSync('teams', teamsData);
            return;
        }

        try {
            console.log('☁️ Syncing teams to cloud');
            
            // Delete existing teams for this tournament
            await this.supabase
                .from('teams')
                .delete()
                .eq('tournament_id', this.tournamentId);

            // Insert new teams data
            const { error } = await this.supabase
                .from('teams')
                .insert([{
                    tournament_id: this.tournamentId,
                    teams_data: teamsData.teams || teamsData,
                    team_names: teamsData.teamNames || []
                }]);

            if (error) throw error;

            console.log('✅ Teams synced successfully');
            this.showSyncMessage('Teams synced');
            
        } catch (error) {
            console.error('❌ Teams sync failed:', error);
            this.queueForSync('teams', teamsData);
        }
    }

    async syncGames(gamesData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            console.log('📝 Queuing games for sync (offline or not ready)');
            this.queueForSync('games', gamesData);
            return;
        }

        try {
            console.log('☁️ Syncing games to cloud');
            
            // Delete existing games for this tournament
            await this.supabase
                .from('games')
                .delete()
                .eq('tournament_id', this.tournamentId);

            // Insert new games data
            const { error } = await this.supabase
                .from('games')
                .insert([{
                    tournament_id: this.tournamentId,
                    games_data: gamesData.games || gamesData,
                    game_counter: gamesData.gameCounter || 1
                }]);

            if (error) throw error;

            console.log('✅ Games synced successfully');
            this.showSyncMessage('Games synced');
            
        } catch (error) {
            console.error('❌ Games sync failed:', error);
            this.queueForSync('games', gamesData);
        }
    }

    queueForSync(type, data) {
        // Remove existing item of same type
        this.syncQueue = this.syncQueue.filter(item => item.type !== type);
        
        // Add new item
        this.syncQueue.push({ 
            type, 
            data, 
            timestamp: Date.now() 
        });
        
        console.log(`📝 Queued ${type} for sync (queue size: ${this.syncQueue.length})`);
        this.updateStatus('pending-sync');
    }

    async syncPendingChanges() {
        if (!this.isOnline || this.syncQueue.length === 0) {
            return;
        }

        console.log(`🔄 Syncing ${this.syncQueue.length} pending changes...`);

        // Process queue
        for (const item of [...this.syncQueue]) {
            try {
                switch (item.type) {
                    case 'players':
                        await this.syncPlayers(item.data);
                        break;
                    case 'teams':
                        await this.syncTeams(item.data);
                        break;
                    case 'games':
                        await this.syncGames(item.data);
                        break;
                }
                
                // Remove successfully synced item
                this.syncQueue = this.syncQueue.filter(i => i !== item);
                
            } catch (error) {
                console.error(`❌ Failed to sync ${item.type}:`, error);
                // Keep item in queue for retry
            }
        }

        if (this.syncQueue.length === 0) {
            this.updateStatus('connected');
        }
    }

    triggerUIUpdate(table) {
        window.dispatchEvent(new CustomEvent('bakken-data-updated', { 
            detail: { table, source: 'remote' } 
        }));
    }

    showMessage(message, color = '#4ECDC4') {
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${color};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 3000;
            animation: slideInRight 0.3s ease;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            max-width: 300px;
            font-size: 0.9rem;
        `;
        messageDiv.textContent = message;
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.remove();
            }
        }, 3000);
    }

    showSyncMessage(message) {
        this.showMessage(`☁️ ${message}`, '#4ECDC4');
    }

    async initialize() {
        // For compatibility - always resolves
        return Promise.resolve();
    }

    async loadFromCloud() {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            console.log('📱 Cannot load from cloud - offline or not ready');
            return null;
        }

        try {
            console.log('📥 Loading data from cloud...');
            
            const [playersResult, teamsResult, gamesResult] = await Promise.all([
                this.supabase
                    .from('players')
                    .select('*')
                    .eq('tournament_id', this.tournamentId),
                this.supabase
                    .from('teams')
                    .select('*')
                    .eq('tournament_id', this.tournamentId)
                    .order('updated_at', { ascending: false })
                    .limit(1),
                this.supabase
                    .from('games')
                    .select('*')
                    .eq('tournament_id', this.tournamentId)
                    .order('updated_at', { ascending: false })
                    .limit(1)
            ]);

            const cloudData = {
                players: playersResult.data || [],
                teams: teamsResult.data?.[0] || null,
                games: gamesResult.data?.[0] || null
            };

            console.log('✅ Loaded data from cloud:', {
                players: cloudData.players.length,
                teams: cloudData.teams ? 'yes' : 'no',
                games: cloudData.games ? 'yes' : 'no'
            });
            
            return cloudData;
            
        } catch (error) {
            console.error('❌ Error loading from cloud:', error);
            return null;
        }
    }

    // ENHANCED MULTI-DEVICE SYNC FUNCTIONS
    async forceSyncFromMaster(masterDeviceData) {
        try {
            console.log('🔄 Force syncing from master device...');
            
            // Always use the fixed tournament ID
            localStorage.setItem('bakken-tournament-id', this.FIXED_TOURNAMENT_ID);
            this.tournamentId = this.FIXED_TOURNAMENT_ID;
            
            // Sync players
            if (masterDeviceData.players) {
                localStorage.setItem('bakken-players', JSON.stringify(masterDeviceData.players));
                await this.syncPlayers(masterDeviceData.players);
            }
            
            // Sync teams
            if (masterDeviceData.teams) {
                localStorage.setItem('bakken-teams', JSON.stringify(masterDeviceData.teams));
                await this.syncTeams(masterDeviceData.teams);
            }
            
            // Sync games
            if (masterDeviceData.games) {
                localStorage.setItem('bakken-games', JSON.stringify(masterDeviceData.games));
                await this.syncGames(masterDeviceData.games);
            }
            
            console.log('✅ Force sync completed');
            this.showMessage('🔄 Data synced from master device', '#4ECDC4');
            
            // Reload page to show new data
            setTimeout(() => {
                location.reload();
            }, 1000);
            
        } catch (error) {
            console.error('❌ Force sync failed:', error);
            this.showMessage('❌ Sync failed', '#FF6B6B');
        }
    }

    async resetAndSync() {
        try {
            console.log('🔄 Resetting device and syncing...');
            
            // Clear local data but keep the fixed tournament ID
            localStorage.removeItem('bakken-players');
            localStorage.removeItem('bakken-teams');
            localStorage.removeItem('bakken-games');
            
            // Ensure fixed tournament ID is set
            localStorage.setItem('bakken-tournament-id', this.FIXED_TOURNAMENT_ID);
            this.tournamentId = this.FIXED_TOURNAMENT_ID;
            
            this.showMessage('🔄 Clearing local data...', '#FF9A42');
            
            // Load fresh data from cloud
            const cloudData = await this.loadFromCloud();
            if (cloudData) {
                if (cloudData.players && cloudData.players.length > 0) {
                    localStorage.setItem('bakken-players', JSON.stringify(cloudData.players));
                    console.log('✅ Restored players from cloud:', cloudData.players.length);
                }
                if (cloudData.teams && cloudData.teams.teams_data) {
                    const teamsData = {
                        teams: cloudData.teams.teams_data,
                        teamNames: cloudData.teams.team_names || []
                    };
                    localStorage.setItem('bakken-teams', JSON.stringify(teamsData));
                    console.log('✅ Restored teams from cloud');
                }
                if (cloudData.games && cloudData.games.games_data) {
                    const gamesData = {
                        games: cloudData.games.games_data
                    };
                    localStorage.setItem('bakken-games', JSON.stringify(gamesData));
                    console.log('✅ Restored games from cloud');
                }
            }
            
            this.showMessage('✅ Device reset and synced', '#4ECDC4');
            
            setTimeout(() => {
                location.reload();
            }, 1500);
            
        } catch (error) {
            console.error('❌ Reset and sync failed:', error);
            this.showMessage('❌ Reset failed', '#FF6B6B');
        }
    }

    async getDeviceInfo() {
        const tournamentId = localStorage.getItem('bakken-tournament-id');
        const players = JSON.parse(localStorage.getItem('bakken-players') || '[]');
        const teams = JSON.parse(localStorage.getItem('bakken-teams') || '{}');
        const games = JSON.parse(localStorage.getItem('bakken-games') || '{}');
        
        return {
            tournamentId,
            fixedTournamentId: this.FIXED_TOURNAMENT_ID,
            isUsingFixedId: tournamentId === this.FIXED_TOURNAMENT_ID,
            players,
            teams,
            games,
            deviceType: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
            isOnline: this.isOnline,
            isInitialized: this.isInitialized,
            hasSupabase: !!this.supabase
        };
    }

    getStatus() {
        return {
            online: this.isOnline,
            initialized: this.isInitialized,
            tournamentId: this.tournamentId,
            fixedTournamentId: this.FIXED_TOURNAMENT_ID,
            isUsingFixedId: this.tournamentId === this.FIXED_TOURNAMENT_ID,
            pendingSync: this.syncQueue.length,
            hasSupabase: !!this.supabase
        };
    }
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to { opacity: 1; transform: translateX(0); }
    }
`;
document.head.appendChild(style);

// Initialize sync manager
console.log('🚀 Creating SyncManager instance...');
window.syncManager = new SyncManager();

// Enhanced debug functions
window.testSync = function() {
    console.log('🧪 Testing sync connection...');
    if (window.syncManager) {
        const status = window.syncManager.getStatus();
        console.log('Sync Status:', status);
        console.log('Tournament ID:', window.syncManager.tournamentId);
        console.log('Fixed Tournament ID:', window.syncManager.FIXED_TOURNAMENT_ID);
        console.log('Using Fixed ID:', status.isUsingFixedId);
        console.log('Supabase Client:', !!window.syncManager.supabase);
        console.log('Is Online:', window.syncManager.isOnline);
        console.log('Is Initialized:', window.syncManager.isInitialized);
    } else {
        console.log('❌ SyncManager not found');
    }
};

window.getDeviceInfo = async function() {
    if (window.syncManager) {
        const info = await window.syncManager.getDeviceInfo();
        console.log('📱 Device Info:', info);
        return info;
    }
    return null;
};

window.resetDevice = function() {
    if (window.syncManager) {
        window.syncManager.resetAndSync();
    }
};

window.forceSync = function() {
    if (window.syncManager) {
        window.syncManager.syncPendingChanges();
    }
};

window.checkTournamentId = function() {
    const currentId = localStorage.getItem('bakken-tournament-id');
    const fixedId = window.syncManager ? window.syncManager.FIXED_TOURNAMENT_ID : 'bakken-2025-haandaeg-tournament';
    
    console.log('🔍 Tournament ID Check:');
    console.log('Current ID:', currentId);
    console.log('Fixed ID:', fixedId);
    console.log('Match:', currentId === fixedId);
    
    if (currentId !== fixedId) {
        console.log('⚠️ Tournament ID mismatch - fixing...');
        localStorage.setItem('bakken-tournament-id', fixedId);
        if (window.syncManager) {
            window.syncManager.tournamentId = fixedId;
        }
        console.log('✅ Tournament ID fixed');
    }
    
    return { currentId, fixedId, match: currentId === fixedId };
};