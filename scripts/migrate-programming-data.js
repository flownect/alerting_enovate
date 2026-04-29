const { Client } = require('pg');
const fetch = require('node-fetch');

async function migrateProgrammingData() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('🔄 Migration des données campaign_programming → campaign_status_tracking...');

        // Récupérer les données Trello actuelles pour enrichir
        console.log('📡 Récupération des données Trello...');
        const trelloResponse = await fetch('http://localhost:8080/api/trello?env=prod', { timeout: 300000 });
        const trelloData = await trelloResponse.json();
        
        // Créer un map des campagnes Trello par ID
        const trelloMap = new Map();
        if (trelloData.success && trelloData.data) {
            const allCards = [
                ...(trelloData.data.lane1?.cards || []),
                ...(trelloData.data.lane2?.cards || []),
                ...(trelloData.data.lane3?.cards || []),
                ...(trelloData.data.lane4?.cards || [])
            ];
            allCards.forEach(card => {
                if (card.campaignId) {
                    trelloMap.set(card.campaignId, card);
                }
            });
            console.log(`📊 ${trelloMap.size} cartes Trello récupérées`);
        }

        // Récupérer toutes les données de campaign_programming
        const result = await client.query(`
            SELECT 
                campaign_id,
                campaign_name,
                csm_name,
                trader_name,
                became_programmable_at,
                programmed_at,
                campaign_start_date,
                days_before_start
            FROM campaign_programming
            WHERE programmed_at IS NOT NULL
            ORDER BY programmed_at
        `);

        console.log(`📊 ${result.rows.length} campagnes à migrer...`);

        let migrated = 0;
        let skipped = 0;

        for (const row of result.rows) {
            try {
                // Enrichir avec les données Trello actuelles
                const trelloCard = trelloMap.get(row.campaign_id);
                const commercial = trelloCard?.commercial || null;
                const csm = trelloCard?.accountManager || null;
                const trader = trelloCard?.trader || row.trader_name;
                
                // Insérer ou mettre à jour dans campaign_status_tracking
                await client.query(`
                    INSERT INTO campaign_status_tracking (
                        campaign_id,
                        campaign_name,
                        commercial_name,
                        csm_name,
                        trader_name,
                        current_status,
                        became_programmable_at,
                        became_programmed_at,
                        campaign_start_date,
                        days_before_launch,
                        first_seen_at,
                        created_at,
                        updated_at
                    ) VALUES ($1, $2, $3, $4, $5, 'programmed', $6, $7, $8, $9, $7, $7, NOW())
                    ON CONFLICT (campaign_id) 
                    DO UPDATE SET
                        commercial_name = COALESCE(campaign_status_tracking.commercial_name, EXCLUDED.commercial_name),
                        csm_name = COALESCE(campaign_status_tracking.csm_name, EXCLUDED.csm_name),
                        trader_name = COALESCE(campaign_status_tracking.trader_name, EXCLUDED.trader_name),
                        became_programmable_at = COALESCE(campaign_status_tracking.became_programmable_at, EXCLUDED.became_programmable_at),
                        became_programmed_at = COALESCE(campaign_status_tracking.became_programmed_at, EXCLUDED.became_programmed_at),
                        days_before_launch = COALESCE(campaign_status_tracking.days_before_launch, EXCLUDED.days_before_launch),
                        updated_at = NOW()
                `, [
                    row.campaign_id,
                    row.campaign_name,
                    commercial,
                    csm,
                    trader,
                    row.became_programmable_at,
                    row.programmed_at,
                    row.campaign_start_date,
                    row.days_before_start
                ]);

                migrated++;
                if (migrated % 50 === 0) {
                    console.log(`✅ ${migrated}/${result.rows.length} campagnes migrées...`);
                }
            } catch (error) {
                console.log(`⚠️ Erreur migration ${row.campaign_id}: ${error.message}`);
                skipped++;
            }
        }

        console.log(`\n✅ Migration terminée !`);
        console.log(`   - ${migrated} campagnes migrées`);
        console.log(`   - ${skipped} campagnes ignorées`);

        // Vérifier le résultat
        const check = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(became_programmable_at) as avec_date_programmable,
                COUNT(became_programmed_at) as avec_date_programmed
            FROM campaign_status_tracking
        `);

        console.log(`\n📊 État final campaign_status_tracking:`);
        console.log(`   - Total: ${check.rows[0].total}`);
        console.log(`   - Avec became_programmable_at: ${check.rows[0].avec_date_programmable}`);
        console.log(`   - Avec became_programmed_at: ${check.rows[0].avec_date_programmed}`);

    } catch (error) {
        console.error('❌ Erreur migration:', error);
        throw error;
    } finally {
        await client.end();
    }
}

// Exécuter si appelé directement
if (require.main === module) {
    migrateProgrammingData()
        .then(() => {
            console.log('\n🎉 Migration réussie !');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n💥 Échec migration:', error);
            process.exit(1);
        });
}

module.exports = { migrateProgrammingData };
