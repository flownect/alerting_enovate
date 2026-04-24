// ============================================
// ADX API - Service pour interagir avec l'API ADX (DSP)
// ============================================
// API ADX : Récupération des données de campagnes depuis la DSP

const ADX_API_URL = process.env.ADX_API_URL;
const ADX_API_TOKEN = process.env.ADX_API_TOKEN;

/**
 * Récupère les informations d'une campagne ADX par son ID
 * @param {number} campaignId - ID de la campagne ADX
 * @returns {Promise<Object>} - Données de la campagne
 */
async function getCampaignById(campaignId) {
    if (!ADX_API_URL || !ADX_API_TOKEN) {
        throw new Error('ADX API credentials not configured');
    }

    const url = `${ADX_API_URL}/campaigns/${campaignId}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${ADX_API_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`ADX API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Récupère le nom complet d'une campagne ADX
 * @param {number} campaignId - ID de la campagne ADX
 * @returns {Promise<string|null>} - Nom de la campagne ou null
 */
async function getCampaignName(campaignId) {
    try {
        const campaign = await getCampaignById(campaignId);
        return campaign.name || campaign.title || null;
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
