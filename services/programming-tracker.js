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
        const startTime = Date.now();

        try {
            await this.connect();

            const programmedCampaigns = this.findProgrammedCampaigns(trelloData);
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
     * Trouver toutes les campagnes programmées
     */
    findProgrammedCampaigns(trelloData) {
        const campaigns = [];
        const now = new Date();

        if (!trelloData?.data?.lanes) return campaigns;

        for (const lane of trelloData.data.lanes) {
            for (const card of lane.cards || []) {
                // Seulement les campagnes programmées
                if (card.isProgrammable && card.areSubdivisionsProgrammed === true) {
                    const startDate = this.parseDate(card.dates?.startingDateFormatted);
                    if (startDate) {
                        const daysBeforeStart = this.getDaysDiff(now, startDate);
                        
                        campaigns.push({
                            campaign_id: card.campaignId,
                            campaign_name: card.name,
                            csm_name: card.commercial,
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
                    }
                }
            }
        }

        return campaigns;
    }

    /**
     * Logger une programmation (éviter les doublons)
     */
    async logProgramming(campaign) {
        try {
            // Vérifier si existe déjà
            const existing = await this.client.query(
                'SELECT id FROM campaign_programming WHERE campaign_id = $1',
                [campaign.campaign_id]
            );

            if (existing.rows.length > 0) {
                return false; // Déjà enregistrée
            }

            // Insérer
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

            return true; // Nouvelle insertion
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
