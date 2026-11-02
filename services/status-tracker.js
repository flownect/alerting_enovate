/**
 * Service pour tracker les changements de statut des campagnes
 * Détecte quand une campagne passe de "Non programmable" à "Programmable"
 */

const { Client } = require('pg');

const truncate = (value, max) => {
    if (value == null) return null;
    const str = String(value);
    return str.length > max ? str.slice(0, max) : str;
};

class StatusTracker {
    constructor(databaseUrl) {
        this.databaseUrl = databaseUrl;
        this.client = null;
        this._schemaReady = false;
    }

    async connect() {
        this.client = new Client({
            connectionString: this.databaseUrl,
            ssl: { rejectUnauthorized: false }
        });
        await this.client.connect();
        await this.ensureSchema();
    }

    async disconnect() {
        if (this.client) await this.client.end();
    }

    /**
     * Force les colonnes texte en TEXT.
     * Les vues dépendantes bloquent ALTER → on DROP puis on recrée.
     */
    async ensureSchema() {
        if (this._schemaReady) return;

        try {
            await this.client.query('DROP VIEW IF EXISTS v_programming_stats_30d CASCADE');
            await this.client.query('DROP VIEW IF EXISTS v_programming_stats_by_csm CASCADE');
        } catch (err) {
            console.warn(`[StatusTracker] DROP VIEW: ${err.message}`);
        }

        const widen = [
            ['campaign_status_tracking', 'campaign_id'],
            ['campaign_status_tracking', 'campaign_name'],
            ['campaign_status_tracking', 'commercial_name'],
            ['campaign_status_tracking', 'csm_name'],
            ['campaign_status_tracking', 'trader_name'],
            ['campaign_status_tracking', 'current_status'],
            ['campaign_status_history', 'campaign_id'],
            ['campaign_status_history', 'campaign_name'],
            ['campaign_status_history', 'commercial_name'],
            ['campaign_status_history', 'csm_name'],
            ['campaign_status_history', 'trader_name'],
            ['campaign_status_history', 'old_status'],
            ['campaign_status_history', 'new_status'],
            ['campaign_programming', 'campaign_id'],
            ['campaign_programming', 'campaign_name'],
            ['campaign_programming', 'csm_name'],
            ['campaign_programming', 'trader_name'],
            ['campaign_comments', 'campaign_id'],
            ['campaign_comments', 'campaign_name'],
            ['campaign_comments', 'author']
        ];

        for (const [table, column] of widen) {
            try {
                await this.client.query(
                    `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT`
                );
            } catch (err) {
                if (!/does not exist/i.test(err.message)) {
                    console.warn(`[StatusTracker] ALTER ${table}.${column}: ${err.message}`);
                }
            }
        }

        // Recréer les vues (après ALTER campaign_programming)
        try {
            await this.client.query(`
                CREATE OR REPLACE VIEW v_programming_stats_by_csm AS
                SELECT 
                    csm_name,
                    COUNT(*) as total_programmed,
                    COUNT(*) FILTER (WHERE days_before_start = 0) as programmed_j0,
                    COUNT(*) FILTER (WHERE days_before_start = 1) as programmed_j1,
                    COUNT(*) FILTER (WHERE days_before_start = 2) as programmed_j2,
                    COUNT(*) FILTER (WHERE days_before_start >= 3) as programmed_j3_plus,
                    COUNT(*) FILTER (WHERE days_before_start < 0) as programmed_late,
                    MIN(programmed_at) as first_programming,
                    MAX(programmed_at) as last_programming
                FROM campaign_programming
                WHERE csm_name IS NOT NULL
                GROUP BY csm_name
                ORDER BY total_programmed DESC
            `);
            await this.client.query(`
                CREATE OR REPLACE VIEW v_programming_stats_30d AS
                SELECT 
                    COALESCE(csm_name, trader_name) as csm_name,
                    COUNT(*) as total_programmed,
                    COUNT(*) FILTER (WHERE days_before_start < 0) as programmed_after_start,
                    COUNT(*) FILTER (WHERE days_before_start = 0) as late_j0,
                    COUNT(*) FILTER (WHERE days_before_start = 1) as late_j1,
                    COUNT(*) FILTER (WHERE days_before_start = 2) as late_j2,
                    COUNT(*) FILTER (WHERE days_before_start = 3) as on_time_j3,
                    COUNT(*) FILTER (WHERE days_before_start > 3) as on_time_j3_plus,
                    MAX(programmed_at) as last_programmed_at
                FROM campaign_programming
                WHERE programmed_at >= NOW() - INTERVAL '30 days'
                  AND (csm_name IS NOT NULL OR trader_name IS NOT NULL)
                GROUP BY COALESCE(csm_name, trader_name)
                ORDER BY COUNT(*) FILTER (WHERE days_before_start <= 2) DESC
            `);
        } catch (err) {
            console.warn(`[StatusTracker] recreate views: ${err.message}`);
        }

        try {
            const check = await this.client.query(`
                SELECT column_name, data_type, character_maximum_length
                FROM information_schema.columns
                WHERE table_name = 'campaign_status_tracking'
                  AND column_name IN ('campaign_id','campaign_name','commercial_name','csm_name','trader_name','current_status')
                ORDER BY column_name
            `);
            console.log('[StatusTracker] colonnes campaign_status_tracking:',
                check.rows.map(r => `${r.column_name}=${r.data_type}${r.character_maximum_length ? `(${r.character_maximum_length})` : ''}`).join(', ')
            );
        } catch (err) {
            console.warn(`[StatusTracker] check schema: ${err.message}`);
        }

        this._schemaReady = true;
    }

    /**
     * Extraire Commercial et CSM depuis les champs Trello
     * Les données sont déjà parsées dans card.commercial et card.accountManager
     */
    parseCommercialAndCSM(card) {
        let commercial = card.commercial || null;
        let csm = card.accountManager || null;
        
        // Si commercial = "aucun", on le met à NULL
        if (commercial && commercial.toLowerCase() === 'aucun') {
            commercial = null;
        }
        
        // Si CSM = "aucun", on le met à NULL
        if (csm && csm.toLowerCase() === 'aucun') {
            csm = null;
        }
        
        return {
            commercial: truncate(commercial, 255),
            csm: truncate(csm, 255)
        };
    }

    getCampaignId(card) {
        const id = card.id || card.campaignId || card.briefId;
        return truncate(id, 255);
    }

    /**
     * Détermine le statut actuel d'une campagne
     */
    getCampaignStatus(card) {
        const title = (card.title || '').toLowerCase();
        
        // Ordre de priorité (du plus avancé au moins avancé)
        // 1. Live
        const isLive = title.includes('live') || card.isLive || false;
        if (isLive) return 'live';
        
        // 2. Programmé (a un trackerId ou subdivision programmée)
        const isProgrammed = !!(card.trackerId || card.subdivisions?.some(s => s.isProgrammed));
        if (isProgrammed) return 'programmed';
        
        // 3. Programmable
        const isProgrammable = card.isProgrammable || false;
        if (isProgrammable) return 'programmable';
        
        // 4. Non programmable (par défaut)
        return 'non_programmable';
    }

    /**
     * Track tous les changements de statut
     * Logique: Stocker TOUTES les campagnes et détecter les transitions
     */
    async trackStatusChanges(trelloData) {
        console.log('🔍 Tracking des changements de statut...');
        
        try {
            await this.connect();
            
            const lanes = trelloData?.data?.lanes || trelloData?.lanes || [];
            if (!lanes || lanes.length === 0) {
                console.log('⚠️  Pas de lanes dans les données Trello');
                return { total: 0, changes: 0, transitions: 0 };
            }

            let totalCampaigns = 0;
            let changesCount = 0;
            let transitionsCount = 0; // non_programmable → programmable/programmed

            for (const lane of lanes) {
                if (!lane.cards) continue;
                
                for (const card of lane.cards) {
                    totalCampaigns++;
                    try {
                        const campaignId = this.getCampaignId(card);
                        if (!campaignId) {
                            console.warn(`⚠️  Carte sans id ignorée: ${card.title || '?'}`);
                            continue;
                        }
                        const currentStatus = this.getCampaignStatus(card);
                        const startDate = card.dates?.startingDate || card.startDate;

                        // Récupérer l'état actuel en BDD
                        const existing = await this.client.query(
                            'SELECT * FROM campaign_status_tracking WHERE campaign_id = $1',
                            [campaignId]
                        );

                        if (existing.rows.length === 0) {
                            // Première fois qu'on voit cette campagne
                            await this.createCampaignTracking(card, currentStatus, startDate);
                            console.log(`🆕 Nouvelle campagne: ${card.title} [${currentStatus}]`);
                        } else {
                            // Campagne existante - vérifier si changement
                            const oldRecord = existing.rows[0];
                            const oldStatus = oldRecord.current_status;

                            if (oldStatus !== currentStatus) {
                                console.log(`📝 Changement: ${card.title}`);
                                console.log(`   ${oldStatus} → ${currentStatus}`);
                                
                                // Mettre à jour le tracking
                                await this.updateCampaignTracking(card, oldRecord, currentStatus, startDate);
                                
                                // Enregistrer dans l'historique
                                await this.logStatusHistory(card, oldStatus, currentStatus, startDate);
                                
                                changesCount++;

                                // Détecter les transitions importantes
                                if (oldStatus === 'non_programmable' && 
                                    (currentStatus === 'programmable' || currentStatus === 'programmed')) {
                                    transitionsCount++;
                                    console.log(`✅ Transition importante: ${card.title} est maintenant ${currentStatus}`);
                                }
                            }
                        }
                    } catch (cardErr) {
                        console.error(`❌ Tracking carte "${card.title || card.id}": ${cardErr.message}`);
                    }
                }
            }

            console.log(`✅ ${totalCampaigns} campagnes traitées`);
            console.log(`✅ ${changesCount} changements de statut détectés`);
            console.log(`✅ ${transitionsCount} transitions non_programmable → programmable/programmed`);

            return { total: totalCampaigns, changes: changesCount, transitions: transitionsCount };

        } catch (error) {
            console.error('❌ Erreur lors du tracking des statuts:', error);
            throw error;
        } finally {
            await this.disconnect();
        }
    }

    /**
     * Créer un nouveau tracking de campagne
     */
    async createCampaignTracking(card, status, startDate) {
        const now = new Date();
        const { commercial, csm } = this.parseCommercialAndCSM(card);
        
        await this.client.query(`
            INSERT INTO campaign_status_tracking (
                campaign_id,
                campaign_name,
                commercial_name,
                csm_name,
                trader_name,
                current_status,
                first_seen_at,
                became_non_programmable_at,
                campaign_start_date,
                metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            this.getCampaignId(card),
            card.title || null,
            commercial,
            csm,
            truncate(card.trader || card.traderName, 255),
            status,
            now,
            status === 'non_programmable' ? now : null,
            startDate,
            JSON.stringify({
                lane: card.laneName,
                isProgrammable: card.isProgrammable,
                trackerId: card.trackerId,
                raw_csm_field: card.csm || card.csmName
            })
        ]);
    }

    /**
     * Mettre à jour le tracking d'une campagne lors d'un changement de statut
     */
    async updateCampaignTracking(card, oldRecord, newStatus, startDate) {
        const now = new Date();
        const { commercial, csm } = this.parseCommercialAndCSM(card);
        
        const updates = {
            current_status: newStatus,
            campaign_name: card.title || null,
            commercial_name: commercial,
            csm_name: csm,
            trader_name: truncate(card.trader || card.traderName, 255),
            campaign_start_date: startDate,
            updated_at: now
        };

        // Enregistrer les dates de transition
        if (oldRecord.current_status === 'non_programmable' && newStatus === 'programmable') {
            updates.became_programmable_at = now;
            
            // Calculer days_to_become_programmable
            if (oldRecord.became_non_programmable_at) {
                const diff = now - new Date(oldRecord.became_non_programmable_at);
                updates.days_to_become_programmable = Math.floor(diff / (1000 * 60 * 60 * 24));
            }
            
            // Calculer days_before_launch
            if (startDate) {
                const launch = new Date(startDate);
                const diff = launch - now;
                updates.days_before_launch = Math.floor(diff / (1000 * 60 * 60 * 24));
            }
        }
        
        if (oldRecord.current_status === 'non_programmable' && newStatus === 'programmed') {
            updates.became_programmed_at = now;
            
            // Calculer days_to_become_programmable (même si sauté l'étape "programmable")
            if (oldRecord.became_non_programmable_at) {
                const diff = now - new Date(oldRecord.became_non_programmable_at);
                updates.days_to_become_programmable = Math.floor(diff / (1000 * 60 * 60 * 24));
            }
            
            // Calculer days_before_launch
            if (startDate) {
                const launch = new Date(startDate);
                const diff = launch - now;
                updates.days_before_launch = Math.floor(diff / (1000 * 60 * 60 * 24));
            }
        }
        
        if (newStatus === 'programmed' && !oldRecord.became_programmed_at) {
            updates.became_programmed_at = now;
        }

        // Construire la requête UPDATE
        const setClause = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
        const values = [this.getCampaignId(card), ...Object.values(updates)];

        await this.client.query(
            `UPDATE campaign_status_tracking SET ${setClause} WHERE campaign_id = $1`,
            values
        );
    }

    /**
     * Enregistrer dans l'historique
     */
    async logStatusHistory(card, oldStatus, newStatus, startDate) {
        const { commercial, csm } = this.parseCommercialAndCSM(card);
        
        await this.client.query(`
            INSERT INTO campaign_status_history (
                campaign_id,
                campaign_name,
                commercial_name,
                csm_name,
                trader_name,
                old_status,
                new_status,
                campaign_start_date,
                metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            this.getCampaignId(card),
            card.title || null,
            commercial,
            csm,
            truncate(card.trader || card.traderName, 255),
            oldStatus,
            newStatus,
            startDate,
            JSON.stringify({
                lane: card.laneName,
                isProgrammable: card.isProgrammable,
                trackerId: card.trackerId,
                raw_csm_field: card.csm || card.csmName
            })
        ]);
    }

    /**
     * Récupère les stats des campagnes devenues programmables/programmées
     * @param {string} period - '30d' ou '90d'
     * @param {string} groupBy - 'csm' ou 'commercial'
     */
    async getStats(period = '30d', groupBy = 'csm') {
        try {
            await this.connect();
            
            const intervalDays = period === '30d' ? 30 : 90;
            const groupField = groupBy === 'commercial' ? 'commercial_name' : 'csm_name';
            
            const result = await this.client.query(`
                SELECT 
                    ${groupField} as name,
                    COUNT(*) as total_transitions,
                    
                    -- Délai pour devenir programmable (en jours)
                    ROUND(AVG(days_to_become_programmable) FILTER (WHERE days_to_become_programmable IS NOT NULL)::numeric, 1) as avg_days_to_programmable,
                    
                    -- Délai avant lancement (J-X)
                    COUNT(*) FILTER (WHERE days_before_launch < 0) as after_launch,
                    COUNT(*) FILTER (WHERE days_before_launch = 0) as j0,
                    COUNT(*) FILTER (WHERE days_before_launch = 1) as j1,
                    COUNT(*) FILTER (WHERE days_before_launch = 2) as j2,
                    COUNT(*) FILTER (WHERE days_before_launch = 3) as j3,
                    COUNT(*) FILTER (WHERE days_before_launch > 3) as j3_plus,
                    
                    MAX(COALESCE(became_programmable_at, became_programmed_at)) as last_transition
                FROM campaign_status_tracking
                WHERE (became_programmable_at >= NOW() - INTERVAL '${intervalDays} days'
                   OR became_programmed_at >= NOW() - INTERVAL '${intervalDays} days')
                  AND (became_programmable_at IS NOT NULL OR became_programmed_at IS NOT NULL)
                  AND ${groupField} IS NOT NULL
                GROUP BY ${groupField}
                ORDER BY COUNT(*) FILTER (WHERE days_before_launch <= 2) DESC
            `);
            
            return result.rows;
        } finally {
            await this.disconnect();
        }
    }
}

module.exports = StatusTracker;
