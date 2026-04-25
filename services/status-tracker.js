/**
 * Service pour tracker les changements de statut des campagnes
 * Détecte quand une campagne passe de "Non programmable" à "Programmable"
 */

const { Client } = require('pg');

class StatusTracker {
    constructor(databaseUrl) {
        this.databaseUrl = databaseUrl;
        this.client = null;
    }

    async connect() {
        this.client = new Client({
            connectionString: this.databaseUrl,
            ssl: { rejectUnauthorized: false }
        });
        await this.client.connect();
    }

    async disconnect() {
        if (this.client) await this.client.end();
    }

    /**
     * Parser le champ CSM pour extraire Commercial et CSM
     * Format: "Commercial - CSM1, CSM2 / Trader"
     * Exemple: "Antoinette - Edwin / Mustapha - Jerome"
     * Si commercial = "aucun", on le met à NULL
     */
    parseCommercialAndCSM(card) {
        // Essayer plusieurs champs possibles
        const csmField = card.csm || card.csmName || card.commercial || card.responsable || '';
        
        // Log pour debug (première carte seulement)
        if (!this.loggedOnce) {
            console.log('🔍 DEBUG parseCommercialAndCSM:');
            console.log('  card.csm:', card.csm);
            console.log('  card.csmName:', card.csmName);
            console.log('  card.commercial:', card.commercial);
            console.log('  card.responsable:', card.responsable);
            console.log('  card.trader:', card.trader);
            console.log('  csmField final:', csmField);
            this.loggedOnce = true;
        }
        
        if (!csmField) {
            return { commercial: null, csm: null };
        }
        
        // Séparer par "/" pour ignorer le trader
        const beforeTrader = csmField.split('/')[0].trim();
        
        // Séparer par "-" pour avoir Commercial et CSM
        const parts = beforeTrader.split('-').map(p => p.trim());
        
        let commercial = null;
        let csm = null;
        
        if (parts.length >= 2) {
            commercial = parts[0]; // Premier élément = Commercial
            csm = parts.slice(1).join(', '); // Reste = CSM (peut contenir des virgules)
            
            // Si commercial = "aucun", on le met à NULL
            if (commercial && commercial.toLowerCase() === 'aucun') {
                commercial = null;
            }
        } else if (parts.length === 1) {
            // Si pas de "-", tout est considéré comme CSM
            csm = parts[0];
        }
        
        return { commercial, csm };
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
                    const campaignId = card.id;
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
            card.id,
            card.title,
            commercial,
            csm,
            card.trader || card.traderName,
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
            campaign_name: card.title,
            commercial_name: commercial,
            csm_name: csm,
            trader_name: card.trader || card.traderName,
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
        const values = [card.id, ...Object.values(updates)];

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
            card.id,
            card.title,
            commercial,
            csm,
            card.trader || card.traderName,
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
