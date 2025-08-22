// Supabase Sync Manager for Bakken App
class SyncManager {
    constructor() {
        this.supabaseUrl = 'https://vpcfvjztjfggzsabidxr.supabase.co';
        this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwY2Z2anp0amZnZ3pzYWJpZHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4NzIxMzksImV4cCI6MjA3MTQ0ODEzOX0.gXNuQntHbt1QrZyMX1ihVHZeK0Qu_O3XleuWnqh5EPY';
        this.supabase = null;
        this.tournamentId = null;
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.isInitialized = false;
        
        this.init();
    }

    async init() {
        try {
            // Initialize Supabase client
            if (typeof window.supabase !== 'undefined') {
                this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
                console.log('✅ Supabase client initialized');
                
                await this.setupTournament();
                this.setupRealtimeSubscriptions();
                this.setupOfflineHandling();
                this.isInitialized = true;
                
                console.log('🚀 Sync Manager fully initialized');
            } else {
                console.warn('⚠️ Supabase not loaded, running in offline mode');
                setTimeout(() => this.init(), 1000); // Retry in 1 second
            }
        } catch (error) {
            console.error('❌ Error initializing Sync Manager:', error);
        }
    }

    async setupTournament() {
        try {
            // Get or create tournament ID
            let tournamentId = localStorage.getItem('bakken-tournament-id');
            
            if (!tournamentId) {
                // Create new tournament
                const { data, error } = await this.supabase
                    .from('tournaments')
                    .insert([{
                        name: `Bakken ${new Date().getFullYear()}`,
                        created_at: new Date().toISOString(),
                        status: 'active'
                    }])
                    .select()
                    .single();

                if (error) {
                    console.error('Error creating tournament:', error);
                    return;
                }

                tournamentId = data.id;
                localStorage.setItem('bakken-tournament-id', tournamentId);
                console.log('🏆 Created new tournament:', tournamentId);
            } else {
                console.log('🏆 Using existing tournament:', tournamentId);
            }

            this.tournamentId = tournamentId;
        } catch (error) {
            console.error('❌ Error setting up tournament:', error);
        }
    }

    setupRealtimeSubscriptions() {
        if (!this.supabase || !this.tournamentId) return;

        try {
            // Subscribe to real-time changes
            this.supabase
                .channel(`tournament-${this.tournamentId}`)
                .on('postgres_changes', 
                    { event: '*', schema: 'public', table: 'players', filter: `tournament_id=eq.${this.tournamentId}` },
                    (payload) => this.handleRealtimeUpdate('players', payload)
                )
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'teams', filter: `tournament_id=eq.${this.tournamentId}` },
                    (payload) => this.handleRealtimeUpdate('teams', payload)
                )
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'games', filter: `tournament_id=eq.${this.tournamentId}` },
                    (payload) => this.handleRealtimeUpdate('games', payload)
                )
                .subscribe((status) => {
                    console.log('🔄 Real-time subscription status:', status);
                });

            console.log('✅ Real-time subscriptions active');
        } catch (error) {
            console.error('❌ Error setting up real-time subscriptions:', error);
        }
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncPendingChanges();
            this.showMessage('🌐 Back online - syncing data...', '#4ECDC4');
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.showMessage('📱 Offline mode - changes will sync when reconnected', '#FF9A42');
        });
    }

    handleRealtimeUpdate(table, payload) {
        console.log(`🔄 Real-time update for ${table}:`, payload);
        
        try {
            // Update local storage with remote changes
            switch (table) {
                case 'players':
                    this.updateLocalPlayers(payload);
                    break;
                case 'teams':
                    this.updateLocalTeams(payload);
                    break;
                case 'games':
                    this.updateLocalGames(payload);
                    break;
            }

            // Trigger UI update
            this.triggerUIUpdate(table);
        } catch (error) {
            console.error(`❌ Error handling real-time update for ${table}:`, error);
        }
    }

    // Sync methods for each data type
    async syncPlayers(players) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('players', players);
            return;
        }

        try {
            // Clear existing players for this tournament
            await this.supabase
                .from('players')
                .delete()
                .eq('tournament_id', this.tournamentId);

            // Insert new players
            if (players.length > 0) {
                const playersWithTournament = players.map(player => ({
                    id: player.id,
                    name: player.name,
                    tournament_id: this.tournamentId,
                    created_at: new Date().toISOString()
                }));

                const { error } = await this.supabase
                    .from('players')
                    .insert(playersWithTournament);

                if (error) throw error;
            }

            console.log('✅ Players synced to cloud');
            this.showSyncMessage('Players synced');
        } catch (error) {
            console.error('❌ Error syncing players:', error);
            this.queueForSync('players', players);
        }
    }

    async syncTeams(teamsData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('teams', teamsData);
            return;
        }

        try {
            // Clear existing teams
            await this.supabase
                .from('teams')
                .delete()
                .eq('tournament_id', this.tournamentId);

            // Insert new team data
            const { error } = await this.supabase
                .from('teams')
                .insert([{
                    tournament_id: this.tournamentId,
                    teams_data: teamsData,
                    updated_at: new Date().toISOString()
                }]);

            if (error) throw error;

            console.log('✅ Teams synced to cloud');
            this.showSyncMessage('Teams synced');
        } catch (error) {
            console.error('❌ Error syncing teams:', error);
            this.queueForSync('teams', teamsData);
        }
    }

    async syncGames(gamesData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('games', gamesData);
            return;
        }

        try {
            // Clear existing games
            await this.supabase
                .from('games')
                .delete()
                .eq('tournament_id', this.tournamentId);

            // Insert new games data
            const { error } = await this.supabase
                .from('games')
                .insert([{
                    tournament_id: this.tournamentId,
                    games_data: gamesData,
                    updated_at: new Date().toISOString()
                }]);

            if (error) throw error;

            console.log('✅ Games synced to cloud');
            this.showSyncMessage('Games synced');
        } catch (error) {
            console.error('❌ Error syncing games:', error);
            this.queueForSync('games', gamesData);
        }
    }

    async loadFromCloud() {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            return null;
        }

        try {
            console.log('📥 Loading data from cloud...');
            
            // Load all data for this tournament
            const [playersResult, teamsResult, gamesResult] = await Promise.all([
                this.supabase.from('players').select('*').eq('tournament_id', this.tournamentId),
                this.supabase.from('teams').select('*').eq('tournament_id', this.tournamentId).order('updated_at', { ascending: false }).limit(1),
                this.supabase.from('games').select('*').eq('tournament_id', this.tournamentId).order('updated_at', { ascending: false }).limit(1)
            ]);

            const cloudData = {
                players: playersResult.data || [],
                teams: teamsResult.data?.[0]?.teams_data || null,
                games: gamesResult.data?.[0]?.games_data || null
            };

            console.log('✅ Loaded data from cloud:', cloudData);
            return cloudData;
        } catch (error) {
            console.error('❌ Error loading from cloud:', error);
            return null;
        }
    }

    queueForSync(type, data) {
        // Remove any existing queued item of the same type
        this.syncQueue = this.syncQueue.filter(item => item.type !== type);
        
        // Add new item to queue
        this.syncQueue.push({ type, data, timestamp: Date.now() });
        console.log(`📝 Queued ${type} for sync when online`);
    }

    async syncPendingChanges() {
        if (!this.isOnline || this.syncQueue.length === 0) return;

        console.log(`🔄 Syncing ${this.syncQueue.length} pending changes...`);

        const queueCopy = [...this.syncQueue];
        this.syncQueue = [];

        for (const item of queueCopy) {
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
            } catch (error) {
                console.error(`❌ Error syncing ${item.type}:`, error);
                // Re-queue failed items
                this.queueForSync(item.type, item.data);
            }
        }

        if (this.syncQueue.length === 0) {
            this.showMessage('✅ All changes synced to cloud', '#4ECDC4');
        }
    }

    // Update local storage methods
    updateLocalPlayers(payload) {
        try {
            let players = JSON.parse(localStorage.getItem('bakken-players') || '[]');
            
            switch (payload.eventType) {
                case 'INSERT':
                    // Only add if not already exists
                    if (!players.find(p => p.id === payload.new.id)) {
                        players.push({
                            id: payload.new.id,
                            name: payload.new.name
                        });
                    }
                    break;
                case 'UPDATE':
                    const updateIndex = players.findIndex(p => p.id === payload.new.id);
                    if (updateIndex !== -1) {
                        players[updateIndex] = {
                            id: payload.new.id,
                            name: payload.new.name
                        };
                    }
                    break;
                case 'DELETE':
                    players = players.filter(p => p.id !== payload.old.id);
                    break;
            }

            localStorage.setItem('bakken-players', JSON.stringify(players));
            localStorage.setItem('bakken-players-last-update', Date.now().toString());
        } catch (error) {
            console.error('❌ Error updating local players:', error);
        }
    }

    updateLocalTeams(payload) {
        try {
            if (payload.new?.teams_data) {
                localStorage.setItem('bakken-teams', JSON.stringify(payload.new.teams_data));
                localStorage.setItem('bakken-teams-last-update', Date.now().toString());
            }
        } catch (error) {
            console.error('❌ Error updating local teams:', error);
        }
    }

    updateLocalGames(payload) {
        try {
            if (payload.new?.games_data) {
                localStorage.setItem('bakken-games', JSON.stringify(payload.new.games_data));
                localStorage.setItem('bakken-games-last-update', Date.now().toString());
            }
        } catch (error) {
            console.error('❌ Error updating local games:', error);
        }
    }

    triggerUIUpdate(table) {
        // Dispatch custom events to trigger UI updates
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
            if (messageDiv.parentNode) messageDiv.remove();
        }, 3000);
    }

    showSyncMessage(message) {
        this.showMessage(`☁️ ${message}`, '#4ECDC4');
    }

    // Public methods for the app to use
    async initialize() {
        if (!this.isInitialized) {
            // Wait for initialization
            let attempts = 0;
            while (!this.isInitialized && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
        }

        if (this.isOnline && this.isInitialized) {
            const cloudData = await this.loadFromCloud();
            if (cloudData) {
                this.mergeCloudData(cloudData);
            }
        }
    }

    mergeCloudData(cloudData) {
        try {
            let dataUpdated = false;

            // Players
            if (cloudData.players.length > 0) {
                const localPlayers = JSON.parse(localStorage.getItem('bakken-players') || '[]');
                if (localPlayers.length === 0 || this.shouldUseCloudData('players')) {
                    const cleanPlayers = cloudData.players.map(p => ({ id: p.id, name: p.name }));
                    localStorage.setItem('bakken-players', JSON.stringify(cleanPlayers));
                    localStorage.setItem('bakken-players-last-update', Date.now().toString());
                    dataUpdated = true;
                }
            }

            // Teams
            if (cloudData.teams) {
                const localTeams = localStorage.getItem('bakken-teams');
                if (!localTeams || this.shouldUseCloudData('teams')) {
                    localStorage.setItem('bakken-teams', JSON.stringify(cloudData.teams));
                    localStorage.setItem('bakken-teams-last-update', Date.now().toString());
                    dataUpdated = true;
                }
            }

            // Games
            if (cloudData.games) {
                const localGames = localStorage.getItem('bakken-games');
                if (!localGames || this.shouldUseCloudData('games')) {
                    localStorage.setItem('bakken-games', JSON.stringify(cloudData.games));
                    localStorage.setItem('bakken-games-last-update', Date.now().toString());
                    dataUpdated = true;
                }
            }

            if (dataUpdated) {
                // Trigger UI refresh
                window.dispatchEvent(new CustomEvent('bakken-data-loaded'));
                this.showMessage('📥 Data loaded from cloud', '#45B7D1');
            }
        } catch (error) {
            console.error('❌ Error merging cloud data:', error);
        }
    }

    shouldUseCloudData(type) {
        const lastLocalUpdate = localStorage.getItem(`bakken-${type}-last-update`);
        return !lastLocalUpdate || Date.now() - parseInt(lastLocalUpdate) > 30000; // 30 seconds
    }

    // Get connection status
    getStatus() {
        return {
            online: this.isOnline,
            initialized: this.isInitialized,
            tournamentId: this.tournamentId,
            pendingSync: this.syncQueue.length
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

// Global sync manager instance
window.syncManager = new SyncManager();