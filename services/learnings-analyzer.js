/**
 * Service d'analyse des learnings
 * Analyse les données Trello/Stats pour détecter des patterns
 * Tourne automatiquement 3x par jour (8h, 14h, 20h)
 */

const { Client } = require('pg');

class LearningsAnalyzer {
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
     * Analyse principale - appelée 3x par jour
     */
    async runAnalysis(trelloData, campaignStatsData) {
        console.log('🔍 Début de l\'analyse des learnings...');
        const startTime = Date.now();

        try {
            await this.connect();

            // 1. Logger les événements actuels
            const events = await this.extractEvents(trelloData, campaignStatsData);
            await this.logEvents(events);
            console.log(`✅ ${events.length} événements loggés`);

            // 2. Détecter les patterns
            const patterns = await this.detectPatterns();
            console.log(`✅ ${patterns.length} patterns détectés`);

            // 3. Générer les insights
            const insights = await this.generateInsights(patterns);
            console.log(`✅ ${insights.length} insights générés`);

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✨ Analyse terminée en ${duration}s`);

            return { events: events.length, patterns: patterns.length, insights: insights.length };

        } catch (error) {
            console.error('❌ Erreur lors de l\'analyse:', error);
            throw error;
        } finally {
            await this.disconnect();
        }
    }

    /**
     * Extraire les événements depuis les données Trello
     */
    async extractEvents(trelloData, campaignStatsData) {
        const events = [];
        const now = new Date();

        if (!trelloData?.data?.lanes) return events;

        for (const lane of trelloData.data.lanes) {
            for (const card of lane.cards || []) {
                // Événement: Campagne non-programmable lancée à J
                if (!card.isProgrammable && card.areSubdivisionsLive) {
                    const startDate = this.parseDate(card.dates?.startingDateFormatted);
                    if (startDate) {
                        const daysOffset = this.getDaysDiff(startDate, now);
                        if (daysOffset <= 0) {
                            events.push({
                                campaign_id: card.campaignId,
                                tracker_id: card.trackerId,
                                campaign_name: card.name,
                                event_type: 'launch',
                                event_subtype: 'non_programmable_launch',
                                csm_name: card.commercial,
                                trader_name: this.getFirstTrader(card.trader),
                                event_date: now,
                                campaign_start_date: startDate,
                                days_offset: daysOffset,
                                metadata: {
                                    isProgrammable: card.isProgrammable,
                                    laneId: lane.id,
                                    laneName: lane.name
                                }
                            });
                        }
                    }
                }

                // Événement: Campagne programmée lancée en retard
                if (card.isProgrammable && card.areSubdivisionsProgrammed && card.areSubdivisionsLive) {
                    const startDate = this.parseDate(card.dates?.startingDateFormatted);
                    if (startDate) {
                        const daysOffset = this.getDaysDiff(startDate, now);
                        if (daysOffset < 0) { // En retard
                            events.push({
                                campaign_id: card.campaignId,
                                tracker_id: card.trackerId,
                                campaign_name: card.name,
                                event_type: 'launch',
                                event_subtype: 'late_launch',
                                csm_name: card.commercial,
                                trader_name: this.getFirstTrader(card.trader),
                                event_date: now,
                                campaign_start_date: startDate,
                                days_offset: Math.abs(daysOffset),
                                metadata: {
                                    isProgrammable: card.isProgrammable,
                                    isProgrammed: card.areSubdivisionsProgrammed
                                }
                            });
                        }
                    }
                }

                // Événement: Bilan non saisi (J+3 ou plus)
                if (card.tags?.includes('Terminé') && card.tags?.includes('Bilan non saisi')) {
                    const endDate = this.parseDate(card.dates?.endingDateFormatted);
                    if (endDate) {
                        const daysFromEnd = this.getDaysDiff(endDate, now);
                        if (daysFromEnd >= 3) {
                            events.push({
                                campaign_id: card.campaignId,
                                tracker_id: card.trackerId,
                                campaign_name: card.name,
                                event_type: 'completion',
                                event_subtype: 'bilan_not_entered',
                                csm_name: card.commercial,
                                trader_name: this.getFirstTrader(card.trader),
                                event_date: now,
                                campaign_end_date: endDate,
                                days_offset: daysFromEnd,
                                metadata: {
                                    isVisitesEnMagasin: card.tags?.includes('Visites en magasin')
                                }
                            });
                        }
                    }
                }
            }
        }

        return events;
    }

    /**
     * Logger les événements dans la BDD (éviter les doublons)
     */
    async logEvents(events) {
        for (const event of events) {
            // Vérifier si l'événement existe déjà (même campagne, même type, même jour)
            const existing = await this.client.query(`
                SELECT id FROM campaigns_events 
                WHERE campaign_id = $1 
                  AND event_type = $2 
                  AND event_subtype = $3
                  AND DATE(event_date) = DATE($4)
            `, [event.campaign_id, event.event_type, event.event_subtype, event.event_date]);

            if (existing.rows.length === 0) {
                await this.client.query(`
                    INSERT INTO campaigns_events 
                    (campaign_id, tracker_id, campaign_name, event_type, event_subtype, 
                     csm_name, trader_name, event_date, campaign_start_date, campaign_end_date,
                     days_offset, metadata)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [
                    event.campaign_id, event.tracker_id, event.campaign_name,
                    event.event_type, event.event_subtype, event.csm_name, event.trader_name,
                    event.event_date, event.campaign_start_date, event.campaign_end_date,
                    event.days_offset, JSON.stringify(event.metadata)
                ]);
            }
        }
    }

    /**
     * Détecter les patterns récurrents (30 derniers jours)
     */
    async detectPatterns() {
        const patterns = [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Pattern 1: Campagnes non-programmables lancées à J par CSM
        const nonProgrammableByCSM = await this.client.query(`
            SELECT 
                csm_name,
                COUNT(*) as occurrence_count,
                MIN(event_date) as first_occurrence,
                MAX(event_date) as last_occurrence,
                ARRAY_AGG(campaign_name) as campaigns
            FROM campaigns_events
            WHERE event_type = 'launch'
              AND event_subtype = 'non_programmable_launch'
              AND event_date >= $1
              AND csm_name IS NOT NULL
            GROUP BY csm_name
            HAVING COUNT(*) >= 3
        `, [thirtyDaysAgo]);

        for (const row of nonProgrammableByCSM.rows) {
            await this.upsertPattern({
                pattern_type: 'recurring_non_programmable_launch',
                csm_name: row.csm_name,
                occurrence_count: row.occurrence_count,
                first_occurrence: row.first_occurrence,
                last_occurrence: row.last_occurrence,
                description: `${row.csm_name} a lancé ${row.occurrence_count} campagnes non-programmables à J ce mois`,
                severity: row.occurrence_count >= 5 ? 'high' : 'medium',
                confidence_score: 0.9,
                metadata: { campaigns: row.campaigns }
            });
            patterns.push(row);
        }

        // Pattern 2: Retards récurrents par trader
        const lateByTrader = await this.client.query(`
            SELECT 
                trader_name,
                COUNT(*) as occurrence_count,
                AVG(days_offset) as avg_delay,
                MIN(event_date) as first_occurrence,
                MAX(event_date) as last_occurrence
            FROM campaigns_events
            WHERE event_type = 'launch'
              AND event_subtype = 'late_launch'
              AND event_date >= $1
              AND trader_name IS NOT NULL
            GROUP BY trader_name
            HAVING COUNT(*) >= 3
        `, [thirtyDaysAgo]);

        for (const row of lateByTrader.rows) {
            await this.upsertPattern({
                pattern_type: 'recurring_late_launch',
                trader_name: row.trader_name,
                occurrence_count: row.occurrence_count,
                first_occurrence: row.first_occurrence,
                last_occurrence: row.last_occurrence,
                description: `${row.trader_name} a ${row.occurrence_count} lancements en retard (moy: ${Math.round(row.avg_delay)} jours)`,
                severity: row.avg_delay >= 3 ? 'high' : 'medium',
                confidence_score: 0.85,
                metadata: { avg_delay: row.avg_delay }
            });
            patterns.push(row);
        }

        return patterns;
    }

    /**
     * Upsert un pattern (créer ou mettre à jour)
     */
    async upsertPattern(pattern) {
        const existing = await this.client.query(`
            SELECT id FROM learnings_patterns
            WHERE pattern_type = $1
              AND (csm_name = $2 OR trader_name = $3)
              AND status = 'active'
        `, [pattern.pattern_type, pattern.csm_name || null, pattern.trader_name || null]);

        if (existing.rows.length > 0) {
            // Mettre à jour
            await this.client.query(`
                UPDATE learnings_patterns
                SET occurrence_count = $1,
                    last_occurrence = $2,
                    description = $3,
                    severity = $4,
                    confidence_score = $5,
                    metadata = $6,
                    updated_at = NOW()
                WHERE id = $7
            `, [
                pattern.occurrence_count, pattern.last_occurrence, pattern.description,
                pattern.severity, pattern.confidence_score, JSON.stringify(pattern.metadata),
                existing.rows[0].id
            ]);
        } else {
            // Créer
            await this.client.query(`
                INSERT INTO learnings_patterns
                (pattern_type, csm_name, trader_name, occurrence_count, first_occurrence,
                 last_occurrence, description, severity, confidence_score, metadata,
                 analysis_period_start, analysis_period_end)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                pattern.pattern_type, pattern.csm_name || null, pattern.trader_name || null,
                pattern.occurrence_count, pattern.first_occurrence, pattern.last_occurrence,
                pattern.description, pattern.severity, pattern.confidence_score,
                JSON.stringify(pattern.metadata),
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), new Date()
            ]);
        }
    }

    /**
     * Générer des insights basés sur les patterns
     */
    async generateInsights(patterns) {
        const insights = [];
        // TODO: Implémenter la génération d'insights
        return insights;
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

module.exports = LearningsAnalyzer;
