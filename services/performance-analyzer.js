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

        // Vérifier le % de diffusion (volume)
        const deliveryPercent = this.getDeliveryPercent(perfData);
        
        // N'afficher les alertes qu'après 30% de diffusion
        if (deliveryPercent < 30) {
            return alerts;
        }

        // Calculer le % de temps écoulé
        const timePercent = this.getTimePercent(card);

        // Récupérer les KPIs de la carte
        const kpis = benchmarkMatcher.getCardKpis(card);
        
        for (const kpi of kpis) {
            const alert = this.checkKpiPerformance(kpi, card, perfData, deliveryPercent, timePercent);
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
     * @param {number} deliveryPercent - % de diffusion
     * @param {number} timePercent - % de temps écoulé
     * @returns {object|null} - Alerte ou null
     */
    checkKpiPerformance(kpi, card, perfData, deliveryPercent, timePercent) {
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
            // Calculer la sévérité en mixant performance et temps
            const severity = this.calculateMixedSeverity(check.gap, benchmark, deliveryPercent, timePercent);
            
            return {
                type: 'performance',
                kpi: kpi.name,
                kpiType: kpi.type,
                severity: severity,
                currentValue: currentValue,
                benchmark: benchmark,
                gap: check.gap,
                deliveryPercent: deliveryPercent,
                timePercent: timePercent,
                message: `${kpi.name} en dessous du benchmark : ${currentValue.toFixed(2)}% (min: ${benchmark.min}%)`,
                detailedMessage: `${kpi.name}: ${currentValue.toFixed(2)}% (objectif: ${benchmark.min}-${benchmark.max}%) • ${deliveryPercent.toFixed(0)}% diffusé • ${timePercent.toFixed(0)}% du temps écoulé`
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
     * Calcule la sévérité mixte basée sur performance ET temps écoulé
     * Plus on avance dans le temps, plus la sévérité augmente
     */
    calculateMixedSeverity(gap, benchmark, deliveryPercent, timePercent) {
        const gapPercent = (gap / benchmark.min) * 100;
        
        // Score de base selon l'écart au benchmark
        let baseScore = 0;
        if (gapPercent > 20) baseScore = 3;      // Critical
        else if (gapPercent > 10) baseScore = 2; // Urgent
        else baseScore = 1;                       // Attention
        
        // Bonus selon le temps écoulé (plus on avance, plus c'est grave)
        let timeBonus = 0;
        if (timePercent > 75) timeBonus = 1;      // Fin de campagne
        else if (timePercent > 50) timeBonus = 0.5; // Mi-campagne
        
        // Bonus selon la diffusion (si on a beaucoup diffusé avec mauvaise perf)
        let deliveryBonus = 0;
        if (deliveryPercent > 70) deliveryBonus = 0.5;
        
        const finalScore = baseScore + timeBonus + deliveryBonus;
        
        // Mapper le score final vers une sévérité
        if (finalScore >= 4) return 'critical';
        if (finalScore >= 2.5) return 'urgent';
        return 'attention';
    }

    /**
     * Récupère le % de diffusion (volume)
     */
    getDeliveryPercent(perfData) {
        if (!perfData.data || !perfData.data.volumeProgression) {
            return 0;
        }
        
        const progression = perfData.data.volumeProgression.value2;
        return progression !== null && progression !== undefined ? progression : 0;
    }

    /**
     * Calcule le % de temps écoulé de la campagne
     */
    getTimePercent(card) {
        if (!card.dates || !card.dates.startingDateMoment || !card.dates.endingDateMoment) {
            return 0;
        }
        
        const now = Date.now();
        const start = card.dates.startingDateMoment;
        const end = card.dates.endingDateMoment;
        
        if (now < start) return 0;
        if (now > end) return 100;
        
        const totalDuration = end - start;
        const elapsed = now - start;
        
        return (elapsed / totalDuration) * 100;
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
