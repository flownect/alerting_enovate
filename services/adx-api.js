// ============================================
// ADX API - Service pour interagir avec l'API ADX (DSP)
// ============================================
// API ADX : Récupération des données de campagnes depuis la DSP

const ADX_API_URL = process.env.ADX_API_URL;
const ADX_API_KEY = process.env.ADX_API_KEY;

/**
 * Récupère le nom d'une campagne ADX via l'API de stats
 * @param {number} campaignId - ID de la campagne ADX
 * @returns {Promise<Object>} - Données de la campagne avec le nom
 */
async function getCampaignById(campaignId) {
    if (!ADX_API_URL || !ADX_API_KEY) {
        throw new Error('ADX API credentials not configured');
    }

    // Appeler l'API de stats avec un breakdownFields minimal pour récupérer le nom
    // L'api_key est passée en query parameter
    const url = `${ADX_API_URL}?api_key=${ADX_API_KEY}&page=1&limit=100&timezone=Europe%2FLondon&cohort=1`;
    
    const body = {
        dateRange: {
            dateFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 90 jours avant
            dateTo: new Date().toISOString().split('T')[0] // aujourd'hui
        },
        breakdownFields: ["campaignId", "campaignName"],
        statisticFields: ["impressions"], // Un seul champ pour minimiser la réponse
        filters: { campaign: [campaignId] }
    };
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`ADX API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    // Extraire les données (peut être wrappé dans response.data ou data)
    let data = [];
    if (Array.isArray(result)) {
        data = result;
    } else if (result.response?.data && Array.isArray(result.response.data)) {
        data = result.response.data;
    } else if (result.data && Array.isArray(result.data)) {
        data = result.data;
    }
    
    // Extraire le nom de campagne du premier record
    if (data.length > 0 && data[0].campaignName) {
        return { name: data[0].campaignName, id: campaignId };
    }
    
    return null;
}

/**
 * Récupère le nom complet d'une campagne ADX
 * @param {number} campaignId - ID de la campagne ADX
 * @returns {Promise<string|null>} - Nom de la campagne ou null
 */
async function getCampaignName(campaignId) {
    // Ne pas tenter si les credentials ne sont pas configurés
    if (!ADX_API_URL || !ADX_API_KEY) {
        return null;
    }
    
    try {
        const campaign = await getCampaignById(campaignId);
        return campaign?.name || null;
    } catch (error) {
        console.error(`[ADX API] Erreur récupération campagne ${campaignId}:`, error.message);
        return null;
    }
}

/**
 * Récupère les noms de plusieurs campagnes ADX
 * @param {number[]} campaignIds - Liste d'IDs de campagnes ADX
 * @returns {Promise<Object>} - Map {campaignId: campaignName}
 */
async function getCampaignNames(campaignIds) {
    const results = {};
    
    for (const id of campaignIds) {
        const name = await getCampaignName(id);
        if (name) {
            results[id] = name;
        }
    }
    
    return results;
}

module.exports = {
    getCampaignById,
    getCampaignName,
    getCampaignNames
};
