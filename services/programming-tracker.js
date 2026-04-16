/**
 * Service simplifié pour tracker les programmations de campagnes
 * Tourne 3x par jour (8h, 14h, 20h)
 */

const { Client } = require('pg');

class ProgrammingTracker {
    constructor(databaseUrl) {
        this.databaseUrl = databaseUrl;
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
     * Analyse principale
     */
    async trackProgramming(trelloData) {
        console.log('🔍 Tracking des programmations...');
        console.log('📦 Données Trello reçues:', {
            hasData: !!trelloData,
            hasDataProperty: !!trelloData?.data,
            hasLanes: !!trelloData?.data?.lanes,
            lanesCount: trelloData?.data?.lanes?.length || 0
        });
        
        const startTime = Date.now();

        try {
            await this.connect();

            const programmedCampaigns = this.findProgrammedCampaigns(trelloData);
            console.log(`🎯 ${programmedCampaigns.length} campagnes programmées trouvées`);
            
            let newCount = 0;

            for (const campaign of programmedCampaigns) {
                const inserted = await this.logProgramming(campaign);
                if (inserted) newCount++;
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ ${newCount} nouvelles programmations détectées en ${duration}s`);

            return { total: programmedCampaigns.length, new: newCount };

        } catch (error) {
            console.error('❌ Erreur lors du tracking:', error);
            throw error;
        } finally {
            await this.disconnect();
        }
    }

    /**
     * Trouver toutes les campagnes programmées (NOUVELLES uniquement)
     */
    async findProgrammedCampaigns(trelloData) {
        const campaigns = [];
        const now = new Date();

        // Gérer différentes structures de réponse
        const lanes = trelloData?.data?.lanes || trelloData?.lanes || [];
        
        if (!lanes || lanes.length === 0) {
            console.log('⚠️  Pas de lanes dans les données Trello');
            console.log('Structure reçue:', Object.keys(trelloData || {}));
            return campaigns;
        }

        let totalCards = 0;
        let programmableCards = 0;
        let programmedCards = 0;
        let newlyProgrammed = 0;

        // Récupérer les campagnes déjà enregistrées
        const existingCampaigns = await this.client.query(
            'SELECT campaign_id FROM campaign_programming'
        );
        const existingIds = new Set(existingCampaigns.rows.map(r => r.campaign_id));

        for (const lane of trelloData.lanes) {
            // Lanes programmables
            if (['Programmable', 'Programmé', 'Programmé - En attente', 'Programmé - Validé'].includes(lane.name)) {
                programmableCards += lane.cards.length;
                
                for (const card of lane.cards) {
                    totalCards++;
                    
                    // Carte programmée = a un trackerId
                    if (card.trackerId) {
                        programmedCards++;
                        
                        // Vérifier si c'est une NOUVELLE programmation
                        if (!existingIds.has(card.campaignId)) {
                            const startDate = this.parseDate(card.dates?.startingDateFormatted);
                            if (startDate) {
                                const daysBeforeStart = this.getDaysDiff(now, startDate);
                                
                                newProgrammations.push({
                                    campaign_id: card.campaignId,
                                    campaign_name: card.name,
                                    csm_name: card.accountManager || card.commercial || null,
                                    trader_name: this.getFirstTrader(card.trader),
                                    programmed_at: now,
                                    campaign_start_date: startDate,
                                    days_before_start: daysBeforeStart,
                                    metadata: {
                                        trackerId: card.trackerId,
                                        laneId: lane.id,
                                        laneName: lane.name
                                    }
                                });
                                newlyProgrammed++;
                            }
                        }
                    }
                }
            }
        }

        console.log(`📊 Cartes analysées: ${totalCards} total, ${programmableCards} programmables, ${programmedCards} programmées, ${newlyProgrammed} nouvelles`);
        return newProgrammations;
    }

    /**
     * Logger une nouvelle programmation (pas de vérification de doublon car déjà fait)
     */
    async logProgramming(campaign) {
        try {
            // Insérer directement (pas de vérification car déjà filtré)
            await this.client.query(`
                INSERT INTO campaign_programming 
                (campaign_id, campaign_name, csm_name, trader_name, programmed_at,
                 campaign_start_date, days_before_start, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                campaign.campaign_id,
                campaign.campaign_name,
                campaign.csm_name,
                campaign.trader_name,
                campaign.programmed_at,
                campaign.campaign_start_date,
                campaign.days_before_start,
                JSON.stringify(campaign.metadata)
            ]);

            return true;
        } catch (error) {
            console.error(`Erreur lors du log de ${campaign.campaign_id}:`, error.message);
            return false;
        }
    }

    /**
     * Récupérer les stats pour le dashboard
     */
    async getStats(period = '30d') {
        try {
            await this.connect();

            const view = period === '30d' ? 'v_programming_stats_30d' : 'v_programming_stats_by_csm';
            const result = await this.client.query(`SELECT * FROM ${view}`);

            return result.rows;
        } catch (error) {
            console.error('Erreur lors de la récupération des stats:', error);
            return [];
        } finally {
            await this.disconnect();
        }
    }

    // Helpers
    parseDate(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }

    getDaysDiff(date1, date2) {
        const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
        const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
        return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    getFirstTrader(traderField) {
        if (!traderField) return null;
        return traderField.split(/\s+-\s+/)[0].trim();
    }
}

module.exports = ProgrammingTracker;
