const benchmarkMatcher = require('./benchmark-matcher');

class PerformanceAnalyzer {
    /**
     * Analyse les performances d'une campagne et génère des alertes
     * @param {object} card - Carte Trello
     * @param {object} perfData - Données de performance ADX
     * @returns {array} - Liste des alertes de performance
     */
    analyzePerformance(card, perfData) {
        const alerts = [];
        
        if (!perfData || !perfData.data) {
            return alerts;
        }

        // Récupérer les KPIs de la carte
        const kpis = benchmarkMatcher.getCardKpis(card);
        
        for (const kpi of kpis) {
            const alert = this.checkKpiPerformance(kpi, card, perfData);
            if (alert) {
                alerts.push(alert);
            }
        }

        return alerts;
    }

    /**
     * Vérifie la performance d'un KPI spécifique
     * @param {object} kpi - {name, type}
     * @param {object} card - Carte Trello
     * @param {object} perfData - Données ADX
     * @returns {object|null} - Alerte ou null
     */
    checkKpiPerformance(kpi, card, perfData) {
        // Trouver le benchmark
        const benchmark = benchmarkMatcher.findBenchmark(kpi.name, card);
        if (!benchmark) {
            return null;
        }

        // Mapper le nom du KPI vers le champ ADX
        const adxField = this.mapKpiToAdxField(kpi.name);
        if (!adxField) {
            return null;
        }

        // Récupérer la valeur actuelle
        const currentValue = this.getAdxValue(perfData, adxField);
        if (currentValue === null || currentValue === undefined) {
            return null;
        }

        // Vérifier la performance
        const check = benchmarkMatcher.checkPerformance(currentValue, benchmark);
        
        if (check.belowMin) {
            return {
                type: 'performance',
                kpi: kpi.name,
                kpiType: kpi.type,
                severity: this.calculateSeverity(check.gap, benchmark),
                currentValue: currentValue,
                benchmark: benchmark,
                gap: check.gap,
                message: `${kpi.name} en dessous du benchmark : ${currentValue.toFixed(2)}% (min: ${benchmark.min}%)`
            };
        }

        return null;
    }

    /**
     * Mappe un nom de KPI vers le champ ADX correspondant
     */
    mapKpiToAdxField(kpiName) {
        const normalized = benchmarkMatcher.normalizeKpiName(kpiName);
        
        const mapping = {
            'ctr': 'ctr',
            'vcr': 'vcr',
            'sessionsRate': 'sessionsRate',
            'lpVisitsRate': 'lpVisitsRate',
            'lpInteractionRate': 'lpInteractionRate',
            'bounceRate': 'bounceRate',
            'brandSafetyRate': 'brandSafetyRate',
            'creaInteractionRate': 'creaInteractionRate'
        };

        return mapping[normalized] || null;
    }

    /**
     * Récupère la valeur d'un champ ADX
     */
    getAdxValue(perfData, field) {
        if (!perfData.data || !perfData.data[field]) {
            return null;
        }

        // Récupérer value2 (valeur cumulée)
        const value = perfData.data[field].value2;
        
        return value !== null && value !== undefined ? value : null;
    }

    /**
     * Calcule la sévérité de l'alerte selon l'écart au benchmark
     */
    calculateSeverity(gap, benchmark) {
        const range = benchmark.max - benchmark.min;
        const gapPercent = (gap / benchmark.min) * 100;

        if (gapPercent > 20) return 'critical';  // > 20% en dessous
        if (gapPercent > 10) return 'urgent';    // 10-20% en dessous
        return 'attention';                       // < 10% en dessous
    }

    /**
     * Analyse toutes les campagnes avec données de performance
     * @param {array} cards - Cartes Trello
     * @param {object} campaignStatsData - Données ADX de toutes les campagnes
     * @returns {array} - Alertes de performance
     */
    analyzeAllCampaigns(cards, campaignStatsData) {
        const alerts = [];

        for (const card of cards) {
            // Trouver les données de performance pour cette carte
            const perfData = this.findPerfData(card, campaignStatsData);
            
            if (perfData) {
                const cardAlerts = this.analyzePerformance(card, perfData);
                
                for (const alert of cardAlerts) {
                    alerts.push({
                        ...alert,
                        card: card,
                        campaignId: card.campaignId,
                        title: card.title,
                        trackerId: card.trackerId
                    });
                }
            }
        }

        return alerts;
    }

    /**
     * Trouve les données de performance ADX pour une carte
     */
    findPerfData(card, campaignStatsData) {
        if (!campaignStatsData || !campaignStatsData.data) {
            return null;
        }

        // 1. Chercher par campaignId
        if (card.campaignId) {
            const byId = campaignStatsData.data.find(c => c.campaignId === card.campaignId);
            if (byId) return byId;
        }

        // 2. Chercher par trackerId dans le nom
        if (card.trackerId) {
            const extractedId = card.trackerId;
            const byTrackerId = campaignStatsData.data.find(c => {
                const adxId = c.adxDisplayId || c.adxId;
                return adxId && adxId.toString() === extractedId.toString();
            });
            if (byTrackerId) return byTrackerId;
        }

        // 3. Chercher par nom (sans l'ID entre crochets)
        if (card.title) {
            const titleWithoutId = card.title.replace(/^\[\d+\]\s*/, '');
            const byName = campaignStatsData.data.find(c => 
                c.campaignName && c.campaignName.toLowerCase() === titleWithoutId.toLowerCase()
            );
            if (byName) return byName;
        }

        return null;
    }
}

module.exports = new PerformanceAnalyzer();
