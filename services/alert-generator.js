// ⚠️ ATTENTION : Ce fichier est une COPIE de la logique du dashboard (dashboard.html lignes 433-743)
// Si tu modifies les règles d'alertes dans le dashboard, tu DOIS synchroniser ce fichier manuellement !

// ==================== BENCHMARK CONSTANTS ====================

const BENCHMARKS = {
    'CTR': { min: 0.17, max: 0.23 },
    'CTR (%)': { min: 0.17, max: 0.23 },
    'Taux de complétion vidéo': { min: 70, max: 85 },
    'Complétion vidéo': { min: 70, max: 85 },
    'VCR': { min: 70, max: 85 },
    'Taux de session': { min: 30, max: 50 },
    'Sessions': { min: 30, max: 50 },
    'Taux de visite LP': { min: 60, max: 67 },
    'Visites en Magasin / Taux de Visite LP': { min: 60, max: 67 },
    'Visite LP': { min: 60, max: 67 },
    'Taux de rebond': { min: 0, max: 30 },
    'Rebond': { min: 0, max: 30 },
    'Brand Safety': { min: 97, max: 99 }
};

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

// ==================== GÉNÉRATION ALERTES PERFORMANCE (copié du dashboard) ====================

function generatePerformanceAlerts(campaignStatsData) {
    if (!campaignStatsData?.data) return [];
    
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
        const elapsedDaysReal = getDaysDiff(startDate, now);
        const elapsedDaysForComparison = getDaysDiff(startDate, nowForComparison);
        if (totalDays <= 0 || elapsedDaysReal < 0) continue;
        
        const durationProgress = Math.min((elapsedDaysReal / totalDays) * 100, 100);
        const durationProgressForComparison = Math.min((elapsedDaysForComparison / totalDays) * 100, 100);
        
        // Calculer le % de diffusion (impressions)
        const impressionsObjective = parseFloat(campaign.objectives?.impressions?.overall) || 0;
        let deliveryProgressPercent = 0;
        if (impressionsObjective > 0) {
            const impressionsActual = campaign.data?.impressions?.value2 || 0;
            deliveryProgressPercent = (impressionsActual / impressionsObjective) * 100;
        }
        
        // Vérifier si la campagne ne diffuse pas
        const impressionsData = campaign.data?.impressions;
        const todayImpressions = impressionsData?.value1 || 0;
        const campaignStartDate = parseDate(campaign.vStartDate);
        const hasStarted = campaignStartDate && campaignStartDate < now;
        const isNotDelivering = (todayImpressions === 0 && hasStarted);
        
        // RÈGLE GLOBALE : Aucune alerte avant 20% de diffusion (sauf campagne ne diffuse pas)
        if (deliveryProgressPercent < 20 && !isNotDelivering) continue;
        
        // Mapping objectifs
        const OBJECTIVE_MAP = {
            impressions:     { dataField: 'impressions',     label: 'Impressions' },
            clicks:          { dataField: 'clicks',          label: 'Clics' },
            conversions:     { dataField: 'conversions',     label: 'Conversions' },
            evVideoComplete: { dataField: 'evVideoComplete', label: 'Complétions vidéo' },
            evUser1:         { dataField: 'evUser4',         label: 'Sessions (evUser1)' },
            evUser2:         { dataField: 'evUser5',         label: 'Visites LP (evUser2)' }
        };
        
        // Calculer la progression pour chaque objectif
        const objectiveGaps = [];
        let mainDeliveryProgress = null;
        
        for (const [objKey, mapping] of Object.entries(OBJECTIVE_MAP)) {
            const overall = parseFloat(campaign.objectives?.[objKey]?.overall) || 0;
            if (overall <= 0) continue;
            
            const actual = campaign.data?.[mapping.dataField]?.value2 || 0;
            const progress = (actual / overall) * 100;
            const gap = durationProgress - progress;
            
            if (objKey === 'impressions') mainDeliveryProgress = progress;
            
            objectiveGaps.push({
                key: objKey,
                label: mapping.label,
                actual,
                overall,
                progress,
                gap
            });
        }
        
        const deliveryProgress = mainDeliveryProgress;
        
        // Récupérer la marge
        const marginRate = campaign.data?.marginRate?.value2 || null;
        const TARGET_MARGIN = 72;
        const expectedMargin = Math.min((durationProgress / 70) * TARGET_MARGIN, TARGET_MARGIN);
        const marginGap = marginRate !== null ? expectedMargin - marginRate : null;
        
        let level = null;
        let reasons = [];
        
        // CRITIQUE - Campagne ne diffuse pas
        if (isNotDelivering) {
            level = 'critique';
            reasons.push(`Campagne ne diffuse pas (0 impressions aujourd'hui)`);
        }
        
        // Alertes objectifs à partir de 50% durée
        if (durationProgressForComparison >= 50) {
            let gapThreshold, durationLevel;
            if (durationProgressForComparison > 90) {
                gapThreshold = 10;
                durationLevel = 'critique';
            } else if (durationProgressForComparison > 70) {
                gapThreshold = 15;
                durationLevel = 'alerte';
            } else {
                gapThreshold = 20;
                durationLevel = 'alerte';
            }
            
            for (const obj of objectiveGaps) {
                if (obj.gap > gapThreshold) {
                    reasons.push(`${obj.label}: ${obj.progress.toFixed(0)}% livré vs ${durationProgressForComparison.toFixed(0)}% durée (obj: ${Math.round(obj.overall).toLocaleString('fr-FR')})`);
                    if (level !== 'critique') level = durationLevel;
                }
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
            } else {
                if (marginGap !== null && marginGap > 10) {
                    reasons.push(`Marge ${marginRate.toFixed(0)}% (attendu ~${expectedMargin.toFixed(0)}%)`);
                    if (level !== 'critique') level = 'alerte';
                }
            }
        }
        
        if (level && reasons.length > 0) {
            console.log(`[PERF ALERT] ${campaign.campaignName} - Level: ${level} - Reasons: ${reasons.join(', ')}`);
            
            // Construire les liens Nova et ADX
            const briefId = campaign.briefId?.briefCampaignInfo?.[0];
            const novaLink = briefId ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${briefId}` : null;
            const adxId = campaign.adxId;
            const adxLink = adxId ? `https://enovate.hubscale.io/manager/campaigns/view/${adxId}` : null;
            
            // Calculer daysLeft
            const endDate = parseDate(campaign.vEndDate);
            let daysLeft = null;
            if (endDate) {
                const now = new Date();
                daysLeft = getDaysDiff(now, endDate);
            }
            
            alerts.push({
                level,
                campaign,
                durationProgress,
                durationProgressForComparison,
                deliveryProgress,
                marginRate,
                reasons,
                trader: campaign.traderName || 'N/A',
                commercial: campaign.commercialName || 'N/A',
                startDate: campaign.vStartDate,
                endDate: campaign.vEndDate,
                daysLeft,
                novaLink,
                adxLink
            });
        }
    }
    
    // Trier par niveau de criticité
    const order = { critique: 0, alerte: 1, faible: 2 };
    return alerts;
}

function getDeliveryPercent(campaign) {
    const impressionsObjective = parseFloat(campaign.objectives?.impressions?.overall) || 0;
    if (impressionsObjective <= 0) return 0;
    
    const impressionsActual = campaign.data?.impressions?.value2 || 0;
    return (impressionsActual / impressionsObjective) * 100;
}

function getTimePercent(campaign) {
    const startDate = parseDate(campaign.vStartDate);
    const endDate = parseDate(campaign.vEndDate);
    if (!startDate || !endDate) return 0;
    
    let now = new Date();
    
    // Si vendredi, ajouter 2 jours
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 5) {
        now = new Date(now.getTime() + (2 * 24 * 60 * 60 * 1000));
    }
    
    if (now < startDate) return 0;
    if (now > endDate) return 100;
    
    const totalDuration = endDate - startDate;
    const elapsed = now - startDate;
    return (elapsed / totalDuration) * 100;
}

function findMatchingCard(campaign, cards) {
    if (!campaign) return null;
    
    return cards.find(c => {
        if (!c) return false;
        
        // Match par campaignId
        if (c.campaignId && campaign.briefId?.briefCampaignInfo?.[0] &&
            c.campaignId === campaign.briefId.briefCampaignInfo[0]) {
            return true;
        }
        
        if (c.campaignId && campaign.campaignId && c.campaignId === campaign.campaignId) {
            return true;
        }
        
        // Match par briefId
        if (c.briefId?.briefCampaignInfo?.[0] && campaign.briefId?.briefCampaignInfo?.[0] &&
            c.briefId.briefCampaignInfo[0] === campaign.briefId.briefCampaignInfo[0]) {
            return true;
        }
        
        // Match par trackerId
        if (c.trackerId && (campaign.adxDisplayId === c.trackerId || campaign.adxId === c.trackerId)) {
            return true;
        }
        
        return false;
    });
}

function getCardKpis(card) {
    const kpis = [];
    
    if (!card.subdivisions || card.subdivisions.length === 0) {
        return kpis;
    }
    
    for (const sub of card.subdivisions) {
        if (sub.kpi && sub.kpi.trim()) {
            kpis.push({ name: sub.kpi.trim(), type: 'primary' });
        }
        
        if (sub.secondaryKpi && sub.secondaryKpi.trim()) {
            kpis.push({ name: sub.secondaryKpi.trim(), type: 'secondary' });
        }
        
        if (sub.otherKpis && Array.isArray(sub.otherKpis)) {
            for (const otherKpi of sub.otherKpis) {
                if (otherKpi && otherKpi.trim()) {
                    kpis.push({ name: otherKpi.trim(), type: 'other' });
                }
            }
        }
    }
    
    return kpis;
}

function checkKpiBenchmark(kpi, card, campaign, deliveryPercent, timePercent) {
    const normalizedName = normalizeKpiName(kpi.name);
    if (!normalizedName) return null;
    
    const benchmark = BENCHMARKS[normalizedName];
    if (!benchmark) return null;
    
    const adxField = mapKpiToAdxField(normalizedName);
    if (!adxField) return null;
    
    const currentValue = campaign.data?.[adxField]?.value2;
    if (currentValue === null || currentValue === undefined) return null;
    
    const belowMin = currentValue < benchmark.min;
    const isRebond = kpi.name.toLowerCase().includes('rebond');
    const aboveMax = isRebond && currentValue > benchmark.max;
    
    if (!belowMin && !aboveMax) return null;
    
    const gap = belowMin ? (benchmark.min - currentValue) : (currentValue - benchmark.max);
    const severity = calculateMixedSeverity(gap, benchmark, deliveryPercent, timePercent, currentValue);
    
    let level = 'faible';
    
    if (deliveryPercent >= 20 && deliveryPercent < 30) {
        level = 'faible';
    } else if (kpi.type === 'other') {
        level = 'faible';
    } else {
        if (severity === 'critical') level = 'critique';
        else if (severity === 'urgent') level = 'alerte';
    }
    
    const message = isRebond 
        ? `${kpi.name}: ${currentValue.toFixed(1)}% (max: ${benchmark.max}%) • ${deliveryPercent.toFixed(0)}% diffusé • ${timePercent.toFixed(0)}% du temps`
        : `${kpi.name}: ${currentValue.toFixed(2)}% (min: ${benchmark.min}%) • ${deliveryPercent.toFixed(0)}% diffusé • ${timePercent.toFixed(0)}% du temps`;
    
    // Calculer daysLeft pour Slack
    const startDateObj = parseDate(campaign.vStartDate);
    const endDateObj = parseDate(campaign.vEndDate);
    let daysLeft = null;
    if (endDateObj) {
        const now = new Date();
        daysLeft = getDaysDiff(now, endDateObj);
    }
    
    // Formater les dates pour affichage
    const formatDate = (dateStr) => {
        if (!dateStr) return null;
        const date = parseDate(dateStr);
        if (!date) return null;
        return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    
    // Construire les liens Nova et ADX
    const briefId = campaign.briefId?.briefCampaignInfo?.[0];
    const novaLink = briefId ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${briefId}` : null;
    const adxId = campaign.adxId;
    const adxLink = adxId ? `https://enovate.hubscale.io/manager/campaigns/view/${adxId}` : null;
    
    return {
        level,
        campaign,
        durationProgress: timePercent,
        deliveryProgress: deliveryPercent,
        marginRate: null,
        reasons: [message],
        trader: campaign.traderName || 'N/A',
        commercial: campaign.commercialName || 'N/A',
        startDate: formatDate(campaign.vStartDate),
        endDate: formatDate(campaign.vEndDate),
        daysLeft,
        novaLink,
        adxLink,
        isBenchmarkAlert: true,
        benchmarkData: {
            kpi: kpi.name,
            kpiType: kpi.type,
            currentValue,
            benchmark,
            gap,
            severity
        }
    };
}

function mapKpiToAdxField(kpiName) {
    const mapping = {
        'CTR': 'ctr',
        'CTR (%)': 'ctr',
        'Taux de complétion vidéo': 'vcr',
        'Complétion vidéo': 'vcr',
        'VCR': 'vcr',
        'Taux de session': 'sessionsRate',
        'Sessions': 'sessionsRate',
        'Taux de visite LP': 'lpVisitsRate',
        'Visites en Magasin / Taux de Visite LP': 'lpVisitsRate',
        'Taux de rebond': 'bounceRate',
        'Brand Safety': 'brandSafetyRate'
    };
    return mapping[kpiName] || null;
}

function calculateMixedSeverity(gap, benchmark, deliveryPercent, timePercent, currentValue) {
    const gapPercent = (gap / benchmark.min) * 100;
    
    // Si < 10% du temps restant et pas à l'objectif → Critique
    if (timePercent > 90 && gap > 0) {
        return 'critical';
    }
    
    let baseScore = 0;
    if (gapPercent > 20) baseScore = 3;
    else if (gapPercent > 10) baseScore = 2;
    else baseScore = 1;
    
    let timeBonus = 0;
    if (timePercent > 75) timeBonus = 1;
    else if (timePercent > 50) timeBonus = 0.5;
    
    let deliveryBonus = 0;
    if (deliveryPercent > 70) deliveryBonus = 0.5;
    
    const finalScore = baseScore + timeBonus + deliveryBonus;
    
    if (finalScore >= 4) return 'critical';
    if (finalScore >= 2.5) return 'urgent';
    return 'attention';
}

// ==================== BENCHMARK ALERTS GENERATION ====================

function normalizeKpiName(kpiName) {
    if (!kpiName) return '';
    const normalized = kpiName.trim().toLowerCase();
    
    // IGNORER ces KPIs
    if (normalized.includes('visite') && normalized.includes('magasin')) return null;
    if (normalized.includes('conditionné')) return null;
    if (normalized.includes('attention publicitaire')) return null;
    if (normalized.includes('interaction format')) return null;
    if (normalized === 'leads') return null;
    if (normalized === 'reach') return null;
    if (normalized === 'visibilité') return null;
    
    // Mapping
    if (normalized === 'ctr') return 'CTR';
    if (normalized.includes('complétion') || normalized.includes('vcr')) return 'VCR';
    if (normalized.includes('session')) return 'Taux de session';
    if (normalized === 'taux de visite lp') return 'Taux de visite LP';
    if (normalized.includes('rebond') && normalized.includes('temps passé') && !normalized.includes('conditionné')) return 'Taux de rebond';
    if (normalized.includes('brand') || normalized.includes('safety')) return 'Brand Safety';
    
    return null;
}

function generateBenchmarkAlerts(campaignStatsData, trelloData) {
    console.log('🔍 Generating benchmark alerts...');
    
    if (!campaignStatsData?.data || !trelloData?.data?.lanes) {
        console.log('ℹ️ No data available for benchmark analysis');
        return [];
    }
    
    const alerts = [];
    
    // Récupérer toutes les cartes Trello
    const allCards = [];
    for (const lane of trelloData.data.lanes) {
        allCards.push(...(lane.cards || []));
    }
    
    console.log(`📊 Analyzing ${allCards.length} cards for benchmark alerts`);
    
    let liveCampaigns = 0;
    let above20Percent = 0;
    let matchedCards = 0;
    let withKpis = 0;
    
    // Pour chaque campagne ADX
    for (const campaign of campaignStatsData.data) {
        if (!campaign.isLive) continue;
        liveCampaigns++;
        
        const deliveryPercent = getDeliveryPercent(campaign);
        
        // N'afficher les alertes qu'après 20% de diffusion
        if (deliveryPercent < 20) continue;
        above20Percent++;
        
        const timePercent = getTimePercent(campaign);
        
        // Trouver la carte Trello correspondante
        const card = findMatchingCard(campaign, allCards);
        if (!card) continue;
        matchedCards++;
        
        // Récupérer les KPIs de la carte
        const kpis = getCardKpis(card);
        if (kpis.length === 0) continue;
        withKpis++;
        
        // Vérifier chaque KPI
        for (const kpi of kpis) {
            const alert = checkKpiBenchmark(kpi, card, campaign, deliveryPercent, timePercent);
            if (alert) {
                alerts.push(alert);
                console.log(`🚨 Benchmark alert: ${campaign.campaignName}: ${kpi.name}`);
            }
        }
    }
    
    console.log(`📊 Benchmark stats: ${liveCampaigns} live, ${above20Percent} >20%, ${matchedCards} matched, ${withKpis} with KPIs`);
    console.log(`✅ Generated ${alerts.length} benchmark alerts`);
    return alerts;
}

module.exports = { 
    generateAlerts, 
    generatePerformanceAlerts, 
    generateBenchmarkAlerts,
    parseDate, 
    getDaysDiff, 
    today, 
    hasTag, 
    getEffectiveTrader 
};
