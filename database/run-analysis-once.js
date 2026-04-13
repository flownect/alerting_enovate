/**
 * Script pour lancer l'analyse une seule fois manuellement
 * Usage: node database/run-analysis-once.js
 */

const fetch = require('node-fetch');
const LearningsAnalyzer = require('../services/learnings-analyzer');

async function runOnce() {
    console.log('🚀 Lancement manuel de l\'analyse...\n');

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL non définie');
        process.exit(1);
    }

    const NOVA_API_KEY = process.env.NOVA_API_KEY;
    const NOVA_URL_PROD = process.env.NOVA_URL_PROD || 'https://dashboard.e-novate.fr/api';

    if (!NOVA_API_KEY) {
        console.error('❌ NOVA_API_KEY non définie');
        process.exit(1);
    }

    try {
        // Récupérer les données Trello
        console.log('📋 Récupération des données Trello...');
        const trelloResponse = await fetch(`${NOVA_URL_PROD}/trello`, {
            headers: { 'X-API-Key': NOVA_API_KEY },
            timeout: 120000
        });
        const trelloData = await trelloResponse.json();
        console.log(`✅ ${trelloData.data?.lanes?.flatMap(l => l.cards || []).length || 0} campagnes récupérées\n`);

        // Récupérer les stats
        console.log('📊 Récupération des stats campagnes...');
        const statsResponse = await fetch(`${NOVA_URL_PROD}/campaign-stats`, {
            headers: { 'X-API-Key': NOVA_API_KEY },
            timeout: 120000
        });
        const statsData = await statsResponse.json();
        console.log(`✅ Stats récupérées\n`);

        // Lancer l'analyse
        console.log('🔍 Analyse en cours...\n');
        const analyzer = new LearningsAnalyzer(process.env.DATABASE_URL);
        const results = await analyzer.runAnalysis(trelloData, statsData);

        console.log('\n📊 Résultats:');
        console.log(`   ✅ ${results.events} événements loggés`);
        console.log(`   ✅ ${results.patterns} patterns détectés`);
        console.log(`   ✅ ${results.insights} insights générés`);

        console.log('\n✨ Analyse terminée avec succès!');

    } catch (error) {
        console.error('\n❌ Erreur:', error.message);
        console.error(error);
        process.exit(1);
    }
}

runOnce();
