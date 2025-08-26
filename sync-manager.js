// Supabase Sync Manager - Fixed for Bakken-v2
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
            
            // Setup or get tournament
            await this.setupTournament();
            
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
        this.updateStatus('offline-only');
    }

    async setupTournament() {
        try {
            let tournamentId = localStorage.getItem('bakken-tournament-id');
            
            if (!tournamentId) {
                console.log('🏆 Creating new tournament...');
                
                const { data, error } = await this.supabase
                    .from('tournaments')
                    .insert([{
                        name: `Bakken ${new Date().getFullYear()}`,
                        description: 'Håndæg og Håndbajere Tournament',
                        status: 'active'
                    }])
                    .select()
                    .single();

                if (error) {
                    console.error('❌ Tournament creation failed:', error);
                    throw error;
                }

                tournamentId = data.id;
                localStorage.setItem('bakken-tournament-id', tournamentId);
                console.log('✅ Created tournament:', tournamentId);
            } else {
                console.log('✅ Using existing tournament:', tournamentId);
                
                // Verify tournament exists
                const { data, error } = await this.supabase
                    .from('tournaments')
                    .select('id, name, status')
                    .eq('id', tournamentId)
                    .single();
                
                if (error || !data) {
                    console.warn('⚠️ Tournament not found, creating new one');
                    localStorage.removeItem('bakken-tournament-id');
                    return this.setupTournament(); // Recursive call to create new
                }
                
                console.log('✅ Tournament verified:', data.name);
            }

            this.tournamentId = tournamentId;
        } catch (error) {
            console.error('❌ Tournament setup failed:', error);
            throw error;
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

    getStatus() {
        return {
            online: this.isOnline,
            initialized: this.isInitialized,
            tournamentId: this.tournamentId,
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

// Debug function
window.testSync = function() {
    console.log('🧪 Testing sync connection...');
    if (window.syncManager) {
        console.log('Sync Status:', window.syncManager.getStatus());
        console.log('Tournament ID:', window.syncManager.tournamentId);
        console.log('Supabase Client:', !!window.syncManager.supabase);
        console.log('Is Online:', window.syncManager.isOnline);
        console.log('Is Initialized:', window.syncManager.isInitialized);
    } else {
        console.log('❌ SyncManager not found');
    }
};