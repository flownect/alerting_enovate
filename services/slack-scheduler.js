const cron = require('node-cron');
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const { generateAlerts, generatePerformanceAlerts } = require('./alert-generator');

// Fonction pour envoyer directement sur Slack
async function sendToSlack(blocks, webhookUrl = null) {
    const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
    
    if (!url) {
        throw new Error('SLACK_WEBHOOK_URL non configurée');
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks })
    });
    
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Erreur Slack ${response.status}: ${text}`);
    }
    
    return response;
}

// Variables d'environnement
const NOVA_API_KEY = process.env.NOVA_API_KEY;
const NOVA_PROD_URL = process.env.NOVA_PROD_URL || 'https://dashboard.e-novate.fr';

// Fonction helper pour récupérer les données Trello
async function fetchTrelloData() {
    const url = `${NOVA_PROD_URL}/api/trello?api_key=${NOVA_API_KEY}&cache=1`;
    const response = await fetch(url, { timeout: 120000 });
    
    if (!response.ok) {
        throw new Error(`Trello API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data; // Retourne { lanes: [...] }
}

// Fonction helper pour récupérer les données Campaign Stats
async function fetchCampaignStats() {
    const url = `${NOVA_PROD_URL}/api/campaign-stats/analysis?api_key=${NOVA_API_KEY}`;
    const response = await fetch(url, { timeout: 300000 }); // 5 minutes
    
    if (!response.ok) {
        throw new Error(`Campaign Stats API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data; // Retourne { data: [...] }
}

// Logger
function log(message) {
    console.log(`[${new Date().toISOString()}] [SLACK-SCHEDULER] ${message}`);
}

// Fonction pour récupérer les alertes critiques
async function getCriticalAlerts() {
    try {
        // Appeler l'API centralisée /api/alerts
        log('Récupération des alertes depuis /api/alerts...');
        const response = await fetch('http://localhost:8080/api/alerts?env=prod', { timeout: 300000 });
        
        if (!response.ok) {
            throw new Error(`API alerts error: ${response.status}`);
        }
        
        const alertsData = await response.json();
        
        if (!alertsData.success) {
            throw new Error('API alerts returned success=false');
        }
        
        log(`✅ Alertes récupérées: ${alertsData.data.tradersCommerceAlerts.length} Traders/Commerce, ${alertsData.data.performanceAlerts.length} Performance`);
        
        // Filtrer les alertes critiques
        const tradersAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            a.type === 'launch' && a.criticality === 'critical'
        );
        const commerceAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            a.type === 'commerce' && a.criticality === 'critical'
        );
        const performanceAlerts = alertsData.data.performanceAlerts.filter(a => a.level === 'critique');
        
        log(`Filtrage: ${performanceAlerts.length} Performance critiques, ${tradersAlerts.length} Traders critiques, ${commerceAlerts.length} Commerce critiques`);
        
        return {
            performanceAlerts,
            tradersAlerts,
            commerceAlerts
        };
        
    } catch (error) {
        log(`Erreur récupération alertes: ${error.message}`);
        throw error;
    }
}

// Formater les dates pour Slack
function formatDateForSlack(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Fonction pour envoyer les alertes sur Slack
async function sendDailyAlerts() {
    try {
        log('Début envoi alertes quotidiennes...');
        
        const alerts = await getCriticalAlerts();
        
        // Utiliser directement les alertes de l'API (déjà formatées)
        const formattedPerformance = alerts.performanceAlerts.map(a => ({
            title: a.campaign?.campaignName || 'Sans nom',
            trader: a.trader || 'N/A',
            commercial: a.commercial || 'N/A',
            startDate: a.startDate,  // Déjà formaté par l'API
            endDate: a.endDate,      // Déjà formaté par l'API
            durationProgress: Math.round(a.durationProgress || 0),
            daysLeft: a.daysLeft,    // Déjà calculé par l'API
            deliveryProgress: Math.round(a.deliveryProgress || 0),
            marginRate: typeof a.marginRate === 'number' ? a.marginRate.toFixed(1) : a.marginRate,
            reasons: a.reasons || [],
            novaLink: a.novaLink,    // Déjà construit par l'API
            adxLink: a.adxLink,      // Déjà construit par l'API
            commentsNova: a.commentsNova || [],
            commentsDashboard: a.commentsDashboard || [],
            commentsPlateforme: a.commentsPlateforme || []
        }));
        
        // Formater les alertes Traders pour Slack
        const formattedTraders = alerts.tradersAlerts.map(a => ({
            title: a.card?.title || 'Sans nom',
            trader: a.card?.trader || 'N/A',
            commercial: a.card?.commercial || 'N/A',
            startDate: a.card?.dates?.startingDateFormatted,
            endDate: a.card?.dates?.endingDateFormatted,
            timing: a.timing,
            message: a.message,
            novaLink: a.card?.campaignId 
                ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}` 
                : null,
            adxLink: a.card?.adxCampaignUrl,
            commentsNova: [],
            commentsDashboard: a.commentsDashboard || []
        }));
        
        // Formater les alertes Commerce pour Slack
        const formattedCommerce = alerts.commerceAlerts.map(a => ({
            title: a.card?.title || 'Sans nom',
            trader: a.card?.trader || 'N/A',
            commercial: a.card?.commercial || 'N/A',
            startDate: a.card?.dates?.startingDateFormatted,
            endDate: a.card?.dates?.endingDateFormatted,
            timing: a.timing,
            message: a.message,
            novaLink: a.card?.campaignId 
                ? `https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}` 
                : null,
            adxLink: a.card?.adxCampaignUrl,
            commentsNova: [],
            commentsDashboard: a.commentsDashboard || []
        }));
        
        const totalCritical = formattedPerformance.length + formattedTraders.length + formattedCommerce.length;
        log(`Envoi vers Slack: ${totalCritical} alertes (${formattedPerformance.length} Performance, ${formattedTraders.length} Traders, ${formattedCommerce.length} Commerce)`);
        
        if (totalCritical === 0) {
            log('✅ Aucune alerte critique à envoyer');
            return;
        }
        
        // Importer la fonction d'envoi Slack depuis routes/slack.js
        const { sendAlertsToSlackWebhook } = require('../routes/slack');
        
        // Utiliser la même fonction que le dashboard
        await sendAlertsToSlackWebhook({
            performanceAlerts: formattedPerformance,
            tradersAlerts: formattedTraders,
            commerceAlerts: formattedCommerce
        });
        
        log(`✅ Alertes envoyées sur Slack avec succès`);
        
    } catch (error) {
        log(`❌ Erreur envoi alertes: ${error.message}`);
    }
}

// Fonction pour récupérer les commentaires d'une campagne (par ID ou par nom)
async function getCommentsForCampaign(campaignId, campaignName = null) {
    if ((!campaignId && !campaignName) || !process.env.DATABASE_URL) return [];

    try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        let result;

        // Chercher d'abord par campaign_id
        if (campaignId) {
            result = await pool.query(
                'SELECT comment_text, author, created_at FROM campaign_comments WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 5',
                [campaignId]
            );
        }

        // Si pas de résultat et qu'on a un nom, chercher par campaign_name
        if ((!result || result.rows.length === 0) && campaignName) {
            result = await pool.query(
                'SELECT comment_text, author, created_at FROM campaign_comments WHERE campaign_name = $1 ORDER BY created_at DESC LIMIT 5',
                [campaignName]
            );
        }

        await pool.end();
        return result?.rows || [];
    } catch (error) {
        console.log(`[EMAIL-COMMERCE] ⚠️ Erreur récupération commentaires: ${error.message}`);
        return [];
    }
}

// Fonction pour récupérer les personnes avec leurs emails
async function getPersonEmails() {
    if (!process.env.DATABASE_URL) return { commercials: [], csms: [] };
    
    try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        const result = await pool.query(
            'SELECT name, email, role FROM person_emails WHERE is_active = true AND email IS NOT NULL'
        );
        await pool.end();
        
        const commercials = result.rows.filter(r => r.role === 'commercial');
        const csms = result.rows.filter(r => r.role === 'csm');
        
        return { commercials, csms };
    } catch (error) {
        console.log(`[EMAIL-COMMERCE] ⚠️ Erreur récupération personnes: ${error.message}`);
        return { commercials: [], csms: [] };
    }
}

// Fonction pour générer le HTML d'une alerte
function generateAlertHtml(a, comments = []) {
    const emoji = a.criticality === 'critical' ? '🔴' : '🟠';
    const criticalityText = a.criticality === 'critical' ? 'CRITIQUE' : 'URGENT';
    const bgColor = a.criticality === 'critical' ? '#fee2e2' : '#fed7aa';
    const textColor = a.criticality === 'critical' ? '#991b1b' : '#9a3412';
    
    // Étiquettes de timing et type
    const timingBadge = a.timing ? `<span style="background-color: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 5px;">${a.timing}</span>` : '';
    const typeBadge = a.subtype ? `<span style="background-color: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${a.subtype}</span>` : '';
    
    // Générer le HTML des commentaires
    let commentsHtml = '';
    if (comments && comments.length > 0) {
        commentsHtml = `
            <div style="margin-top: 12px; padding: 10px; background-color: #f3f4f6; border-radius: 4px;">
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #6b7280; font-weight: 600;">💬 Commentaires:</p>
                ${comments.map(c => `
                    <p style="margin: 4px 0; font-size: 11px; color: #4b5563;">
                        <span style="color: #9ca3af;">[${new Date(c.created_at).toLocaleDateString('fr-FR')}]</span>
                        <strong>${c.author}:</strong> ${c.comment_text}
                    </p>
                `).join('')}
            </div>
        `;
    }
    
    return `
        <div style="margin-bottom: 20px; padding: 15px; background-color: ${bgColor}; border-left: 4px solid ${textColor}; border-radius: 4px;">
            <div style="margin-bottom: 8px;">
                ${timingBadge}${typeBadge}
            </div>
            <h3 style="margin: 0 0 10px 0; color: ${textColor};">
                ${emoji} ${criticalityText} - ${a.card?.title || 'Sans nom'}
            </h3>
            <p style="margin: 5px 0; color: #374151;">
                <strong>👤 Commercial:</strong> ${a.card?.commercial || 'N/A'} | 
                <strong>CSM:</strong> ${a.card?.accountManager || 'N/A'} | 
                <strong>Trader:</strong> ${a.card?.trader || 'N/A'}
            </p>
            <p style="margin: 5px 0; color: #374151;">
                <strong>📅 Période:</strong> ${a.card?.dates?.startingDateFormatted} → ${a.card?.dates?.endingDateFormatted}
            </p>
            <p style="margin: 5px 0; color: #374151;">
                <strong>⏰ Alerte:</strong> ${a.message}
            </p>
            ${a.card?.campaignId || a.card?.adxCampaignUrl ? `
                <p style="margin: 10px 0 0 0;">
                    ${a.card?.campaignId ? `<a href="https://dashboard.e-novate.fr/trader/edition-campagne?id=${a.card.campaignId}" style="color: #2563eb; text-decoration: none; margin-right: 15px;">📝 Nova</a>` : ''}
                    ${a.card?.adxCampaignUrl ? `<a href="${a.card.adxCampaignUrl}" style="color: #2563eb; text-decoration: none;">📊 ADX</a>` : ''}
                </p>
            ` : ''}
            ${commentsHtml}
        </div>
    `;
}

// Fonction pour envoyer les alertes Commerce par email (urgent + critique)
// Mode: 'send' pour envoyer réellement, 'preview' pour prévisualiser
async function sendCommerceAlertsEmail(mode = 'send', testRecipients = null) {
    try {
        console.log(`[EMAIL-COMMERCE] Début ${mode === 'preview' ? 'prévisualisation' : 'envoi'} alertes Commerce par email...`);
        
        // Récupérer TOUTES les alertes commerce
        const response = await fetch('http://localhost:8080/api/alerts?env=prod', { timeout: 300000 });
        const alertsData = await response.json();
        
        // Filtrer les alertes Commerce uniquement (NON programmables, urgentes + critiques)
        const commerceAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            !a.card?.isProgrammable &&
            (a.criticality === 'urgent' || a.criticality === 'critical')
        );
        
        // Compter les alertes par criticité
        const criticalCount = commerceAlerts.filter(a => a.criticality === 'critical').length;
        const urgentCount = commerceAlerts.filter(a => a.criticality === 'urgent').length;
        
        console.log(`[EMAIL-COMMERCE] Alertes Commerce: ${commerceAlerts.length} total (${criticalCount} critiques, ${urgentCount} urgentes)`);
        
        if (commerceAlerts.length === 0) {
            console.log('[EMAIL-COMMERCE] ✅ Aucune alerte Commerce urgente/critique');
            return { sent: 0, preview: null };
        }
        
        // Récupérer les commentaires pour chaque campagne (par ID ou nom)
        const alertsWithComments = await Promise.all(
            commerceAlerts.map(async (a) => {
                const comments = await getCommentsForCampaign(a.card?.campaignId, a.card?.title);
                return { ...a, comments };
            })
        );
        
        // Construire le HTML de l'email global
        const alertsHtml = alertsWithComments.map(a => generateAlertHtml(a, a.comments)).join('');
        
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Alertes Commerce</title>
            </head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #1f2937; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">
                    📧 Alertes Commerce - ${new Date().toLocaleDateString('fr-FR')}
                </h1>
                <p style="font-size: 16px; color: #6b7280; margin-bottom: 30px;">
                    ${commerceAlerts.length} alerte${commerceAlerts.length > 1 ? 's' : ''} urgente${commerceAlerts.length > 1 ? 's' : ''} / critique${commerceAlerts.length > 1 ? 's' : ''}
                </p>
                ${alertsHtml}
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                    Alerting E-Novate - Envoi automatique quotidien
                </p>
            </body>
            </html>
        `;
        
        // Mode preview: retourner le HTML sans envoyer
        if (mode === 'preview') {
            return {
                sent: 0,
                preview: {
                    subject: `🚨 ${commerceAlerts.length} Alerte${commerceAlerts.length > 1 ? 's' : ''} Commerce (${criticalCount} critique${criticalCount > 1 ? 's' : ''}, ${urgentCount} urgente${urgentCount > 1 ? 's' : ''}) - ${new Date().toLocaleDateString('fr-FR')}`,
                    html: htmlContent,
                    alertCount: commerceAlerts.length,
                    criticalCount,
                    urgentCount
                }
            };
        }
        
        // Envoyer via SMTP Brevo avec nodemailer
        const smtpKey = process.env.BREVO_SMTP_KEY;
        if (!smtpKey) {
            throw new Error('BREVO_SMTP_KEY non configurée');
        }
        
        const transporter = nodemailer.createTransport({
            host: 'smtp-relay.brevo.com',
            port: 587,
            secure: false,
            auth: { 
                user: process.env.BREVO_SMTP_LOGIN || '99cd6c001@smtp-brevo.com', 
                pass: smtpKey 
            }
        });
        
        let totalSent = 0;
        
        // 1. ENVOI GLOBAL aux destinataires configurés
        let globalRecipients = testRecipients;
        if (!globalRecipients) {
            if (process.env.DATABASE_URL) {
                const { Pool } = require('pg');
                const pool = new Pool({ connectionString: process.env.DATABASE_URL });
                try {
                    const result = await pool.query(
                        'SELECT email FROM commerce_email_recipients WHERE is_active = true ORDER BY email'
                    );
                    globalRecipients = result.rows.map(r => r.email).join(', ');
                    await pool.end();
                    console.log(`[EMAIL-COMMERCE] ${result.rows.length} destinataire(s) global trouvé(s)`);
                } catch (error) {
                    globalRecipients = process.env.COMMERCE_EMAIL_RECIPIENTS || '';
                }
            } else {
                globalRecipients = process.env.COMMERCE_EMAIL_RECIPIENTS || '';
            }
        }
        
        if (globalRecipients) {
            const mailOptions = {
                from: process.env.BREVO_SENDER_EMAIL || 'jmeyer@flownect.fr',
                to: globalRecipients,
                subject: `🚨 ${commerceAlerts.length} Alerte${commerceAlerts.length > 1 ? 's' : ''} Commerce (${criticalCount} critique${criticalCount > 1 ? 's' : ''}, ${urgentCount} urgente${urgentCount > 1 ? 's' : ''}) - ${new Date().toLocaleDateString('fr-FR')}`,
                html: htmlContent
            };
            
            const info = await transporter.sendMail(mailOptions);
            console.log(`[EMAIL-COMMERCE] ✅ Email global envoyé — messageId: ${info.messageId}`);
            totalSent++;
        }
        
        // 2. ENVOIS INDIVIDUELS aux commerciaux et CSM
        const { commercials, csms } = await getPersonEmails();
        
        // Regrouper les alertes par personne
        const alertsByPerson = new Map();
        
        for (const alert of alertsWithComments) {
            const commercial = alert.card?.commercial;
            const csm = alert.card?.accountManager;
            
            // Ajouter aux alertes du commercial
            if (commercial && commercial !== 'N/A' && commercial !== 'Aucun') {
                if (!alertsByPerson.has(commercial)) {
                    alertsByPerson.set(commercial, []);
                }
                alertsByPerson.get(commercial).push(alert);
            }
            
            // Ajouter aux alertes du CSM (peut y avoir plusieurs CSM séparés par virgule)
            if (csm && csm !== 'N/A' && csm !== 'Aucun') {
                const csmList = csm.split(',').map(s => s.trim()).filter(s => s);
                for (const csmName of csmList) {
                    if (!alertsByPerson.has(csmName)) {
                        alertsByPerson.set(csmName, []);
                    }
                    // Éviter les doublons si commercial = CSM
                    const existing = alertsByPerson.get(csmName);
                    if (!existing.find(a => a.card?.campaignId === alert.card?.campaignId && a.type === alert.type)) {
                        alertsByPerson.get(csmName).push(alert);
                    }
                }
            }
        }
        
        // Envoyer un email à chaque personne avec des emails configurés
        const allPersons = [...commercials, ...csms];
        
        for (const person of allPersons) {
            const personAlerts = alertsByPerson.get(person.name) || [];
            
            if (personAlerts.length === 0) {
                console.log(`[EMAIL-COMMERCE] ℹ️ ${person.name}: aucune alerte, email non envoyé`);
                continue;
            }
            
            // Construire le HTML spécifique à cette personne
            const personAlertsHtml = personAlerts.map(a => generateAlertHtml(a, a.comments)).join('');
            
            const personHtmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>Vos Alertes Commerce</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
                    <h1 style="color: #1f2937; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">
                        📧 Vos Alertes - ${new Date().toLocaleDateString('fr-FR')}
                    </h1>
                    <p style="font-size: 16px; color: #6b7280; margin-bottom: 30px;">
                        Bonjour ${person.name},<br><br>
                        Vous avez ${personAlerts.length} alerte${personAlerts.length > 1 ? 's' : ''} concernant vos campagnes.
                    </p>
                    ${personAlertsHtml}
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                    <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                        Alerting E-Novate - Envoi automatique quotidien<br>
                        <a href="http://localhost:8080/settings.html" style="color: #2563eb;">Gérer mes préférences</a>
                    </p>
                </body>
                </html>
            `;
            
            const personMailOptions = {
                from: process.env.BREVO_SENDER_EMAIL || 'jmeyer@flownect.fr',
                to: person.email,
                subject: `🚨 ${personAlerts.length} Alerte${personAlerts.length > 1 ? 's' : ''} sur vos campagnes - ${new Date().toLocaleDateString('fr-FR')}`,
                html: personHtmlContent
            };
            
            try {
                const info = await transporter.sendMail(personMailOptions);
                console.log(`[EMAIL-COMMERCE] ✅ Email envoyé à ${person.name} (${person.email}) — ${personAlerts.length} alertes`);
                totalSent++;
            } catch (error) {
                console.log(`[EMAIL-COMMERCE] ❌ Erreur envoi à ${person.name}: ${error.message}`);
            }
        }
        
        console.log(`[EMAIL-COMMERCE] ✅ Total: ${totalSent} email(s) envoyé(s)`);
        return { sent: totalSent, preview: null };
        
    } catch (error) {
        console.log(`[EMAIL-COMMERCE] ❌ Erreur: ${error.message}`);
        throw error;
    }
}

// Fonction de prévisualisation (pour le mode test)
async function previewCommerceEmails(testRecipients = null, testPerson = null) {
    if (testPerson) {
        // Prévisualisation pour une personne spécifique
        // Chercher si la personne a un email en base
        const { commercials, csms } = await getPersonEmails();
        const allPersons = [...commercials, ...csms];
        const personFromDb = allPersons.find(p => p.name === testPerson);
        
        // Créer un objet personne (depuis la base ou fictif pour la preview)
        const person = personFromDb || { 
            name: testPerson, 
            email: '(email non configuré - ajoutez-le dans les paramètres)',
            role: 'unknown' 
        };
        
        // Récupérer les alertes
        const response = await fetch('http://localhost:8080/api/alerts?env=prod', { timeout: 300000 });
        const alertsData = await response.json();
        
        const commerceAlerts = alertsData.data.tradersCommerceAlerts.filter(a => 
            !a.card?.isProgrammable &&
            (a.criticality === 'urgent' || a.criticality === 'critical') &&
            (a.card?.commercial === testPerson || a.card?.accountManager?.includes(testPerson))
        );
        
        const alertsWithComments = await Promise.all(
            commerceAlerts.map(async (a) => {
                const comments = await getCommentsForCampaign(a.card?.campaignId, a.card?.title);
                return { ...a, comments };
            })
        );
        
        const personAlertsHtml = alertsWithComments.map(a => generateAlertHtml(a, a.comments)).join('');
        
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><title>Vos Alertes</title></head>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
                <h1 style="color: #1f2937; border-bottom: 3px solid #2563eb; padding-bottom: 10px;">
                    📧 Vos Alertes - ${new Date().toLocaleDateString('fr-FR')}
                </h1>
                <p style="font-size: 16px; color: #6b7280; margin-bottom: 30px;">
                    Bonjour ${person.name},<br><br>
                    Vous avez ${commerceAlerts.length} alerte${commerceAlerts.length > 1 ? 's' : ''} concernant vos campagnes.
                </p>
                ${personAlertsHtml || '<p style="color: #6b7280;">Aucune alerte pour vous aujourd\'hui.</p>'}
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #9ca3af; text-align: center;">
                    Alerting E-Novate - Envoi automatique quotidien
                </p>
            </body>
            </html>
        `;
        
        return {
            mode: 'individual',
            person: person.name,
            email: person.email,
            subject: `🚨 ${commerceAlerts.length} Alerte${commerceAlerts.length > 1 ? 's' : ''} sur vos campagnes - ${new Date().toLocaleDateString('fr-FR')}`,
            html: htmlContent,
            alertCount: commerceAlerts.length,
            fromDatabase: !!personFromDb
        };
    }
    
    // Prévisualisation globale
    const result = await sendCommerceAlertsEmail('preview', testRecipients);
    return result.preview;
}

// Démarrer le scheduler
function startScheduler() {
    // Tous les jours à 8h30 - Envoi Traders (existant)
    cron.schedule('30 8 * * *', () => {
        log('🕐 Déclenchement automatique 8h30 - Traders');
        sendDailyAlerts();
    }, {
        timezone: 'Europe/Paris'
    });
    
    // Tous les jours à 8h30 - Envoi Commerce par email (nouveau)
    cron.schedule('30 8 * * *', () => {
        log('🕐 Déclenchement automatique 8h30 - Commerce (email)');
        sendCommerceAlertsEmail();
    }, {
        timezone: 'Europe/Paris'
    });
    
    log('✅ Scheduler démarré - Envoi quotidien à 8h30 (Traders Slack + Commerce Email)');
}

module.exports = { startScheduler, sendDailyAlerts, sendCommerceAlertsEmail, previewCommerceEmails };
