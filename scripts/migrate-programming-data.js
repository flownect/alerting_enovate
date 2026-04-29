const { Client } = require('pg');

async function migrateProgrammingData() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('🔄 Migration des données campaign_programming → campaign_status_tracking...');

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
            WHERE became_programmable_at IS NOT NULL
            ORDER BY became_programmable_at
        `);

        console.log(`📊 ${result.rows.length} campagnes à migrer...`);

        let migrated = 0;
        let skipped = 0;

        for (const row of result.rows) {
            try {
                // Insérer ou mettre à jour dans campaign_status_tracking
                await client.query(`
                    INSERT INTO campaign_status_tracking (
                        campaign_id,
                        campaign_name,
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
                    ) VALUES ($1, $2, $3, $4, 'programmed', $5, $6, $7, $8, $5, $5, NOW())
                    ON CONFLICT (campaign_id) 
                    DO UPDATE SET
                        became_programmable_at = COALESCE(campaign_status_tracking.became_programmable_at, EXCLUDED.became_programmable_at),
                        became_programmed_at = COALESCE(campaign_status_tracking.became_programmed_at, EXCLUDED.became_programmed_at),
                        days_before_launch = COALESCE(campaign_status_tracking.days_before_launch, EXCLUDED.days_before_launch),
                        updated_at = NOW()
                `, [
                    row.campaign_id,
                    row.campaign_name,
                    row.csm_name,
                    row.trader_name,
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
