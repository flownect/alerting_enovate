const express = require('express');
const router = express.Router();

// Échapper les caractères spéciaux pour Slack
function escapeSlackText(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Fonction pour envoyer un message sur Slack
async function sendSlackMessage(blocks) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    
    if (!webhookUrl) {
        throw new Error('SLACK_WEBHOOK_URL non configurée');
    }
    
    const payload = { blocks };
    console.log('[SLACK] Envoi de', blocks.length, 'blocs');
    
    // Valider les blocs avant envoi
    blocks.forEach((block, i) => {
        if (block.text?.text && block.text.text.length > 3000) {
            console.warn(`[SLACK] ⚠️ Bloc ${i} trop long: ${block.text.text.length} caractères`);
        }
    });
    
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('[SLACK] Erreur détaillée:', errorText);
        throw new Error(`Erreur Slack: ${response.statusText} - ${errorText}`);
    }
    
    return response;
}

// Formater une alerte pour Slack (données déjà nettoyées côté client)
function formatAlertForSlack(alert) {
    const title = alert.title || 'Sans nom';
    const trader = alert.trader || 'N/A';
    const commercial = alert.commercial || 'N/A';
    
    // Badges/Étiquettes (timing, types d'alertes)
    let badges = '';
    
    // Jours restants en premier
    if (alert.daysLeft !== null && alert.daysLeft !== undefined && alert.daysLeft > 0) {
        badges += `⏱️ ${alert.daysLeft}j restants\n`;
    } else if (alert.timing) {
        badges += `⏱️ ${alert.timing}\n`;
    }
    
    // Types d'alertes en badges
    if (alert.reasons && alert.reasons.length > 0) {
        const types = [];
        alert.reasons.forEach(r => {
            if (r.includes('Marge')) types.push('Marge');
            if (r.includes('diffuse pas')) types.push('Pas de diffusion');
            if (r.includes('Retard')) types.push('Retard volume');
            if (r.includes('CTR') || r.includes('VCR') || r.includes('Sessions') || r.includes('Visite LP')) types.push('Performance');
        });
        if (types.length > 0) {
            badges += types.join('\n') + '\n';
        }
    } else if (alert.message) {
        if (alert.message.includes('non programmable')) badges += 'Lancement\n';
        if (alert.message.includes('sans trader')) badges += 'Trader\n';
        if (alert.message.includes('non live')) badges += 'Non Live\n';
    }
    
    // Alertes détaillées
    let alertsText = '';
    if (alert.reasons && alert.reasons.length > 0) {
        alertsText = alert.reasons.map(r => {
            if (r.includes('Marge')) return `💰 ${r}`;
            if (r.includes('diffuse pas')) return `🚫 ${r}`;
            if (r.includes('Retard')) return `📉 ${r}`;
            if (r.includes('CTR') || r.includes('VCR')) return `📊 ${r}`;
            if (r.includes('Sessions') || r.includes('Visite LP')) return `🔗 ${r}`;
            return `⚠️ ${r}`;
        }).join('\n');
    } else if (alert.message) {
        alertsText = `⚠️ ${alert.message}`;
    }
    
    // Durée et dates
    let durationText = '';
    if (alert.durationProgress !== undefined) {
        durationText = `*Durée:* ${Math.round(alert.durationProgress)}%`;
        if (alert.daysLeft !== null && alert.daysLeft !== undefined && !isNaN(alert.daysLeft)) {
            durationText += ` • ${alert.daysLeft}j restants`;
        }
        durationText += '\n';
    }
    
    // Afficher les dates (déjà formatées par l'API)
    if (alert.startDate && alert.endDate) {
        console.log(`[SLACK] Dates pour ${alert.title || 'N/A'}: ${alert.startDate} → ${alert.endDate}`);
        durationText += `*Dates:* ${alert.startDate} → ${alert.endDate}\n`;
    } else {
        console.log(`[SLACK] Dates manquantes pour ${alert.title || 'N/A'}: startDate=${alert.startDate}, endDate=${alert.endDate}`);
    }
    
    // Infos complémentaires
    let details = `*Trader:* ${trader}\n*Commercial:* ${commercial}\n`;
    
    if (alert.deliveryProgress !== undefined) {
        details += `*Volume:* ${alert.deliveryProgress}%\n`;
    }
    
    if (alert.marginRate) {
        details += `*Marge:* ${alert.marginRate}%\n`;
    }
    
    // Commentaires Dashboard (en premier)
    let commentsDashboardText = '';
    if (alert.commentsDashboard && alert.commentsDashboard.length > 0) {
        commentsDashboardText = '\n*💬 Commentaires Dashboard:*\n' + 
            alert.commentsDashboard.map(c => `• ${escapeSlackText(c)}`).join('\n');
    }
    
    // Commentaires Nova
    let commentsNovaText = '';
    if (alert.commentsNova && alert.commentsNova.length > 0) {
        commentsNovaText = '\n*💬 Commentaires Nova:*\n' + 
            alert.commentsNova.map(c => `• ${escapeSlackText(c)}`).join('\n');
    }
    
    // Commentaires ADX
    let commentsADXText = '';
    if (alert.commentsPlateforme && alert.commentsPlateforme.length > 0) {
        commentsADXText = '\n*💬 Commentaires ADX:*\n' + 
            alert.commentsPlateforme.map(c => `• ${escapeSlackText(c)}`).join('\n');
    }
    
    // Fallback pour les alertes Traders/Commerce qui n'ont qu'un seul type
    if (!commentsNovaText && !commentsDashboardText && !commentsADXText && alert.comments && alert.comments.length > 0) {
        commentsDashboardText = '\n*💬 Commentaires:*\n' + 
            alert.comments.map(c => `• ${escapeSlackText(c)}`).join('\n');
    }
    
    // Liens
    let linksText = '';
    if (alert.novaLink || alert.adxLink) {
        linksText = '\n';
        if (alert.novaLink) linksText += `<${alert.novaLink}|Nova>`;
        if (alert.novaLink && alert.adxLink) linksText += ' | ';
        if (alert.adxLink) linksText += `<${alert.adxLink}|ADX>`;
    }
    
    return {
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `*${title}*\n\n${badges}\n${alertsText}\n\n${durationText}\n${details}${commentsDashboardText}${commentsNovaText}${commentsADXText}${linksText}`
        }
    };
}

// Fonction pour envoyer les alertes sur Slack (utilisable en interne)
async function sendAlertsToSlackWebhook(data) {
    const { performanceAlerts, tradersAlerts, commerceAlerts } = data;
    
    // Les données sont déjà filtrées et nettoyées côté client
    const criticalPerf = performanceAlerts || [];
    const criticalTraders = tradersAlerts || [];
    const criticalCommerce = commerceAlerts || [];
    
    const totalCritical = criticalPerf.length + criticalTraders.length + criticalCommerce.length;
    
    if (totalCritical === 0) {
        return { success: true, message: 'Aucune alerte critique à envoyer' };
    }
    
    // Construire le message Slack
    const today = new Date();
    const dateStr = today.toLocaleDateString('fr-FR', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    
    const blocks = [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*📅 ${dateStr.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            }
        },
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `🚨 Alertes Critiques`,
                emoji: true
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${totalCritical} alerte${totalCritical > 1 ? 's' : ''} critique${totalCritical > 1 ? 's' : ''}*\n📊 Performance: ${criticalPerf.length} | 👥 Traders: ${criticalTraders.length}`
            }
        },
        { type: 'divider' }
    ];
    
    // Section Performance
    if (criticalPerf.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*📊 ALERTES PERFORMANCE (${criticalPerf.length})*`
            }
        });
        blocks.push({ type: 'divider' });
        
        criticalPerf.forEach(alert => {
            blocks.push(formatAlertForSlack(alert));
            blocks.push({ type: 'divider' });
        });
    }
    
    // Section Traders
    if (criticalTraders.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*👥 ALERTES TRADERS (${criticalTraders.length})*`
            }
        });
        blocks.push({ type: 'divider' });
        
        criticalTraders.forEach(alert => {
            blocks.push(formatAlertForSlack(alert));
            blocks.push({ type: 'divider' });
        });
    }
    
    // Section Commerce (CSM)
    if (criticalCommerce.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*💼 ALERTES CSM (${criticalCommerce.length})*`
            }
        });
        blocks.push({ type: 'divider' });
        
        criticalCommerce.forEach(alert => {
            blocks.push(formatAlertForSlack(alert));
            blocks.push({ type: 'divider' });
        });
    }
    
    // Slack limite à 50 blocs par message - diviser si nécessaire
    if (blocks.length > 50) {
        console.log(`[SLACK] ⚠️ ${blocks.length} blocs, division en plusieurs messages`);
        
        // Envoyer par tranches de 50 blocs
        for (let i = 0; i < blocks.length; i += 50) {
            const chunk = blocks.slice(i, i + 50);
            await sendSlackMessage(chunk);
            // Petite pause entre les messages
            if (i + 50 < blocks.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } else {
        await sendSlackMessage(blocks);
    }
    
    return { 
        success: true, 
        message: `${totalCritical} alerte${totalCritical > 1 ? 's' : ''} envoyée${totalCritical > 1 ? 's' : ''} sur Slack` 
    };
}

// POST /api/slack/send-alerts
// Envoyer les alertes critiques sur Slack
router.post('/send-alerts', async (req, res) => {
    try {
        const result = await sendAlertsToSlackWebhook(req.body);
        res.json(result);
    } catch (error) {
        console.error('Erreur envoi Slack:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
module.exports.sendAlertsToSlackWebhook = sendAlertsToSlackWebhook;
