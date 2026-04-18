// ⚠️ ATTENTION : Ce fichier est une COPIE de la logique du dashboard (dashboard.html lignes 433-743)
// Si tu modifies les règles d'alertes dans le dashboard, tu DOIS synchroniser ce fichier manuellement !

// ==================== HELPERS (copiés du dashboard) ====================

function parseDate(dateStr) {
    if (!dateStr) return null;
    // Handle DD/MM/YYYY format
    if (dateStr.includes('/')) {
        const [day, month, year] = dateStr.split('/');
        return new Date(year, month - 1, day);
    }
    return new Date(dateStr);
}

function getDaysDiff(date1, date2) {
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function today() {
    return new Date();
}

function hasTag(card, tagTitle) {
    return card.tags?.some(t => t.title?.toLowerCase().includes(tagTitle.toLowerCase()));
}

function getEffectiveTrader(traderField) {
    if (!traderField) return 'Aucun';
    // Prendre le premier trader de la liste (séparé par " - ")
    const firstTrader = traderField.split(/\s+-\s+/)[0].trim();
    return firstTrader || 'Aucun';
}

function getAllCards(trelloData) {
    if (!trelloData?.data?.lanes) return [];
    return trelloData.data.lanes.flatMap(lane => lane.cards || []);
}

// ==================== GÉNÉRATION ALERTES TRADERS/COMMERCE (copié du dashboard) ====================

function generateAlerts(trelloData) {
    const cards = getAllCards(trelloData);
    const now = today();
    
    // Calculer une date ajustée pour la criticité (si vendredi, +2 jours)
    const nowForCriticality = new Date(now);
    const isFriday = now.getDay() === 5;
    if (isFriday) {
        nowForCriticality.setDate(nowForCriticality.getDate() + 2);
    }
    
    const alerts = [];
    
    console.log(`🔍 generateAlerts: ${cards.length} cartes à analyser`);

    for (const card of cards) {
        // Exclure les campagnes de facturation
        const cardName = card.title || card.name || '';
        const isBillingCampaign = cardName && (
            /ne\s*pas\s*prog/i.test(cardName) ||
            /pour\s*facturation/i.test(cardName) ||
            /à\s*facturer/i.test(cardName) ||
            /a\s*facturer/i.test(cardName) ||
            /mais\s*pas\s*prog/i.test(cardName)
        );
        
        if (isBillingCampaign) {
            console.log('🚫 Campagne de facturation exclue:', cardName);
            continue;
        }
        
        const startDate = parseDate(card.dates?.startingDateFormatted);
        const endDate = parseDate(card.dates?.endingDateFormatted);
        const trader = getEffectiveTrader(card.trader);
        
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

        // Alerte Bilan non saisi (jamais critique, max urgent)
        if (hasTag(card, 'Terminé') && hasTag(card, 'Bilan non saisi') && daysFromEnd !== null && daysFromEnd >= 1) {
            const isPriority = card.flaggedAsImportant === true;
            let criticality = 'attention';
            let timing = `J+${daysFromEnd}`;
            
            // Calculer la date limite (lendemain de fin)
            const endDate = parseDate(card.dates?.endingDateFormatted);
            let deadlineDate = 'N/A';
            if (endDate) {
                const deadline = new Date(endDate);
                deadline.setDate(deadline.getDate() + 1);
                deadlineDate = deadline.toLocaleDateString('fr-FR');
            }
            
            // Règles de criticité (max urgent)
            if (isPriority) {
                if (daysFromEnd >= 3 && daysFromEnd <= 4) {
                    criticality = 'attention';
                } else if (daysFromEnd >= 5) {
                    criticality = 'urgent';
                } else {
                    continue;
                }
            } else {
                if (daysFromEnd >= 3 && daysFromEnd <= 4) {
                    criticality = 'attention';
                } else if (daysFromEnd >= 5) {
                    criticality = 'urgent';
                } else {
                    continue;
                }
            }
            
            const priorityText = isPriority ? ' (Prioritaire)' : '';
            const message = `Bilan non saisi${priorityText} • Attendu le ${deadlineDate} • ${daysFromEnd}j de retard`;
            
            alerts.push({
                type: 'bilan',
                subtype: 'bilan-non-saisi',
                criticality,
                timing,
                card,
                message,
                daysFromEnd
            });
        }
    }

    // Sort by criticality, puis par ancienneté pour les bilans
    const order = { critical: 0, urgent: 1, attention: 2 };
    alerts.sort((a, b) => {
        const critDiff = order[a.criticality] - order[b.criticality];
        if (critDiff !== 0) return critDiff;
        if (a.daysFromEnd && b.daysFromEnd) {
            return b.daysFromEnd - a.daysFromEnd;
        }
        return 0;
    });

    return alerts;
}

module.exports = {
    generateAlerts,
    parseDate,
    getDaysDiff,
    today,
    hasTag,
    getEffectiveTrader
};
