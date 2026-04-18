const fetch = require('node-fetch');

// Fonction utilitaire pour parser les dates
function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }
    return new Date(dateStr);
}

// Fonction utilitaire pour calculer la différence en jours
function getDaysDiff(date1, date2) {
    const diff = date2 - date1;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Fonction pour obtenir la date du jour
function today() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
}

// Générer les alertes Traders/Commerce
async function generateTradersCommerceAlerts(trelloData) {
    const alerts = [];
    const now = today();
    
    // Calculer une date ajustée pour la criticité (si vendredi, +2 jours)
    const nowForCriticality = new Date(now);
    const isFriday = now.getDay() === 5;
    if (isFriday) {
        nowForCriticality.setDate(nowForCriticality.getDate() + 2);
    }
    
    for (const card of trelloData) {
        // Exclure les campagnes de facturation
        const cardName = card.title || card.name || '';
        const isBillingCampaign = cardName && (
            cardName.toLowerCase().includes('facturation') ||
            cardName.toLowerCase().includes('factu') ||
            cardName.toLowerCase().includes('billing')
        );
        
        if (isBillingCampaign) continue;
        
        const startDate = parseDate(card.dates?.startingDateFormatted);
        const endDate = parseDate(card.dates?.endingDateFormatted);
        const trader = card.trader || 'Aucun';
        
        // Calculer les jours (réels pour affichage, ajustés pour criticité)
        const daysToStart = startDate ? getDaysDiff(now, startDate) : null;
        const daysToStartForCriticality = startDate ? getDaysDiff(nowForCriticality, startDate) : null;
        const daysFromEnd = endDate ? getDaysDiff(endDate, now) : null;
        
        // Alerte Lancement - Non programmable (J-3 à J0 et après lancement)
        if (!card.isProgrammable && !card.areSubdivisionsLive && daysToStart !== null) {
            const launchDate = card.dates?.startingDateFormatted || 'N/A';
            
            // Campagne déjà lancée (jours négatifs)
            if (daysToStart < 0) {
                const daysLate = Math.abs(daysToStart);
                alerts.push({
                    type: 'launch',
                    subtype: 'non-programmable-late',
                    criticality: 'critical',
                    timing: `+${daysLate}j`,
                    card,
                    message: `Non programmable depuis ${daysLate} jour${daysLate > 1 ? 's' : ''} • Lancée: ${launchDate}`
                });
            }
            // Campagne à venir (J-3 à J0)
            else if (daysToStart >= 0 && daysToStart <= 3) {
                let criticality = 'attention';
                let timing = `J-${daysToStart}`;
                
                // Criticité basée sur les jours ajustés (weekend)
                if (daysToStartForCriticality === 0) { criticality = 'critical'; }
                else if (daysToStartForCriticality === 1) { criticality = 'critical'; }
                else if (daysToStartForCriticality === 2) { criticality = 'urgent'; }
                
                alerts.push({
                    type: 'launch',
                    subtype: 'non-programmable',
                    criticality,
                    timing,
                    card,
                    message: `Campagne non programmable • Lancement: ${launchDate}`
                });
            }
        }
        
        // Alerte Lancement - Sans trader (J-3 à J0)
        if (trader === 'Aucun' && card.isProgrammable && daysToStart !== null && daysToStart >= 0 && daysToStart <= 3) {
            let criticality = 'attention';
            let timing = `J-${daysToStart}`;
            
            // Criticité basée sur les jours ajustés (weekend)
            if (daysToStartForCriticality === 0) { criticality = 'critical'; }
            else if (daysToStartForCriticality === 1) { criticality = 'critical'; }
            else if (daysToStartForCriticality === 2) { criticality = 'urgent'; }
            
            alerts.push({
                type: 'launch',
                subtype: 'no-trader',
                criticality,
                timing,
                card,
                message: 'Campagne sans trader assigné'
            });
        }
        
        // Alerte CRITIQUE - Campagne non live alors que date J0 ou passée
        const isInLiveLane = card.laneId === 'lane3';
        const hasAnyLiveSubdivision = card.subdivisions?.some(sub => sub.isLive === true);
        const isActuallyLive = card.areSubdivisionsLive || isInLiveLane || hasAnyLiveSubdivision;
        const isProgrammed = card.areSubdivisionsProgrammed === true;
        
        // Alerter dès J0 (jour du lancement)
        if ((card.isProgrammable || isProgrammed) && !isActuallyLive && daysToStart !== null && daysToStart <= 0) {
            const daysLate = Math.abs(daysToStart);
            let timing = daysLate === 0 ? 'J0' : `J+${daysLate}`;
            const launchDate = card.dates?.startingDateFormatted || 'N/A';
            const sinceText = daysLate === 0 ? 'Aujourd\'hui' : `Depuis ${daysLate}j`;
            
            alerts.push({
                type: 'launch',
                subtype: 'not-live',
                criticality: 'critical',
                timing,
                card,
                message: `Campagne non live - devrait être en cours • ${sinceText} (Lancement: ${launchDate})`
            });
        }
        
        // Alerte Bilan - Campagne terminée sans bilan (J+1 à J+7)
        if (daysFromEnd !== null && daysFromEnd >= 1 && daysFromEnd <= 7 && !card.hasBilan) {
            alerts.push({
                type: 'bilan',
                criticality: 'critical',
                timing: `J+${daysFromEnd}`,
                card,
                message: `Bilan manquant depuis ${daysFromEnd} jour${daysFromEnd > 1 ? 's' : ''}`
            });
        }
    }
    
    return alerts;
}

// Générer les alertes Performance
async function generatePerformanceAlerts(campaignStatsData) {
    const alerts = [];
    const now = today();
    
    // Calculer une date ajustée pour la comparaison durée/volume (si vendredi, +2 jours)
    const nowForComparison = new Date(now);
    const isFriday = now.getDay() === 5;
    if (isFriday) {
        nowForComparison.setDate(nowForComparison.getDate() + 2);
    }
    
    for (const campaign of campaignStatsData.data) {
        // Ignorer les campagnes non live
        if (!campaign.isLive) continue;
        
        // Calculer la durée de campagne
        const startDate = parseDate(campaign.vStartDate);
        const endDate = parseDate(campaign.vEndDate);
        if (!startDate || !endDate) continue;
        
        const totalDays = getDaysDiff(startDate, endDate);
        const elapsedDaysReal = getDaysDiff(startDate, now); // Jours réels pour affichage
        const elapsedDaysForComparison = getDaysDiff(startDate, nowForComparison); // Jours ajustés pour comparaison
        if (totalDays <= 0 || elapsedDaysReal < 0) continue;
        
        const durationProgress = Math.min((elapsedDaysReal / totalDays) * 100, 100); // Affichage avec jours réels
        const durationProgressForComparison = Math.min((elapsedDaysForComparison / totalDays) * 100, 100); // Comparaison avec jours ajustés
        
        // Calculer le % de diffusion (impressions)
        const impressionsObjective = parseFloat(campaign.objectives?.impressions?.overall) || 0;
        let deliveryProgressPercent = 0;
        if (impressionsObjective > 0) {
            const impressionsActual = campaign.data?.impressions?.value2 || 0;
            deliveryProgressPercent = (impressionsActual / impressionsObjective) * 100;
        }
        
        // Vérifier si la campagne ne diffuse pas
        const impressionsData = campaign.data?.impressions;
        const today = impressionsData?.value1 || 0;
        const campaignStartDate = parseDate(campaign.vStartDate);
        const hasStarted = campaignStartDate && campaignStartDate < now;
        const isNotDelivering = (today === 0 && hasStarted);
        
        // Calculer la marge
        const marginRate = campaign.data?.marginRate || null;
        
        let level = null;
        const reasons = [];
        
        // CRITIQUE - Campagne ne diffuse pas actuellement
        if (isNotDelivering) {
            level = 'critique';
            reasons.push(`Campagne ne diffuse pas (0 impressions aujourd'hui)`);
        }
        
        // Alertes objectifs (principal + secondaire) à partir de 50% durée (utiliser durée ajustée)
        if (durationProgressForComparison >= 50) {
            // Seuils d'écart (gap en points) par tranche de durée
            let gapThreshold, durationLevel;
            if (durationProgressForComparison > 90) {
                gapThreshold = 10;   // >90%: écart > 10pts = critique
                durationLevel = 'critique';
            } else if (durationProgressForComparison > 70) {
                gapThreshold = 15;   // 70-90%: écart > 15pts = alerte
                durationLevel = 'alerte';
            } else {
                gapThreshold = 20;   // 50-70%: écart > 20pts = alerte
                durationLevel = 'alerte';
            }
            
            // Vérifier les écarts volume
            const gap = durationProgressForComparison - deliveryProgressPercent;
            if (gap > gapThreshold) {
                reasons.push(`Retard volume: ${deliveryProgressPercent.toFixed(0)}% livré vs ${durationProgressForComparison.toFixed(0)}% durée (obj: ${Math.round(impressionsObjective).toLocaleString('fr-FR')})`);
                if (level !== 'critique') level = durationLevel;
            }
            
            // Marge
            if (durationProgressForComparison > 90) {
                if (marginRate !== null && marginRate < 72) {
                    reasons.push(`Marge ${marginRate.toFixed(0)}% (objectif 72%)`);
                    if (level !== 'critique') level = 'critique';
                }
            } else if (durationProgressForComparison > 70) {
                if (marginRate !== null && marginRate < 72) {
                    reasons.push(`Marge ${marginRate.toFixed(0)}% (objectif 72%)`);
                    if (level !== 'critique') level = 'alerte';
                }
            }
        }
        
        if (level && reasons.length > 0) {
            alerts.push({
                level,
                campaign,
                durationProgress, // Durée réelle pour affichage
                durationProgressForComparison, // Durée ajustée pour comparaison
                deliveryProgress: deliveryProgressPercent,
                marginRate,
                reasons,
                trader: campaign.traderName || 'N/A',
                commercial: campaign.commercialName || 'N/A'
            });
        }
    }
    
    return alerts;
}

module.exports = {
    generateTradersCommerceAlerts,
    generatePerformanceAlerts
};
