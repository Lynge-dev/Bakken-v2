// Supabase Sync Manager - Corrected URL
class SyncManager {
    constructor() {
        this.supabaseUrl = 'https://vpcfvjztjfggzsabidzr.supabase.co'; // CORRECTED URL
        this.supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwY2Z2anp0amZnZ3pzYWJpZHpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4NzIxMzksImV4cCI6MjA3MTQ0ODEzOX0.gXNuQntHbt1QrZyMX1ihVHZeK0Qu_O3XleuWnqh5EPY';
        this.supabase = null;
        this.tournamentId = null;
        this.isOnline = navigator.onLine;
        this.syncQueue = [];
        this.isInitialized = false;
        this.connectionAttempts = 0;
        this.maxConnectionAttempts = 3;
        this.initTimeout = null;
        
        // Start initialization but don't block the app
        this.init();
        
        // Always mark as initialized after 5 seconds to not block the app
        setTimeout(() => {
            if (!this.isInitialized) {
                console.log('📱 Sync timeout - running in offline mode');
                this.isInitialized = true;
                this.updateStatus('offline-only');
            }
        }, 5000);
    }

    async init() {
        try {
            console.log('🔄 Attempting to initialize sync...');
            
            // Set a timeout for the entire initialization
            this.initTimeout = setTimeout(() => {
                console.log('⏰ Sync initialization timeout');
                this.fallbackToOfflineMode();
            }, 10000);
            
            // Check if Supabase is loaded
            if (typeof window.supabase === 'undefined') {
                console.log('⚠️ Supabase not loaded, waiting...');
                if (this.connectionAttempts < this.maxConnectionAttempts) {
                    this.connectionAttempts++;
                    setTimeout(() => this.init(), 2000);
                } else {
                    this.fallbackToOfflineMode();
                }
                return;
            }

            // Initialize Supabase client
            this.supabase = window.supabase.createClient(this.supabaseUrl, this.supabaseKey);
            console.log('✅ Supabase client created');
            
            // Quick connection test with timeout
            const connectionTest = Promise.race([
                this.supabase.from('tournaments').select('count').limit(1),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
            ]);
            
            const { data, error } = await connectionTest;
            
            if (error) {
                console.log('❌ Database connection failed:', error.message);
                this.fallbackToOfflineMode();
                return;
            }
            
            console.log('✅ Database connection successful');
            
            await this.setupTournament();
            this.setupRealtimeSubscriptions();
            this.setupOfflineHandling();
            
            clearTimeout(this.initTimeout);
            this.isInitialized = true;
            
            console.log('🚀 Sync Manager fully initialized');
            this.updateStatus('connected');
            
        } catch (error) {
            console.log('❌ Sync initialization error:', error.message);
            this.fallbackToOfflineMode();
        }
    }

    fallbackToOfflineMode() {
        console.log('📱 Running in offline-only mode');
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
                        created_at: new Date().toISOString(),
                        status: 'active'
                    }])
                    .select()
                    .single();

                if (error) throw error;

                tournamentId = data.id;
                localStorage.setItem('bakken-tournament-id', tournamentId);
                console.log('✅ Created tournament:', tournamentId);
            } else {
                console.log('✅ Using existing tournament:', tournamentId);
            }

            this.tournamentId = tournamentId;
        } catch (error) {
            console.error('❌ Tournament setup failed:', error);
            throw error;
        }
    }

    setupRealtimeSubscriptions() {
        if (!this.supabase || !this.tournamentId) return;

        try {
            this.supabase
                .channel(`tournament-${this.tournamentId}`)
                .on('postgres_changes', 
                    { event: '*', schema: 'public', table: 'players', filter: `tournament_id=eq.${this.tournamentId}` },
                    (payload) => this.handleRealtimeUpdate('players', payload)
                )
                .subscribe((status) => {
                    console.log('📡 Real-time status:', status);
                });
        } catch (error) {
            console.error('❌ Real-time setup failed:', error);
        }
    }

    setupOfflineHandling() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncPendingChanges();
            this.showMessage('🌐 Back online', '#4ECDC4');
            this.updateStatus('online');
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.showMessage('📱 Offline mode', '#FF9A42');
            this.updateStatus('offline');
        });
    }

    updateStatus(status) {
        window.dispatchEvent(new CustomEvent('sync-status-changed', { 
            detail: { status, manager: this } 
        }));
    }

    handleRealtimeUpdate(table, payload) {
        console.log(`🔄 Real-time update:`, payload);
        this.triggerUIUpdate(table);
    }

    async syncPlayers(players) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('players', players);
            return;
        }

        try {
            await this.supabase.from('players').delete().eq('tournament_id', this.tournamentId);

            if (players.length > 0) {
                const playersWithTournament = players.map(player => ({
                    id: player.id,
                    name: player.name,
                    tournament_id: this.tournamentId
                }));

                await this.supabase.from('players').insert(playersWithTournament);
            }

            console.log('✅ Players synced');
            this.showSyncMessage('Players synced');
        } catch (error) {
            console.error('❌ Sync failed:', error);
            this.queueForSync('players', players);
        }
    }

    async syncTeams(teamsData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('teams', teamsData);
            return;
        }

        try {
            await this.supabase.from('teams').delete().eq('tournament_id', this.tournamentId);

            const { error } = await this.supabase
                .from('teams')
                .insert([{
                    tournament_id: this.tournamentId,
                    teams_data: teamsData,
                    updated_at: new Date().toISOString()
                }]);

            if (error) throw error;

            console.log('✅ Teams synced');
            this.showSyncMessage('Teams synced');
        } catch (error) {
            console.error('❌ Teams sync failed:', error);
            this.queueForSync('teams', teamsData);
        }
    }

    async syncGames(gamesData) {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            this.queueForSync('games', gamesData);
            return;
        }

        try {
            await this.supabase.from('games').delete().eq('tournament_id', this.tournamentId);

            const { error } = await this.supabase
                .from('games')
                .insert([{
                    tournament_id: this.tournamentId,
                    games_data: gamesData,
                    updated_at: new Date().toISOString()
                }]);

            if (error) throw error;

            console.log('✅ Games synced');
            this.showSyncMessage('Games synced');
        } catch (error) {
            console.error('❌ Games sync failed:', error);
            this.queueForSync('games', gamesData);
        }
    }

    queueForSync(type, data) {
        this.syncQueue = this.syncQueue.filter(item => item.type !== type);
        this.syncQueue.push({ type, data, timestamp: Date.now() });
        console.log(`📝 Queued ${type} for sync`);
        this.updateStatus('pending-sync');
    }

    async syncPendingChanges() {
        if (!this.isOnline || this.syncQueue.length === 0) return;

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
                this.syncQueue = this.syncQueue.filter(i => i !== item);
            } catch (error) {
                console.error('❌ Sync failed:', error);
            }
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
        
        setTimeout(() => messageDiv.remove(), 3000);
    }

    showSyncMessage(message) {
        this.showMessage(`☁️ ${message}`, '#4ECDC4');
    }

    async initialize() {
        return Promise.resolve();
    }

    async loadFromCloud() {
        if (!this.isOnline || !this.supabase || !this.tournamentId) {
            return null;
        }

        try {
            console.log('📥 Loading data from cloud...');
            
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

// Add CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to { opacity: 1; transform: translateX(0); }
    }
`;
document.head.appendChild(style);

// Initialize
window.syncManager = new SyncManager();